#!/usr/bin/env node
/** Validate a requested operation against an explicit role capability manifest. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`capability-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['manifest', 'role', 'operation', 'path']), die });
const manifestPath = resolve(String(flags.manifest || 'docs/team/capabilities.json'));
if (!existsSync(manifestPath)) die(2, `no capability manifest at ${manifestPath}`);
let manifest; try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch (e) { die(2, e.message); }
if (manifest.schema !== 'capability-manifest/v1' || !Array.isArray(manifest.roles)) die(2, 'manifest must use schema capability-manifest/v1 with roles');
const role = manifest.roles.find((entry) => entry.role === flags.role); if (!role) die(1, `role is not declared: ${flags.role || '(missing)'}`);
if (!flags.operation || !role.operations?.includes(flags.operation)) die(1, `${flags.role} is not allowed operation ${flags.operation || '(missing)'}`);
if (flags.path) {
  const base = resolve(dirname(manifestPath), String(manifest.root || '.'));
  const target = relative(base, resolve(String(flags.path)));
  if (role.denied_paths?.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) die(1, `${flags.role} is denied path ${target}`);
  if (role.allowed_paths?.length && !role.allowed_paths.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) die(1, `${flags.role} is outside allowed paths: ${target}`);
}
console.log(`CAPABILITY CHECK: CLEAR — ${flags.role} may ${flags.operation}${flags.path ? ` ${flags.path}` : ''}`);
