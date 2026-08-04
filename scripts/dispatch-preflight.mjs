#!/usr/bin/env node
/** Unified dispatch gate composing context, scheduling, capability, and risk checks. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/args.mjs';
const die = (code, message) => { process.stderr.write(`dispatch-preflight: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'context', 'schedule', 'capability', 'risk', 'role', 'operation', 'path', 'file', 'change', 'ticket']), die });
/**
 * ALL MISSING ARGUMENTS AT ONCE, AND A USAGE ERROR IS NOT A CANNOT-EVALUATE.
 *
 * This was a loop that `die`d on the FIRST missing flag with exit 2. Measured in dogfood run 1:
 * dispatching ONE ticket took ELEVEN consecutive invocations, each disclosing exactly one more
 * required argument. I had the whole repository open and it still took eleven tries; an agent with
 * a retry budget would exhaust it, having learned nothing — each refusal names one flag and hides
 * the other nine.
 *
 * The dangerous half is the EXIT CODE, not the friction. In this studio's contract 2 means CANNOT
 * EVALUATE — the gate could not run — and several paths are documented to record that and DEGRADE.
 * So a malformed invocation was indistinguishable from a broken host, and the failure mode was not
 * "the orchestrator gets stuck": it was an orchestrator concluding preflight is unavailable and
 * SPAWNING THE AGENT ANYWAY. DR4-001, inside the gate that authorises every spawn.
 *
 * Exit 64 is `EX_USAGE` from sysexits.h — the Unix convention for "your command line is wrong",
 * distinct from both "blocked" and "could not evaluate". A caller that degrades on 2 must not
 * degrade on this.
 */
const REQUIRED = ['root', 'context', 'schedule', 'capability', 'risk', 'role', 'operation', 'path', 'file', 'ticket'];
const missing = REQUIRED.filter((name) => !flags[name]);
if (missing.length) {
  die(64,
    `missing required argument(s): ${missing.map((m) => `--${m}`).join(' ')}\n` +
    `  usage: dispatch-preflight.mjs ${REQUIRED.map((r) => `--${r} <value>`).join(' ')} [--change <kind>]\n` +
    '  This is a malformed invocation (exit 64), NOT a gate that could not evaluate (exit 2).\n' +
    '  Do not degrade or proceed without preflight on this exit code — fix the call.');
}
const root = resolve(String(flags.root)); const here = dirname(fileURLToPath(import.meta.url));
function run(script, args) {
  try { return execFileSync(process.execPath, [resolve(here, script), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { const output = `${error.stdout || ''}${error.stderr || ''}`.trim(); die(typeof error.status === 'number' && error.status === 2 ? 2 : 1, `${script} failed:\n${output}`); }
}
const context = run('context-manifest.mjs', ['verify', '--root', root, '--manifest', resolve(root, String(flags.context))]);
const schedule = run('scheduler.mjs', ['--plan', resolve(root, String(flags.schedule))]);
const capability = run('capability-check.mjs', ['--manifest', resolve(root, String(flags.capability)), '--role', String(flags.role), '--operation', String(flags.operation), '--path', resolve(root, String(flags.path))]);
const risk = run('risk-router.mjs', ['--policy', resolve(root, String(flags.risk)), '--file', String(flags.file), '--change', String(flags.change || '')]);

// CONTENTION IS COMPOSED HERE, because a detector nobody calls is FC-002 with extra steps.
//
// `contention-check.mjs` was written, tested and mirror-tested, and NOTHING INVOKED IT — measured
// in dogfood run 1, where two tickets declaring the same file would both have been dispatched.
// The PR that added it said so in its own "Not checked" section; a real run is what turned that
// admission into a fix.
//
// Exit 2 (the ticket declares no files, so overlap is unknowable) is deliberately NOT fatal here:
// it is reported and dispatch continues, because most tickets legitimately predate `--file` and
// blocking them would make the studio unusable to buy a guarantee it cannot offer anyway. What it
// must never do is print CLEAR — and it does not; it says CANNOT EVALUATE in its own words.
let contention = '';
try {
  contention = execFileSync(process.execPath, [
    resolve(here, 'contention-check.mjs'),
    '--log', resolve(root, 'docs/31-board-events.jsonl'),
    '--ticket', String(flags.ticket),
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch (error) {
  const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
  if (error.status === 1) {
    die(1, `contention-check refused this dispatch:\n${output}`);
  }
  contention = output || 'CONTENTION: CANNOT EVALUATE';
}

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
