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
 * PRESENCE IS NOT TRUTH — FOUND BY THE SAME METHOD AS H4, ONE DAY LATER (H5b, 2026-08-07). A
 * second agent, dispatched correctly this time (the contract inlined in the prompt, as
 * `parallel-orchestrator` step 4 requires), returned all six fields. This script said CLEAR. Every
 * field was then verified independently rather than trusted, and one was false: `Daily fragment:
 * docs/daily/<date>-ios-developer-APP-001.md` named a real, well-written file that existed on
 * disk in the worktree and had never been `git add`ed — so it was not on the branch, exactly the
 * "uncommitted work reported as done" shape H4 found in the code diff, surviving in the one field
 * this checker had no way to catch, because checking that text CONTAINS a field is not checking
 * that the field is TRUE.
 *
 * `agent-isolation`'s own output contract already draws this line for the code diff — "Mutation
 * confirmed: git diff --numstat -> <N files, +A/-B>" exists so the CLAIM is checkable against git,
 * not so it reads well. The daily fragment had a field but no equivalent confirmation. So with
 * `--root` and a resolvable `Branch:` line, this now runs the same class of check: `git show
 * <branch>:<path>`. Without `--root` it falls back to presence-only and SAYS SO on the CLEAR line,
 * because a check that silently downgrades is the exact defect this whole file exists to refuse.
 *
 * Usage:  report-check.mjs --role <role> --report <file> [--root <project-root>]
 *         report-check.mjs --role <role>            (reads the report on stdin)
 * Exit:   0 every required field present (and, with --root, verified true)
 *         1 a required field is missing, OR present but FALSE — the DONE is not actionable
 *         2 cannot evaluate — unknown role, no report to read, or --root given but not a git repo
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseArgs } from './lib/args.mjs';
import { contractFor } from './lib/contract.mjs';

const die = (code, message) => { process.stderr.write(`report-check: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['role', 'report', 'root']), die });

const role = String(flags.role || '');
if (!role) die(2, 'need --role <role>');
// `.checked` omits `Branch:` — it is required in the TEMPLATE (contractBlock, contract.mjs) because
// the daily-fragment truth check below needs it, but it was never one of the six report-check has
// always counted, and changing that count would silently invalidate every "returned all N" fixture
// this suite already carries.
const required = contractFor(role)?.checked ?? null;
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

/**
 * Verify the Daily fragment CLAIM against git, not just its presence in the text.
 *
 * Returns null when nothing could be checked (no --root, no parseable Branch:/Daily fragment:
 * line, or the branch does not exist) — a caller must treat null as "unverified", never as "false".
 * A project that has not adopted --root yet must keep working exactly as before.
 */
function verifyDailyFragment() {
  if (typeof flags.root !== 'string') return null;
  const branchLine = text.match(/^Branch:\s*(\S+)/m);
  const fragmentLine = text.match(/^Daily fragment:\s*(\S+)/m);
  if (!branchLine || !fragmentLine) return null;
  const root = resolve(String(flags.root));
  try {
    execFileSync('git', ['show', `${branchLine[1]}:${fragmentLine[1]}`], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    return { ok: true, branch: branchLine[1], path: fragmentLine[1] };
  } catch {
    // Distinguish "the branch itself doesn't exist" (verify-done's job, not this file's) from
    // "the branch exists and the file is not on it" (this file's finding).
    try { execFileSync('git', ['rev-parse', '--verify', branchLine[1]], { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] }); }
    catch { return null; }
    return { ok: false, branch: branchLine[1], path: fragmentLine[1] };
  }
}
const fragmentTruth = missing.includes('Daily fragment:') ? null : verifyDailyFragment();

if (!missing.length && fragmentTruth?.ok !== false) {
  const verified = fragmentTruth?.ok === true;
  process.stdout.write(
    `REPORT CHECK: CLEAR — ${role} returned all ${required.length} contract field(s)` +
    `${verified ? ' (Daily fragment VERIFIED on the branch)' : ' — presence only; pass --root to verify the Daily fragment claim against git'}\n`
  );
  process.exit(0);
}

if (fragmentTruth?.ok === false) {
  process.stdout.write(
    `REPORT CHECK: FALSE CLAIM — ${role}'s "Daily fragment: ${fragmentTruth.path}" is not on branch "${fragmentTruth.branch}".\n\n` +
    '  The path exists somewhere — on disk, in the worktree, possibly well-written — and was never\n' +
    '  `git add`ed and committed. This is the same claim/verification gap H4 found in the code diff\n' +
    '  (a DONE reported over uncommitted work), surviving in the one field presence-checking cannot\n' +
    '  catch. ic-workflow step 8 says to commit the fragment WITH the change; it was not.\n\n' +
    '  Re-spawn the agent to stage and commit the fragment on this branch. Do NOT commit it\n' +
    '  yourself from the orchestrator — a fragment you commit on the agent\'s behalf is a claim\n' +
    '  nobody made, recorded as though someone did.\n'
  );
  process.exit(1);
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
