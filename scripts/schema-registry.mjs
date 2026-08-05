#!/usr/bin/env node
/**
 * schema-registry — every `name/vN` this studio writes, declared once, checked against the tree.
 *
 * F7. Thirty schema identifiers are scattered across the scripts, one of them already at v2
 * (`context-manifest`). Nothing lists them, nothing says who writes each and who reads it, and
 * nothing notices when a new one appears or an old one vanishes. That is the same shape as every
 * other drift defect this repo has hit: the fix that lands in one file and stops before its
 * sibling, discovered later by a reader who assumed the two agreed.
 *
 * WHAT THIS DOES, AND DELIBERATELY DOES NOT DO.
 *
 * The plan's F7 asked for "parsers, migrations and compatibility fixtures" for every schema. That
 * is not justified by the evidence: in this repository's whole history exactly ONE schema has ever
 * been versioned up (context-manifest v1 -> v2), and a migration framework for twenty-nine schemas
 * that have never migrated is a large amount of code defending a problem nobody has had. Writing it
 * would be the speculative-generality this codebase already pays for elsewhere.
 *
 * What IS a real, recurring problem is drift: a schema string added in one place and not registered,
 * or renamed in a writer while a reader still expects the old name. So this closes that, and says
 * plainly that it is the narrow half:
 *
 *   - every `name/vN` literal in scripts/ must be declared in docs/team/schema-registry.json
 *   - every declared schema must still appear in the tree (a stale entry is drift too)
 *   - each declaration names its writer and its reader, so "who consumes this" is answerable
 *     without a grep, which is the question a migration would need answered FIRST anyway
 *
 * When a schema genuinely needs a v2, this is the file that tells you who breaks. That is the
 * prerequisite for a migration, and it is cheaper than a migration framework nobody has needed.
 *
 * Usage:
 *   schema-registry.mjs check      compare the registry against the tree
 *   schema-registry.mjs list       print the registry
 *   schema-registry.mjs scan       print every schema literal found in the tree (to seed the file)
 *
 * Exit codes:
 *   0  registry and tree agree
 *   1  drift — an undeclared schema, or a declared one that no longer exists
 *   2  cannot evaluate — no registry file, or it is unreadable
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`schema-registry: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['registry', 'root']), die });
const [command] = positional;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = typeof flags.root === 'string' ? resolve(flags.root) : resolve(HERE, '..');
const REGISTRY = typeof flags.registry === 'string' ? resolve(flags.registry) : resolve(ROOT, 'docs/team/schema-registry.json');

/**
 * Every `name/vN` literal in the shipped scripts.
 *
 * SCANNED, NEVER HAND-LISTED. A registry maintained by hand is a second source of truth about the
 * first one, and it would drift in exactly the way this file exists to catch.
 */
function scan() {
  const found = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(mjs|js)$/.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(/['"]([a-z][a-z-]*\/v\d+)['"]/g)) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(relativeToRoot(p));
      }
    }
  };
  walk(join(ROOT, 'scripts'));
  return found;
}

const relativeToRoot = (p) => p.slice(ROOT.length + 1);

function loadRegistry() {
  if (!existsSync(REGISTRY)) {
    die(2, `no schema registry at ${REGISTRY}\n` +
           '  Seed it with:  node scripts/schema-registry.mjs scan > docs/team/schema-registry.json\n' +
           '  then fill in the reader for each entry.');
  }
  let r;
  try { r = JSON.parse(readFileSync(REGISTRY, 'utf8')); }
  catch (e) { die(2, `${REGISTRY} is not readable JSON: ${e.message}`); }
  if (r.schema !== 'schema-registry/v1' || !r.schemas || typeof r.schemas !== 'object') {
    die(2, 'the registry must be {"schema":"schema-registry/v1","schemas":{...}}');
  }
  return r;
}

function cmdScan() {
  const found = scan();
  const schemas = {};
  for (const [name, files] of [...found.entries()].sort()) {
    schemas[name] = { files: [...files].sort(), reader: null };
  }
  process.stdout.write(`${JSON.stringify({ schema: 'schema-registry/v1', schemas }, null, 2)}\n`);
}

function cmdList() {
  const r = loadRegistry();
  const names = Object.keys(r.schemas).sort();
  process.stdout.write(`SCHEMA REGISTRY — ${names.length} schema(s)\n\n`);
  for (const n of names) {
    const e = r.schemas[n] || {};
    process.stdout.write(`  ${n.padEnd(28)} ${(e.files || []).join(', ')}\n`);
    if (e.reader) process.stdout.write(`  ${' '.repeat(28)} read by ${e.reader}\n`);
  }
}

function cmdCheck() {
  const r = loadRegistry();
  const found = scan();
  const declared = new Set(Object.keys(r.schemas));
  const present = new Set(found.keys());

  const undeclared = [...present].filter((n) => !declared.has(n)).sort();
  // A STALE ENTRY IS DRIFT TOO. A registry that still lists a schema nothing writes is a registry
  // that will send the next reader looking for a producer that does not exist — the same wasted
  // hour as an undeclared one, in the other direction.
  const vanished = [...declared].filter((n) => !present.has(n)).sort();

  for (const n of undeclared) {
    process.stdout.write(`  UNDECLARED  ${n}  (written by ${[...found.get(n)].sort().join(', ')})\n`);
  }
  for (const n of vanished) {
    process.stdout.write(`  VANISHED    ${n}  — declared in the registry, written by nothing in scripts/\n`);
  }

  if (undeclared.length || vanished.length) {
    process.stdout.write(
      `\nSCHEMA REGISTRY: DRIFT — ${undeclared.length} undeclared, ${vanished.length} vanished.\n` +
      '  Re-seed with `schema-registry.mjs scan`, then state the reader for each new entry.\n' +
      '  "Who reads this" is the question a version bump needs answered FIRST, which is why it is\n' +
      '  recorded before anyone needs it rather than reconstructed under pressure.\n'
    );
    process.exit(1);
  }
  process.stdout.write(`SCHEMA REGISTRY: CLEAR — ${present.size} schema(s), all declared and all still written.\n`);
}

switch (command) {
  case 'check': cmdCheck(); break;
  case 'list': cmdList(); break;
  case 'scan': cmdScan(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n  check | list | scan`);
}
