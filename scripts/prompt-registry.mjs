#!/usr/bin/env node
/** Validate a versioned prompt/policy registry; registry entries are reviewable data, not prose. */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`prompt-registry: ${message}\n`); process.exit(code); };
const { flags, positional } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['registry', 'agents-dir', 'now']), die });
const path = resolve(String(flags.registry || 'docs/team/prompt-registry.json'));
const command = positional[0] || 'check';

/**
 * `sync` is the only place an entry's `content_hash` and `version` are ever written — an empty
 * registry validates a shape nothing populates, which is scaffolding, not governance. A role file
 * with no prior entry gets one (`1.0.0`, `rollback_version: 0.0.0` — honestly "no prior version
 * exists" rather than inventing one); a role file whose hash has drifted since its last sync gets
 * its patch bumped and its old version recorded as the rollback target. Everything else is
 * untouched, so a human's manually-set `owner`/`eval_suite`/`precedence` survives a re-sync.
 */
function cmdSync(flags) {
  const agentsDir = resolve(String(flags['agents-dir'] || 'agents'));
  if (!existsSync(agentsDir)) die(2, `no agents directory at ${agentsDir}`);
  let registry = { schema: 'prompt-registry/v1', entries: [] };
  if (existsSync(path)) {
    try { registry = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, `invalid registry: ${e.message}`); }
  }
  const byId = new Map(registry.entries.map((entry) => [entry.id, entry]));
  const now = String(flags.now || new Date().toISOString().slice(0, 10));
  const seen = new Set();
  for (const file of readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort()) {
    const id = basename(file, '.md');
    seen.add(id);
    const hash = createHash('sha256').update(readFileSync(resolve(agentsDir, file))).digest('hex');
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id, version: '1.0.0', owner: id, eval_suite: 'eval/manifest.json', validated_on: now,
        change_reason: 'initial registration', rollback_version: '0.0.0', content_hash: hash,
      });
    } else if (existing.content_hash !== hash) {
      const [major, minor, patch] = String(existing.version).replace(/^v/, '').split('.').map(Number);
      byId.set(id, {
        ...existing, version: `${major}.${minor}.${Number(patch || 0) + 1}`, validated_on: now,
        change_reason: 'agent file content changed', rollback_version: existing.version, content_hash: hash,
      });
    }
  }
  for (const id of [...byId.keys()]) if (!seen.has(id)) byId.delete(id); // a deleted role loses its entry, not a stale one nobody reads
  registry.entries = [...byId.values()];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
  console.log(`PROMPT REGISTRY: SYNCED — ${registry.entries.length} entr${registry.entries.length === 1 ? 'y' : 'ies'}`);
}

if (command === 'sync') { cmdSync(flags); process.exit(0); }

if (!existsSync(path)) die(2, `no registry at ${path}`);
let registry; try { registry = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { die(2, `invalid registry: ${e.message}`); }
if (registry.schema !== 'prompt-registry/v1' || !Array.isArray(registry.entries)) die(2, 'registry must use schema prompt-registry/v1 with entries');
const errors = []; const seen = new Set();
for (const entry of registry.entries) {
  for (const field of ['id', 'version', 'owner', 'eval_suite', 'validated_on', 'change_reason', 'rollback_version']) if (!entry[field]) errors.push(`${entry.id || '(unknown)'}: missing ${field}`);
  if (!entry.id || seen.has(entry.id)) errors.push(`${entry.id || '(unknown)'}: duplicate id`); else seen.add(entry.id);
  if (entry.version && !/^v?\d+\.\d+\.\d+$/.test(entry.version)) errors.push(`${entry.id}: version must be semantic major.minor.patch`);
  if (entry.rollback_version && entry.rollback_version === entry.version) errors.push(`${entry.id}: rollback_version must differ from current version`);
  if (entry.precedence && !['constitutional', 'project', 'ticket', 'role', 'retrieved'].includes(entry.precedence)) errors.push(`${entry.id}: invalid precedence`);
}
if (errors.length) { errors.forEach((error) => console.error(`prompt-registry: ${error}`)); process.exit(1); }
console.log(`PROMPT REGISTRY: CLEAR — ${registry.entries.length} versioned entr${registry.entries.length === 1 ? 'y' : 'ies'}`);
