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
  // THE ROOT MUST BE DECLARED, NOT INFERRED.
  //
  // This defaulted to `.` — the MANIFEST'S OWN DIRECTORY — so a manifest at docs/team/ silently
  // required every `allowed_paths` entry to be written relative to docs/team. Nothing said so.
  // Measured in dogfood run 1: a manifest granting `scripts` to a developer refused
  // `scripts/lib/args.mjs` as "outside allowed paths: ../../scripts/lib/args.mjs" — a refusal whose
  // own message contains the explanation, which nobody reads as a configuration bug.
  //
  // Silent path-root ambiguity in the gate that decides WHAT AN AGENT MAY WRITE is the audit's
  // P0-04, and it fails in both directions: it can refuse legitimate work (observed), and a
  // manifest authored against the other assumption would GRANT paths nobody meant to grant.
  //
  // So the root is now required. An undeclared root is CANNOT EVALUATE, because guessing which of
  // two plausible bases the author meant is exactly the guess that produced this.
  if (manifest.root === undefined) {
    die(2, `${manifestPath} declares no "root" — capability paths would be resolved against the manifest's own directory, which is almost never what the author meant.\n` +
           '  Add "root": "../.." (for a manifest in docs/team/) or the project-relative base the allowed_paths are written against.');
  }
  const base = resolve(dirname(manifestPath), String(manifest.root));
  // Resolved against the manifest's own root, not the caller's process cwd — a relative --path is
  // meaningless otherwise: dispatch-preflight always passes an absolute path (resolve() then leaves
  // it untouched), but a human or agent invoking this directly types a path relative to the project
  // the manifest governs, which is not necessarily the shell's current directory.
  const target = relative(base, resolve(base, String(flags.path)));
  // MANIFEST-LEVEL DENY, applying to EVERY role including ones added later.
  //
  // Added with its enforcement in the same commit, deliberately. The first draft of this change put
  // `deny_all` in the manifest and nothing read it — a field that looks like a control and is
  // decoration, which is the precise defect this session has spent the day removing from other
  // people's work and then reproduced in its own.
  //
  // Its first entry is docs/team/actors.json: the secret store. That does NOT make secrets safe (an
  // agent that ignores this gate can still read the file — see the bound stated in lib/actor.mjs);
  // it makes the intent CHECKABLE instead of assumed, and it means a role added tomorrow inherits
  // the prohibition rather than needing to remember it.
  const denyAll = Array.isArray(manifest.deny_all) ? manifest.deny_all : [];
  if (denyAll.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) {
    die(1, `${target} is denied to EVERY role by the manifest's deny_all (not a per-role rule)`);
  }
  if (role.denied_paths?.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) die(1, `${flags.role} is denied path ${target}`);
  if (role.allowed_paths?.length && !role.allowed_paths.some((prefix) => target === prefix || target.startsWith(`${prefix}/`))) die(1, `${flags.role} is outside allowed paths: ${target}`);
}
console.log(`CAPABILITY CHECK: CLEAR — ${flags.role} may ${flags.operation}${flags.path ? ` ${flags.path}` : ''}`);
