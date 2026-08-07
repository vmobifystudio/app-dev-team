#!/usr/bin/env node
/**
 * ci-status — what did CI last say about the integration branch, and may this round start?
 *
 * THE MEASURED PROBLEM (OPS-001, docs/reviews/2026-08-07-adversarial-operations-review.md).
 * `knowledge/git-workflow.md` states, as house law: "A clean build + green tests is a hard merge
 * gate." Nothing implemented it. The merge gate is `board.mjs move <ID> merged`, which re-derives
 * exactly one thing from the event log — that a non-owner `approved` exists — and reads no workflow
 * conclusion, no check run, and nothing at all on the server. Grepping the whole plugin for a CI
 * status read returned TWO hits, both inside `repo-controls.sh`, which only REPORTS whether
 * server-side protection is configured and whose `--print` output `devops-engineer` is explicitly
 * forbidden from executing.
 *
 * So on any project where the user has not personally configured branch protection — the default
 * state of every project this studio creates — work merged to the integration branch with CI never
 * consulted in either direction. CI ran after the push; if it went red, nothing read it, nothing
 * blocked the next merge, and the standup did not mention it. A rule with no enforcing mechanism,
 * which is precisely what `docs/25-engineering-rules.md` exists to refuse.
 *
 * WHY THIS IS A ROUND-START CHECK AND NOT A MERGE-TIME ONE — the design decision worth defending.
 * Waiting on a workflow at merge time would make every merge block on a remote runner for minutes,
 * put an agent in a polling loop, and give the studio a reason to acquire the ability to trigger and
 * re-run workflows. None of that is wanted. Reading the PREVIOUS run's conclusion at the top of the
 * next round costs one command, blocks nothing, and still means a red integration branch stops the
 * studio before it piles more work on top of it. Combined with one push per wave
 * (`wave-integrate.mjs`), there is exactly one CI run per wave and exactly one reader of it.
 *
 * NO AGENT MAY TRIGGER, RE-RUN, OR CANCEL A WORKFLOW. This script only ever runs `gh run list`,
 * which is read-only. That boundary is deliberate: CI cost is the operator's, and a studio that can
 * start its own builds can spend without limit.
 *
 * OPT-IN, LIKE EVERY OTHER POLICY GATE HERE. Without `"requireCiGreen": true` in
 * `.studio-policy.json` this reports its finding and exits 0 — because a project with no `gh`, no
 * remote, or no CI at all is an ordinary project, and a gate that deadlocks those is a gate whose
 * first user turns it off. That is the same shape as `requireApprovalBinding`, `requireAuditAnchor`
 * and `requireEvaluation`, and it is checked the same way.
 *
 * Usage:
 *   ci-status.mjs [--root <path>] [--base <branch>] [--json]
 *
 * Exit codes (before the policy softening described above):
 *   0  PASS             — the most recent completed run on the integration branch succeeded
 *   1  FAIL             — it failed, was cancelled, or timed out, and no waiver covers that commit
 *   2  CANNOT EVALUATE  — no `gh`, not authenticated, no remote, no runs yet, or a run still going.
 *                         Never a pass: "we could not ask" and "it is green" are different answers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`ci-status: ${message}\n`); process.exit(code); };

const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'base', 'waiver']),
  die,
});

let ROOT;
if (typeof flags.root === 'string') {
  ROOT = resolve(flags.root);
} else {
  const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  ROOT = resolved.root;
}

// --- is this gate armed for this project? -------------------------------------------------------
let policy = {};
const policyPath = resolve(ROOT, '.studio-policy.json');
if (existsSync(policyPath)) {
  try { policy = JSON.parse(readFileSync(policyPath, 'utf8')); }
  catch (e) { die(2, `cannot read .studio-policy.json: ${e.message}`); }
}
const ARMED = policy.requireCiGreen === true;

// --- which branch ---------------------------------------------------------------------------------
//
// Resolved through the SAME resolver every other caller uses, never hardcoded to `main`. The
// flagship model integrates on `develop`; asking GitHub about the wrong branch would answer a
// question nobody asked and answer it confidently.
let BASE = typeof flags.base === 'string' ? flags.base : '';
if (!BASE) {
  // spawnSync, not execFileSync. `integration-branch.sh` exits 2 when a project declares a branch
  // that does not exist — deliberately, since M10 exists to keep it from falling back — and
  // execFileSync THROWS on a non-zero exit. That threw an unhandled stack trace out of a round
  // precondition, which is the worst possible shape for a gate: not PASS, not FAIL, not CANNOT
  // EVALUATE, just a crash the caller has to interpret. Caught in review of this file's own diff.
  const r = spawnSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    die(2, `the integration branch could not be resolved:\n${(r.stdout || r.stderr || '').trim()}\n` +
           '  Declare it in docs/23-git-strategy.md as: Integration branch: <name>\n' +
           '  Asking GitHub about a guessed branch answers a question nobody asked, confidently.');
  }
  BASE = (r.stdout || '').trim();
}
if (!BASE) die(2, 'the integration branch could not be resolved, so there is no branch to ask CI about.\n  Declare it in docs/23-git-strategy.md as: Integration branch: <name>');

// --- ask GitHub ------------------------------------------------------------------------------------
const report = (state, code, lines, extra = {}) => {
  const payload = { schema: 'ci-status/v1', state, base: BASE, armed: ARMED, ...extra };
  if (flags.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    // LINE 1 MUST MATCH THE EXIT CODE — this repo's law, and this file broke it.
    //
    // Unarmed, the exit is softened to 0 so an ordinary project without `gh` is not deadlocked
    // (that part is right). But line 1 still read `CI STATUS: FAIL` while the process exited 0, and
    // an agent reads line 1 and acts on it — the same defect `verify-done.sh`'s header describes
    // fixing, where it printed "VERIFIED:" while exiting 2. The verdict is still stated; it is
    // stated as what it is, which is advice.
    const headline = ARMED || code === 0 ? state : `ADVISORY (${state})`;
    process.stdout.write(`CI STATUS: ${headline} — branch ${BASE}\n`);
    for (const l of lines) process.stdout.write(`  ${l}\n`);
    if (!ARMED && code !== 0) {
      process.stdout.write(
        '\n  ADVISORY ONLY — `.studio-policy.json` does not set "requireCiGreen": true, so this does\n' +
        '  not stop the round. Arm it when the project has CI you intend to trust; until then this\n' +
        '  is a report, and reporting it is still better than the silence it replaced.\n'
      );
    }
  }
  process.exit(ARMED ? code : 0);
};

let runs;
try {
  const out = execFileSync('gh', [
    'run', 'list', '--branch', BASE, '--limit', '5',
    '--json', 'conclusion,status,workflowName,headSha,url,createdAt',
  ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  runs = JSON.parse(out);
} catch (e) {
  const why = String(e.stderr || e.message || '').trim().split('\n')[0] || 'gh could not be run';
  report('CANNOT EVALUATE', 2, [
    `gh run list failed: ${why}`,
    'Causes, all ordinary: `gh` is not installed, you are not authenticated, this repo has no',
    'GitHub remote, or the project has no Actions workflows at all.',
    'This is NOT a pass. It means nobody asked, which is exactly the state this gate replaced.',
  ], { reason: why });
}

if (!Array.isArray(runs) || !runs.length) {
  report('CANNOT EVALUATE', 2, [
    `no workflow runs recorded for ${BASE} yet.`,
    'A branch CI has never run on is UNKNOWN, not green. Push once and re-ask, or say so in the',
    'standup and proceed deliberately.',
  ], { runs: [] });
}

const inFlight = runs.find((r) => r.status !== 'completed');
const completed = runs.filter((r) => r.status === 'completed');
if (!completed.length) {
  report('CANNOT EVALUATE', 2, [
    `a run is still ${inFlight?.status ?? 'in flight'} on ${BASE} and none has completed.`,
    'Do not treat a running build as a green one. Re-ask in a few minutes.',
    inFlight?.url ? `  ${inFlight.url}` : '',
  ].filter(Boolean), { pending: inFlight ?? null });
}

const latest = completed[0];
const GREEN = new Set(['success', 'neutral', 'skipped']);

if (GREEN.has(latest.conclusion)) {
  report('PASS', 0, [
    `${latest.workflowName}: ${latest.conclusion} on ${String(latest.headSha).slice(0, 8)} (${latest.createdAt})`,
    latest.url,
    inFlight ? `NOTE: a newer run is still ${inFlight.status}; this verdict is about the last COMPLETED one.` : '',
  ].filter(Boolean), { run: latest });
}

// --- a waiver, and why it is pinned to a commit -----------------------------------------------------
//
// CI goes red for reasons that are not the code: a runner outage, an expired secret, a rate limit.
// Refusing to let the studio work at all in that case is how a gate gets deleted. So a waiver
// exists — and it names the exact SHA it forgives, because a blanket "CI is broken, ignore it"
// waiver survives the outage by weeks and silently covers the next real failure. That is the
// difference between a decision and a switch someone left on.
const waiverPath = typeof flags.waiver === 'string' ? resolve(flags.waiver) : resolve(ROOT, 'docs/team/ci-waiver.json');
let waiver = null;
if (existsSync(waiverPath)) {
  try { waiver = JSON.parse(readFileSync(waiverPath, 'utf8')); }
  catch (e) { die(2, `cannot read the CI waiver at ${waiverPath}: ${e.message}`); }
}
if (waiver && waiver.sha && String(waiver.sha) === String(latest.headSha) && waiver.reason && waiver.by) {
  report('PASS', 0, [
    `${latest.workflowName}: ${latest.conclusion} on ${String(latest.headSha).slice(0, 8)} — WAIVED`,
    `waived by ${waiver.by}: ${waiver.reason}`,
    'The waiver names this exact commit. The next commit re-asks, which is the whole point.',
  ], { run: latest, waiver });
}

report('FAIL', 1, [
  `${latest.workflowName}: ${latest.conclusion} on ${String(latest.headSha).slice(0, 8)} (${latest.createdAt})`,
  latest.url,
  '',
  'The integration branch is red. Do not start a round on top of it — every ticket this wave',
  'produces will be diffed, reviewed and merged against a base that is already failing, and the',
  'first person to notice will be whoever tries to ship.',
  '',
  'Fix it, or record a waiver naming THIS commit if the failure is environmental:',
  `  ${waiverPath}`,
  `  {"sha": "${latest.headSha}", "by": "<role>", "reason": "<why this is not the code>"}`,
  waiver ? `NOTE: a waiver exists but names ${String(waiver.sha).slice(0, 8)}, not this commit — it does not apply.` : '',
].filter(Boolean), { run: latest, waiver });
