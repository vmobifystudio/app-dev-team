#!/usr/bin/env node
/**
 * control-room server — Node stdlib, zero dependencies, so it starts with `node_modules` absent.
 *
 * That is not tidiness. `control-room/` is where the plugin's dependencies are allowed to live, and
 * the one thing that must never depend on them is the thing you reach for when the build is broken.
 * This server therefore does two things and needs nothing installed for either:
 *
 *   - serves `GET /state`, `GET /events` (SSE) and `POST /action` — the whole data plane
 *   - serves `dist/` if the React app has been built, and if it has NOT, says exactly that with the
 *     two commands that fix it. It never serves a blank page: a UI that fails to load and shows
 *     nothing is indistinguishable from a project with nothing wrong.
 *
 * `POST /action` reuses `scripts/lib/actions.mjs` — the SAME whitelist, the same validators and the
 * same `execFile`-into-the-real-CLI as the emergency dashboard. Nothing here opens a state file for
 * writing; there is no such code path in this directory.
 *
 * Usage:
 *   node control-room/server.mjs [--project DIR] [--port 4174] [--no-actions] [--dist DIR]
 *
 * Exit codes: 0 served · 2 the project directory does not exist, or the port is taken
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from '../scripts/lib/args.mjs';
import { runAction, refuseRequest } from '../scripts/lib/actions.mjs';
import { assembleState } from './state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const NOT_BUILT = (dist) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Control room — not built</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; padding: 40px 20px; max-width: 720px; margin: 0 auto; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
pre { padding: 12px 14px; border-radius: 8px; border: 1px solid currentColor; overflow-x: auto; }
</style></head><body>
<h1>The control room is not built</h1>
<p>The data plane is running — <code>/state</code> is live on this port right now. The page is not,
because <code>${dist}</code> does not exist.</p>
<pre>cd control-room
npm install
npm run build</pre>
<p>Or run the Vite dev server on its own port, which proxies this one:</p>
<pre>cd control-room
npm run dev</pre>
<p>Meanwhile the zero-dependency diagnostic dashboard needs nothing installed and works when this
does not — that is the whole reason it still exists:</p>
<pre>node scripts/studio-dashboard.mjs --project .</pre>
</body></html>
`;

function serveStatic(dist, pathname, send) {
  // Path traversal: `normalize` then confirm the result is still inside `dist`. A control room
  // reads a machine with source, credentials and evidence on it, and `GET /../../.ssh/id_rsa` is
  // the entire attack.
  const wanted = normalize(join(dist, pathname === '/' ? 'index.html' : pathname));
  if (wanted !== dist && !wanted.startsWith(dist + sep)) return send(403, 'text/plain', 'refused');
  const target = existsSync(wanted) && statSync(wanted).isDirectory() ? join(wanted, 'index.html') : wanted;
  if (!existsSync(target)) {
    // A single-page app: an unknown path is a client route, not a missing file.
    const index = join(dist, 'index.html');
    if (existsSync(index)) return send(200, MIME['.html'], readFileSync(index));
    return send(404, 'text/plain', 'not found');
  }
  return send(200, MIME[extname(target)] || 'application/octet-stream', readFileSync(target));
}

function watchDocs(root, onChange) {
  const docsDir = join(root, 'docs');
  if (!existsSync(docsDir)) return;
  try {
    watch(docsDir, { recursive: true }, onChange);
  } catch {
    // recursive fs.watch is not available on every platform.
    for (const dir of [docsDir, join(docsDir, 'team'), join(docsDir, 'daily')]) {
      if (existsSync(dir)) watch(dir, onChange);
    }
  }
}

function serve(root, { port, actions, dist }) {
  const clients = new Set();
  let timer = null;
  watchDocs(root, () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      for (const res of clients) res.write('data: refetch\n\n');
    }, 2000);
  });
  const beat = setInterval(() => {
    for (const res of clients) res.write(': keep-alive\n\n');
  }, 25000);
  beat.unref?.();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };

    if (req.method === 'GET' && url.pathname === '/state') {
      try {
        return send(200, 'application/json', JSON.stringify(assembleState(root, { actions })));
      } catch (error) {
        // A 500 with the stack, never an empty 200. A page that renders "nothing to report" because
        // its data source threw is the exact failure this project exists to prevent.
        return send(500, 'application/json', JSON.stringify({ error: String(error.stack || error) }));
      }
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('data: hello\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      if (!actions) {
        return send(403, 'application/json', JSON.stringify({ ok: false, refused: 'this control room was started with --no-actions' }));
      }
      const refusal = refuseRequest(req);
      if (refusal) return send(refusal.status, 'application/json', JSON.stringify(refusal.body));

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1 << 16) req.destroy();
      });
      req.on('end', async () => {
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          return send(400, 'application/json', JSON.stringify({ ok: false, refused: 'body is not JSON' }));
        }
        const result = await runAction(root, String(parsed.action ?? ''), parsed.params || {});
        return send(result.status, 'application/json', JSON.stringify(result.body));
      });
      return undefined;
    }

    if (req.method === 'GET') {
      if (!existsSync(dist)) return send(503, MIME['.html'], NOT_BUILT(dist));
      return serveStatic(dist, url.pathname, send);
    }
    return send(404, 'text/plain', 'not found');
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`control-room: http://localhost:${port}  (project: ${root})\n`);
    if (!existsSync(dist)) process.stdout.write(`control-room: ${dist} is absent — /state is live, the page is not. cd control-room && npm install && npm run build\n`);
    if (!actions) process.stdout.write('control-room: read-only — actions disabled\n');
  });
  server.on('error', (error) => {
    process.stderr.write(`control-room: cannot listen on ${port}: ${error.message}\n`);
    process.exit(2);
  });
  return server;
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2), {
    valueFlags: new Set(['project', 'port', 'dist']),
    knownFlags: new Set(['project', 'port', 'dist', 'no-actions']),
    die: (code, message) => {
      process.stderr.write(`control-room: ${message}\n`);
      process.exit(code);
    },
  });
  const flag = (name, fallback) => (typeof flags[name] === 'string' ? flags[name] : fallback);

  const root = resolve(process.cwd(), flag('project', '.'));
  if (!existsSync(root)) {
    process.stderr.write(`control-room: no such project directory: ${root}\n`);
    process.exit(2);
  }
  serve(root, {
    port: Number(flag('port', 4174)),
    actions: !process.argv.slice(2).includes('--no-actions'),
    dist: resolve(HERE, flag('dist', 'dist')),
  });
}

// Unconditional, deliberately. The usual `argv[1] === import.meta.url` guard compares a path the
// shell gave us against one Node resolved, and on macOS `/tmp` is a symlink to `/private/tmp` — so
// the two never matched, the server started, printed nothing and exited 0. A silent success is the
// worst failure mode a server can have. Nothing imports this file; if something ever needs to,
// export `serve` and give it its own entry point rather than reinstating the comparison.
main();
