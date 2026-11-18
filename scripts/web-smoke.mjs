#!/usr/bin/env node
/**
 * web-smoke — serve a built web app, fetch `/`, expect 200 with a non-empty body, stop it.
 * The web analogue of "launched and still running": runtime-gate.sh's web mode calls this when the
 * project has no e2e suite.
 *
 *   web-smoke.mjs --dir <build output dir>          serve it statically, in this process
 *   web-smoke.mjs --start --root <project>          run `npm run start` with PORT set, then fetch
 *                 [--timeout <seconds>]             how long to wait for the server (default 60)
 *
 * Exit: 0 PASS · 1 FAIL (non-200, empty body, or the server exited before answering)
 *       2 CANNOT EVALUATE (nothing answered within the timeout — not a pass, not proven broken)
 * One line on stdout, which runtime-gate.sh quotes.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const out = (code, msg) => { process.stdout.write(`${msg}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['dir', 'root', 'timeout']), die: (c, m) => out(2, m) });
const TIMEOUT = Number(flags.timeout || 60) * 1000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }); });

async function probe(url, alive) {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    if (!alive()) return { exited: true };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      return { status: res.status, body: await res.text() };
    } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  return { timeout: true };
}

function verdict(r, what) {
  if (r.exited) out(1, `FAIL: ${what} exited before it answered on / — it crashed on start`);
  if (r.timeout) out(2, `CANNOT EVALUATE: nothing answered on / within ${TIMEOUT / 1000}s (${what}) — not a pass`);
  if (r.status !== 200) out(1, `FAIL: GET / returned ${r.status} (${what})`);
  if (!r.body.trim()) out(1, `FAIL: GET / returned 200 with an EMPTY body (${what}) — a blank page is not a running app`);
  out(0, `PASS: GET / -> 200, ${Buffer.byteLength(r.body)} bytes (${what})`);
}

const port = await freePort();
const url = `http://127.0.0.1:${port}/`;

if (typeof flags.dir === 'string') {
  const dir = resolve(flags.dir);
  if (!existsSync(join(dir, 'index.html'))) out(2, `CANNOT EVALUATE: no index.html in ${flags.dir} — nothing to serve`);
  const server = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(new URL(req.url, url).pathname)).replace(/^([/\\])+/, '');
    let file = resolve(dir, rel || 'index.html');
    if (file !== dir && !file.startsWith(dir + sep)) { res.writeHead(403).end(); return; }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
  }).listen(port, '127.0.0.1');
  const r = await probe(url, () => true);
  server.close();
  verdict(r, `static ${flags.dir}`);
} else if (flags.start) {
  const root = resolve(String(flags.root || '.'));
  // Own process group, so the kill reaches the server npm forked and not only npm itself.
  const child = spawn('npm', ['run', 'start'], { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' } });
  let alive = true;
  child.on('exit', () => { alive = false; });
  child.on('error', () => { alive = false; });
  const r = await probe(url, () => alive);
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  verdict(r, 'npm run start');
} else {
  out(2, 'usage: web-smoke.mjs --dir <build dir> | --start --root <project> [--timeout <s>]');
}
