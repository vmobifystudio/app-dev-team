#!/usr/bin/env node
/** Validate a versioned prompt/policy registry; registry entries are reviewable data, not prose. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`prompt-registry: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['registry']), die });
const path = resolve(String(flags.registry || 'docs/team/prompt-registry.json'));
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
