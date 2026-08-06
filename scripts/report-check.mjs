#!/usr/bin/env node
/**
 * report-check — does the agent's returned report satisfy the output contract its role declares?
 *
 * FOUND BY SPAWNING ONE AGENT, 2026-08-06 (H4). `team-doctor` enforces that every ticket-owning
 * role FILE declares six fields — Worktree, Mutation confirmed, Daily fragment, Assumptions & open
 * questions, Second-path check, Shared surfaces touched — because `/app-build`'s gates parse them.
 * Nothing had ever checked that an agent RETURNS them.
 *
 * The first agent ever measured returned ONE of six. It also reported "no git repo initialized in
 * this worktree" about a directory that is a git repository, made no commit, and reported DONE —
 * so `verify-done.sh` came back REJECTED with "nothing was actually written" and the ticket parked
 * at in_progress.
 *
 * The gates worked. The HANDOFF did not, and the handoff was the half nobody was checking. That is
 * FC-002 — "the rule that cannot fail" — sitting exactly at the boundary where this studio meets
 * its own workers: the contract was enforced against the instruction file and never against the
 * thing the instruction was supposed to produce.
 *
 * WHY A SEPARATE CHECK RATHER THAN TRUSTING THE READER. `/app-build` step 3 says to read the
 * agent's report and act on its fields. A human or an orchestrating model reading a plausible,
 * well-written report will supply the missing structure from imagination — the report above SOUNDED
 * complete, named its skips, and explained itself. It was still missing five of six fields and had
 * committed nothing. Reading is exactly what does not catch this.
 *
 * TIERS mirror team-doctor's, so a role cannot owe one thing to the doctor and another here.
 *
 * Usage:  report-check.mjs --role <role> --report <file>
 *         report-check.mjs --role <role>            (reads the report on stdin)
 * Exit:   0 every required field present
 *         1 a required field is missing — the DONE is not actionable
 *         2 cannot evaluate — unknown role, or no report to read
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';

const die = (code, message) => { process.stderr.write(`report-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['role', 'report']), die });

// Kept identical to team-doctor's CODE_CONTRACT / ARTIFACT_CONTRACT. If these drift, a role owes
// one contract to the doctor and a different one to the loop — which is the two-truths defect this
// repository has paid for more than once.
const CODE_CONTRACT = [
  'Worktree:', 'Mutation confirmed:', 'Daily fragment:',
  'Assumptions & open questions:', 'Second-path check:', 'Shared surfaces touched:',
];
const ARTIFACT_CONTRACT = ['Worktree:', 'Daily fragment:', 'Assumptions & open questions:'];

const CODE_ROLES = new Set(['ios-developer', 'android-developer', 'backend-developer', 'web-developer',
  'monetization-engineer', 'devops-engineer', 'test-automation-engineer']);
const ARTIFACT_ROLES = new Set(['ux-architect', 'product-designer', 'product-manager', 'product-researcher',
  'qa-engineer', 'data-analyst', 'aso-specialist']);

const role = String(flags.role || '');
if (!role) die(2, 'need --role <role>');
const required = CODE_ROLES.has(role) ? CODE_CONTRACT : ARTIFACT_ROLES.has(role) ? ARTIFACT_CONTRACT : null;
if (!required) {
  die(2, `"${role}" is not a ticket-owning role in either contract tier.\n` +
         '  Only roles that return a DONE have a report contract. If this role should have one, add\n' +
         '  it to the same tier in scripts/team-doctor.mjs so the two cannot disagree.');
}

let text = '';
if (typeof flags.report === 'string') {
  const p = resolve(String(flags.report));
  if (!existsSync(p)) die(2, `no report at ${flags.report}`);
  text = readFileSync(p, 'utf8');
} else {
  try { text = readFileSync(0, 'utf8'); } catch { text = ''; }
}
if (!text.trim()) die(2, 'no report to check — pass --report <file> or pipe it on stdin');

const missing = required.filter((field) => !text.includes(field));
if (!missing.length) {
  process.stdout.write(`REPORT CHECK: CLEAR — ${role} returned all ${required.length} contract field(s)\n`);
  process.exit(0);
}

process.stdout.write(
  `REPORT CHECK: INCOMPLETE — ${role} returned ${required.length - missing.length} of ${required.length} contract field(s)\n\n` +
  missing.map((m) => `  MISSING  ${m}`).join('\n') + '\n\n' +
  '  Each missing field is a gate that will now silently do nothing for this ticket:\n' +
  '    Worktree:                     isolation was never confirmed\n' +
  '    Mutation confirmed:           nothing states the change was actually written and committed\n' +
  '    Daily fragment:               the standup has no input from this run\n' +
  '    Assumptions & open questions: guesses stay unrouted and the next wave inherits them\n' +
  '    Second-path check:            the FC-001 sweep for other writers of this value never happened\n' +
  '    Shared surfaces touched:      a file collision with a parallel agent goes unnoticed\n' +
  '\n  Re-spawn the agent asking for the missing fields specifically. Do NOT fill them in yourself —\n' +
  '  a field the orchestrator invents is a claim nobody made, recorded as though someone did.\n'
);
process.exit(1);
