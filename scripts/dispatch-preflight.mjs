#!/usr/bin/env node
/** Unified dispatch gate composing context, scheduling, capability, and risk checks. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`dispatch-preflight: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'context', 'schedule', 'capability', 'risk', 'role', 'operation', 'path', 'file', 'change', 'ticket']), die });
for (const name of ['root', 'context', 'schedule', 'capability', 'risk', 'role', 'operation', 'path', 'file', 'ticket']) if (!flags[name]) die(2, `--${name} is required`);
const root = resolve(String(flags.root)); const here = dirname(fileURLToPath(import.meta.url));
function run(script, args) {
  try { return execFileSync(process.execPath, [resolve(here, script), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { const output = `${error.stdout || ''}${error.stderr || ''}`.trim(); die(typeof error.status === 'number' && error.status === 2 ? 2 : 1, `${script} failed:\n${output}`); }
}
const context = run('context-manifest.mjs', ['verify', '--root', root, '--manifest', resolve(root, String(flags.context))]);
const schedule = run('scheduler.mjs', ['--plan', resolve(root, String(flags.schedule))]);
const capability = run('capability-check.mjs', ['--manifest', resolve(root, String(flags.capability)), '--role', String(flags.role), '--operation', String(flags.operation), '--path', resolve(root, String(flags.path))]);
const risk = run('risk-router.mjs', ['--policy', resolve(root, String(flags.risk)), '--file', String(flags.file), '--change', String(flags.change || '')]);

// Global plugin enhancement plan (2026-08-03), P0.2's narrow first slice: this gate ran every check
// EXCEPT the one that answers "is the requested ticket actually admissible right now" — a caller
// could pass any `--role`/`--operation`/`--path` and get a CLEAR with no ticket in the picture at
// all, so two agents (or one agent twice) could each pass preflight for the same non-ready ticket.
// The scheduler's own `ready` list is the one thing in this file that already answers that; this
// just requires the caller to name the ticket and checks it against that list rather than trusting
// the caller's own belief that its ticket is ready.
const scheduleResult = JSON.parse(schedule);
const ticket = String(flags.ticket);
if (!scheduleResult.ready.includes(ticket)) {
  die(
    1,
    `ticket ${ticket} is not in the scheduler's ready set — ready: [${scheduleResult.ready.join(', ') || 'none'}], ` +
      `deferred: [${scheduleResult.deferred.join(', ') || 'none'}]`
  );
}

// `audit-anchor`, `prompt-registry`, and `eval-lab` were previously reachable only through
// `ship-gate.sh` at release time — a project's audit tip could drift, its prompt registry could go
// stale, or its eval baseline could rot for an entire sprint before anything noticed, because
// nothing ran these checks before that. Every spawn now composes them too, still gated by the same
// `.studio-policy.json` flags `ship-gate.sh` reads, so a project that has not opted in pays nothing
// extra — drift is caught at the next spawn, not at the release that happens to follow it.
const policyPath = resolve(root, '.studio-policy.json');
let policy = {};
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); }
  catch (error) { die(2, `cannot read .studio-policy.json: ${error.message}`); }
}
const revamp = {};
if (policy.requireAuditAnchor) {
  revamp.auditAnchor = run('audit-anchor.mjs', ['verify', '--log', resolve(root, 'docs/31-board-events.jsonl'), '--out', resolve(root, 'docs/team/audit-anchor.json')]);
}
if (policy.requirePromptRegistry) {
  revamp.promptRegistry = run('prompt-registry.mjs', ['--registry', resolve(root, 'docs/team/prompt-registry.json')]);
}
if (policy.requireEvaluation) {
  revamp.evalLab = run('eval-lab.mjs', ['--manifest', resolve(root, 'eval/manifest.json')]);
}

console.log(JSON.stringify({ schema: 'dispatch-preflight/v1', status: 'CLEAR', ticket, role: flags.role, operation: flags.operation, context, schedule: scheduleResult, capability, risk: JSON.parse(risk), revamp }, null, 2));
