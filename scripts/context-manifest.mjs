#!/usr/bin/env node
/** Deterministic context provenance and freshness checker. No summarisation, no hidden retrieval. */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`context-manifest: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'out', 'manifest', 'ticket', 'role', 'source', 'reason', 'omit']), die });
const command = positional[0] || 'create';
const root = resolve(String(flags.root || '.'));
const output = resolve(String(flags.out || 'docs/team/context-manifest.json'));
function repeated(name) {
  const values = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith('--')) values.push(argv[i + 1]);
    else if (argv[i].startsWith(`--${name}=`)) values.push(argv[i].slice(name.length + 3));
  }
  return values;
}

function git(args) { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function sourceEntry(path, reason) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) die(2, `context source is missing or not a file: ${path}`);
  const bytes = statSync(absolute).size;
  return { id: createHash('sha256').update(relative(root, absolute)).digest('hex').slice(0, 16), path: relative(root, absolute), sha256: hash(absolute), bytes, reason: reason || 'declared source' };
}
function sources() {
  const values = repeated('source');
  return values.map((path) => sourceEntry(String(path), String(flags.reason || 'declared source')));
}
function verify(manifest) {
  if (!manifest || manifest.schema !== 'context-manifest/v1' || !Array.isArray(manifest.sources)) die(2, 'invalid context manifest');
  const currentHead = git(['rev-parse', 'HEAD']);
  if (manifest.git?.head && currentHead && manifest.git.head !== currentHead) die(1, `STALE: git HEAD changed from ${manifest.git.head} to ${currentHead}`);
  for (const source of manifest.sources) {
    const absolute = resolve(root, source.path);
    if (!existsSync(absolute)) die(1, `STALE: source removed: ${source.path}`);
    if (hash(absolute) !== source.sha256) die(1, `STALE: source changed: ${source.path}`);
  }
  console.log(`CONTEXT MANIFEST: FRESH — ${manifest.sources.length} source(s), snapshot ${manifest.snapshot_id}`);
}
if (command === 'verify') {
  const path = resolve(String(flags.manifest || output));
  if (!existsSync(path)) die(2, `no manifest at ${path}`);
  try { verify(JSON.parse(readFileSync(path, 'utf8'))); } catch (e) { if (e.code) throw e; die(2, `cannot read manifest: ${e.message}`); }
} else if (command === 'create') {
  const entries = sources();
  if (!entries.length) die(2, 'at least one --source is required; implicit context is not recorded');
  const head = git(['rev-parse', 'HEAD']);
  const manifest = {
    schema: 'context-manifest/v1', snapshot_id: `CTX-${createHash('sha256').update(JSON.stringify(entries) + (head || '')).digest('hex').slice(0, 16)}`,
    generated_at: new Date().toISOString(), root, ticket: flags.ticket || null, role: flags.role || null,
    git: { head, branch: git(['branch', '--show-current']) }, sources: entries,
    omitted: repeated('omit'),
    token_estimate: Math.ceil(entries.reduce((sum, entry) => sum + entry.bytes, 0) / 4),
  };
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`CONTEXT MANIFEST: CREATED — ${manifest.snapshot_id} at ${output}`);
} else die(2, `unknown command ${command}; use create or verify`);
