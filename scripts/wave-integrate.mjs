#!/usr/bin/env node
/**
 * wave-integrate — merge the wave once, build it once, test it once, push it once.
 *
 * THE MEASURED PROBLEM (OPS-002 / OPS-003 / OPS-008,
 * docs/reviews/2026-08-07-adversarial-operations-review.md). The loop paid per TICKET for a signal
 * that is only meaningful per WAVE:
 *
 *   - `verify-done.sh` ran the test command per ticket, in a worktree that had never built before
 *     (and, on the `mktemp -d` path, one it then deleted). Three tickets = three cold builds. At the
 *     six-retry spawn budget, ONE ticket = seven.
 *   - `tech-manager.md` merge gate step 3 ran `git push origin "$BASE"` per ticket, so a three-ticket
 *     wave started three CI runs on the integration branch — on macOS runners for iOS, at roughly
 *     ten times the ubuntu rate — and OPS-001 established that nothing read any of them.
 *   - A merge conflict re-spawned the original developer COLD to perform a rebase whose conflict
 *     hunks the manager was already holding, and the `merged` event had already been appended and
 *     cannot be retracted (which is why `merge-reconcile.mjs` had to exist).
 *
 * And the per-ticket build answered the wrong question anyway. `/app-build` step 5 already says so
 * about the runtime gate — "one app build per wave instead of one per ticket, run on the merged tree
 * — which is the only place 'three individually-approved tickets and no composition root' is visible
 * at all" — and then ran the per-ticket builds regardless.
 *
 * WHAT THIS DOES. In ONE dedicated worktree, off the integration branch:
 *
 *   1. merge every ticket whose board state says the gate passed, `--no-ff`, in board order;
 *   2. a conflict aborts THAT merge only, is reported with its files, and the rest continue — a
 *      conflicting ticket does not cost the wave;
 *   3. run the project's `full` test scope ONCE on the merged tree;
 *   4. attribute a failure to candidate tickets by their changed-file sets, and say plainly that a
 *      candidate list is not a verdict;
 *   5. print the exact board commands the outcome earns — `verified` per ticket on green, which is
 *      what upgrades the `verified_static` that `verify-done.sh --static` recorded per ticket;
 *   6. with `--push`, fast-forward the integration branch and push ONCE. One CI run per wave, which
 *      `ci-status.mjs` reads at the top of the next round.
 *
 * IT USES NO NEW BOARD EVENT AND NO SCHEMA CHANGE. `verified` is already legal from `qa`
 * (lib/events.mjs legalEvents: "so a ticket merged on a STATIC verification can be upgraded once the
 * executable suite finally runs"). That path existed and nothing ever walked it. This is what walks
 * it.
 *
 * WHAT IT WILL NOT DO, deliberately:
 *   - it never force-pushes, never rewrites the integration branch, and never resolves a conflict on
 *     its own. Conflicts are REPORTED with their files; `git-pr-strategy` §6 requires reading both
 *     sides and the governing spec, and a script that picks a side is picking one blind;
 *   - it never appends a board event. Every mutation of the board goes through `board.mjs` by a
 *     named role. This prints the commands; a human or the manager runs them;
 *   - it never triggers, re-runs or cancels a workflow. `--push` is an ordinary push.
 *
 * Usage:
 *   wave-integrate.mjs --wave <N> [--root <path>] [--base <branch>] [--test-command "..."] [--push]
 *   wave-integrate.mjs --wave <N> --dry-run        report what would be merged, touch nothing
 *   wave-integrate.mjs --wave <N> --check-baseline on a FAIL, also report whether $BASE (unmodified)
 *                                                   fails this same suite too — costs nothing on GREEN
 *
 * Exit codes:
 *   0  the wave merged clean and the suite ran green
 *   1  a merge conflicted, or the suite ran and FAILED. The wave does not advance.
 *   2  CANNOT EVALUATE — no base, no candidates, no test command declared, or the suite could not be
 *      executed here. Never a pass: a wave nobody could test is not a tested wave.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { parseEventLog, reduce } from './lib/events.mjs';
import { classifyTestRun } from './lib/test-evidence.mjs';
import { writeTestEvidence } from './lib/evidence.mjs';
import { RANK, routeFiles } from './lib/risk.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`wave-integrate: ${message}\n`); process.exit(code); };

const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'base', 'wave', 'test-command', 'log', 'dir']),
  die,
});
// --check-baseline: opt-in, additive, changes NOTHING about the default verdict. Mined from
// studying unohee/OpenSwarm's base-vs-head verification (docs/research/2026-08-10-...). Their
// version diffs individual failing-test NAMES between base and head — this repo's RAN-evidence work
// (three separate test-runner output-format gaps found across H7/H8/H9) is proof that per-framework
// output parsing is exactly the class of thing that is fragile and easy to get quietly wrong. This
// does the safe subset instead: a boolean comparison (did the UNCHANGED base ref also fail this same
// suite, yes or no), using the RAN/CANNOT_RUN detection already hardened three times over, no new
// parsing. It never turns a real failure into a pass — it only adds, on a FAIL, whether the failure
// pre-existed on $BASE, which is exactly the distinction that stops a wave being blamed for
// something already broken before it started.

let ROOT;
if (typeof flags.root === 'string') {
  ROOT = resolve(flags.root);
} else {
  const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  ROOT = resolved.root;
}
const LOG = typeof flags.log === 'string' ? resolve(flags.log) : resolve(ROOT, 'docs/31-board-events.jsonl');
const WAVE = String(flags.wave ?? '');
if (!WAVE) die(2, '--wave <N> is required. The wave number is part of the branch name and of every\n  message this prints, so a second wave cannot silently reuse the first one\'s branch.');

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const gitTry = (args, opts = {}) => { try { return { ok: true, out: git(args, opts) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; } };

if (!gitTry(['rev-parse', '--is-inside-work-tree']).ok) die(2, `not a git repository at ${ROOT} — there is nothing to integrate.`);

// --- the base, resolved once, never guessed ------------------------------------------------------
let BASE = typeof flags.base === 'string' ? flags.base : '';
if (!BASE) {
  const r = spawnSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    die(2, `the integration branch could not be resolved:\n${(r.stdout || r.stderr || '').trim()}\n` +
           '  Declare it in docs/23-git-strategy.md as: Integration branch: <name>\n' +
           '  Every base that could be substituted here is a guess, and merging a wave into the wrong\n' +
           '  branch is not recoverable by a later fix.');
  }
  BASE = (r.stdout || '').trim();
}
if (!gitTry(['rev-parse', '--verify', BASE]).ok) die(2, `the integration branch "${BASE}" does not exist in this repository.`);

// --- which tickets are in this wave ---------------------------------------------------------------
//
// A ticket is a candidate when the MERGE GATE has passed for it — status `qa` — and its branch is
// not already an ancestor of the base. That is the precise population `tech-manager` used to git-
// merge one at a time. Branch matching follows merge-reconcile.mjs exactly rather than inventing a
// second convention: two resolvers that disagree is worse than either being wrong.
if (!existsSync(LOG)) die(2, `no event log at ${LOG} — nothing says which tickets passed the merge gate.`);
let tickets;
try { tickets = reduce(parseEventLog(readFileSync(LOG, 'utf8')).events).tickets; }
catch (e) { die(2, `cannot read the event log: ${e.message}`); }

const branches = (gitTry(['branch', '--format=%(refname:short)']).out || '').split('\n').filter(Boolean);

/**
 * Branch matching, and the two ways the first version got it wrong (N2).
 *
 * It was `b.toLowerCase().includes(id.toLowerCase())`, which matches `APP-1` inside
 * `feat/APP-12-login` — so a wave could integrate a ticket nobody asked for. The id must be
 * followed by a non-alphanumeric character or the end of the string.
 *
 * And it then took `mine[0]`, computing `allBranches` and never printing it. A ticket with
 * `feat/APP-001-login` and `fix/APP-001-retry` integrated whichever sorted first, silently. This
 * file argues elsewhere that "two resolvers that disagree is worse than either being wrong"; an
 * arbitrary pick is that failure with no second resolver to blame. Ambiguity is now REPORTED and
 * the ticket is held out of the wave, because the one thing worse than not integrating a ticket is
 * integrating the wrong half of it.
 */
// TEMP until F1 merges: lib/integration.mjs `matchesTicket(name, id, allIds)` (design decision 4).
// Whole-token: `(^|/)ID(-[a-z]|$)`, and when a longer board id also matches (APP-001 vs
// APP-001-analytics) the longest id owns the branch.
const escRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenMatch = (name, id) => new RegExp(`(^|/)${escRe(id)}(-[a-z]|$)`, 'i').test(name);
const matchesTicket = (name, id, allIds = []) => tokenMatch(name, id)
  && !allIds.some((o) => String(o).length > String(id).length && tokenMatch(name, o));
const ALL_IDS = [...tickets.values()].map((t) => t.id);

const candidates = [];
const noBranch = [];
const ambiguous = [];
for (const t of tickets.values()) {
  if (t.status !== 'qa') continue;
  if (/^QA-/i.test(t.id)) continue; // docs-only, closes from `merged` without integration (design 1)
  const mine = branches.filter((b) => matchesTicket(b, t.id, ALL_IDS));
  if (!mine.length) { noBranch.push(t.id); continue; }
  const already = mine.filter((b) => gitTry(['merge-base', '--is-ancestor', b, BASE]).ok);
  // `already` used to be `.some()`: ANY matching branch being an ancestor skipped the ticket, so a
  // stale `fix/APP-001-retry` that had merged months ago hid an unintegrated `feat/APP-001-login`.
  const outstanding = mine.filter((b) => !already.includes(b));
  if (!outstanding.length) continue;
  if (outstanding.length > 1) { ambiguous.push({ id: t.id, branches: outstanding }); continue; }
  candidates.push({ id: t.id, branch: outstanding[0], allBranches: mine });
}

const reportAmbiguous = () => {
  if (!ambiguous.length) return;
  process.stdout.write(
    `\n  AMBIGUOUS — ${ambiguous.length} ticket(s) have more than one unintegrated branch, and this\n` +
    '  will not pick for you:\n' +
    ambiguous.map((a) => `      ${a.id}: ${a.branches.join(', ')}\n`).join('') +
    '    Merge or delete the one that is not the candidate, then re-run. Integrating an arbitrary\n' +
    '    half of a ticket is worse than integrating none of it.\n'
  );
};

if (!candidates.length) {
  process.stdout.write(
    `WAVE ${WAVE}: nothing to integrate into ${BASE}.\n` +
    `  ${[...tickets.values()].filter((t) => t.status === 'qa').length} ticket(s) are at \`qa\`; each is already an ancestor of ${BASE}, has no branch, or is ambiguous below.\n` +
    (noBranch.length ? `  NO BRANCH FOUND: ${noBranch.join(', ')} — reported, never assumed merged (merge-reconcile.mjs's rule).\n` : '')
  );
  reportAmbiguous();
  process.exit(2);
}

process.stdout.write(`WAVE ${WAVE} — ${candidates.length} ticket(s) to integrate into ${BASE}\n\n`);
for (const c of candidates) process.stdout.write(`  ${c.id.padEnd(16)} ${c.branch}\n`);
if (noBranch.length) process.stdout.write(`\n  NO BRANCH FOUND (not integrated, not assumed merged): ${noBranch.join(', ')}\n`);
reportAmbiguous();

if (flags['dry-run']) {
  process.stdout.write('\n  --dry-run: nothing was touched.\n');
  process.exit(0);
}

// --- the integration worktree ---------------------------------------------------------------------
//
// A DEDICATED worktree, not the main checkout and not any agent's slot. The main checkout may have
// an operator standing in it; an agent slot has a writer in it. Merging in either is the shared-tree
// collision this whole plugin exists to prevent, committed by the one process that holds every
// branch at once.
const WAVE_BRANCH = `integration/wave-${WAVE}`;

// INSIDE `.agent-wt/`, NOT in os.tmpdir() (N3).
//
// On every non-green outcome this sets `keep = true` and tells the operator the merged tree is
// preserved "so it can be built somewhere that has the toolchain". In tmpdir that promise is not
// kept: `worktree-reap` never sees the tree (it only walks `.agent-wt/`), so it is neither counted
// against the disk ceiling nor protected by the dirty check — and the OS may purge the one artifact
// the message exists to preserve. Under `.agent-wt/` the reaper counts it, reports it, and refuses
// to remove it while it holds uncommitted work.
const WT = resolve(ROOT, '.agent-wt', `integration-wave-${WAVE}`);
rmSync(WT, { recursive: true, force: true });   // `git worktree add` wants to create it itself

let created = false;
// `keep` is set on every exit path that leaves something a human must look at: a merged tree whose
// suite failed, or one that could not be tested here. Removing it would delete the only artifact
// the failure is about — and the branch alone is not enough, because the point of a wave build is
// the tree, not the diff.
let keep = false;
const cleanup = () => {
  if (!created || keep) return;
  gitTry(['worktree', 'remove', '--force', WT]);
  gitTry(['worktree', 'prune']);
  try { rmSync(WT, { recursive: true, force: true }); } catch { /* already gone */ }
};
process.on('exit', cleanup);

const GREEN_REF = `refs/studio/wave-green/${WAVE}`;
if (gitTry(['rev-parse', '--verify', WAVE_BRANCH]).ok) {
  // W6: `--wave N` ran green, then `--wave N --push` — the documented sequence — used to die here.
  // Land the branch only if its tip is EXACTLY the commit recorded green; anything else is unverified.
  const tip = gitTry(['rev-parse', WAVE_BRANCH]).out;
  const greenTip = gitTry(['rev-parse', '--verify', '--quiet', GREEN_REF]);
  if (flags.push && greenTip.ok && greenTip.out === tip) {
    process.stdout.write(`\n  ${WAVE_BRANCH} already exists at ${tip.slice(0, 8)}, the tip this wave integrated GREEN.\n` +
                         '  Pushing it as-is: nothing is re-merged and the suite is not re-run.\n');
    pushWave();
  }
  die(2, `${WAVE_BRANCH} already exists.\n` +
         '  A second run of the same wave would merge on top of the first one\'s result and report it\n' +
         `  as a fresh integration. Delete it deliberately (git branch -D ${WAVE_BRANCH}) once you know\n` +
         '  what it holds, or run the next wave number.' +
         (flags.push ? '\n  --push lands an existing wave branch only when its tip is the commit that ran GREEN; this\n' +
                       '  one has no green record, or has moved since it ran.' : ''));
}
const add = gitTry(['worktree', 'add', '-b', WAVE_BRANCH, WT, BASE]);
if (!add.ok) die(2, `could not create the integration worktree:\n${add.out.trim()}`);
created = true;

// --- merge -------------------------------------------------------------------------------------------
const merged = [];
const conflicted = [];
for (const c of candidates) {
  const r = gitTry(['merge', '--no-ff', '-m', `Merge ${c.id} into ${WAVE_BRANCH}`, c.branch], { cwd: WT });
  if (r.ok) {
    const files = (gitTry(['diff', '--name-only', `${BASE}...${c.branch}`], { cwd: WT }).out || '').split('\n').filter(Boolean);
    merged.push({ ...c, files });
    continue;
  }
  // Abort THIS merge and keep going. A conflicting ticket costs itself, not the wave: the other
  // approved work is correct and there is no reason to hold it behind one rebase.
  const conflicts = (gitTry(['diff', '--name-only', '--diff-filter=U'], { cwd: WT }).out || '').split('\n').filter(Boolean);
  gitTry(['merge', '--abort'], { cwd: WT });
  conflicted.push({ ...c, conflicts, output: r.out.trim().split('\n').slice(0, 8).join('\n') });
}

process.stdout.write(`\n  merged ${merged.length}, conflicted ${conflicted.length}\n`);
for (const c of conflicted) {
  process.stdout.write(
    `\n  CONFLICT ${c.id} (${c.branch}) on:\n` +
    c.conflicts.map((f) => `      ${f}\n`).join('') +
    '    Read both sides and the governing spec (git-pr-strategy §6). A TEXTUAL conflict — imports,\n' +
    '    two additions to one list, formatting — is yours to resolve here. A conflict that changes\n' +
    '    BEHAVIOUR or a CONTRACT goes back as a ticket to the owner of that contract, with the hunks\n' +
    '    attached. Nothing here picks a side: `ours`/`theirs` on an unread conflict is a silent\n' +
    '    lost edit wearing a merge commit.\n'
  );
}

// --- test, ONCE ---------------------------------------------------------------------------------------
let TEST_CMD = typeof flags['test-command'] === 'string' ? flags['test-command'] : '';
if (!TEST_CMD) {
  const r = spawnSync(process.execPath, [resolve(HERE, 'project-profile.mjs'), 'test-command', '--scope', 'full'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    process.stdout.write(
      `\n  CANNOT EVALUATE: no \`full\` test command is declared for this project.\n` +
      `${(r.stdout || r.stderr || '').split('\n').map((l) => `    ${l}`).join('\n')}\n` +
      '    Nothing is substituted, because a default test command would make "the tests ran" true of\n' +
      '    a command nobody chose. Declare it in docs/team/project-profile.json and re-run.\n' +
      `\n    ${WAVE_BRANCH} holds the merges above and is NOT deleted — inspect it at ${WT}.\n`
    );
    keep = true;
    process.exit(2);
  }
  TEST_CMD = r.stdout.trim();
}

process.stdout.write(`\n  running the wave suite ONCE on the merged tree: ${TEST_CMD}\n`);
const test = spawnSync('sh', ['-c', `. "${resolve(HERE, 'build-env.sh')}" && ${TEST_CMD}`], { cwd: WT, encoding: 'utf8' });
const testOut = `${test.stdout || ''}${test.stderr || ''}`;

// The SAME three-way split every other gate here uses, and for the same reason: a missing toolchain
// and a failing assertion are different sentences, and conflating them sends developers to fix bugs
// that do not exist (DR4-001). ONE definition, shared with verify-done.sh: lib/test-evidence.mjs —
// which runner shapes count (W1: Jest, Vitest, pytest, go test, Gradle) and why zero tests or a
// bare keyword is never green (G-F5).
const run = classifyTestRun(test.status, testOut);
const cannotRun = run.verdict === 'cannot-run';
const green = run.verdict === 'green';

process.stdout.write(`\n${testOut.split('\n').slice(-30).map((l) => `  | ${l}`).join('\n')}\n`);

// --check-baseline: run the SAME command against the UNCHANGED $BASE, in a throwaway sibling
// worktree, cleaned up unconditionally — nobody needs to inspect an unmodified base ref the way a
// failing merged tree needs inspecting. Reuses the exact RAN/CANNOT_RUN classification above; this
// is a boolean ("did base also fail"), never a count or a named-test diff.
function baselineAlsoFails() {
  // Deliberately NOT prefixed `integration-wave-`: worktree-reap.mjs's liveness() treats that
  // prefix as "an integration worktree, never auto-reaped" — correct for the real merged tree at
  // WT, wrong for this throwaway baseline checkout, which the comment above already says is
  // "cleaned up unconditionally... nobody needs to inspect" it. If a crash ever skips the `finally`
  // below (a signal the process can't catch), a leaked worktree under this name is treated as an
  // ordinary orphan by the reaper — checked against the board, not permanently protected — instead
  // of silently becoming exactly the disk-ceiling-eating "kept forever" artifact it was named to avoid.
  const BWT = resolve(ROOT, '.agent-wt', `wave-${WAVE}-baseline-check`);
  rmSync(BWT, { recursive: true, force: true });
  const add = gitTry(['worktree', 'add', '--detach', BWT, BASE], { cwd: ROOT });
  if (!add.ok) return { checked: false, reason: `could not check out ${BASE} to compare: ${add.out}` };
  try {
    const baseTest = spawnSync('sh', ['-c', `. "${resolve(HERE, 'build-env.sh')}" && ${TEST_CMD}`], { cwd: BWT, encoding: 'utf8' });
    const baseOut = `${baseTest.stdout || ''}${baseTest.stderr || ''}`;
    const baseRun = classifyTestRun(baseTest.status, baseOut);
    const baseGreen = baseRun.verdict === 'green';
    if (baseRun.verdict === 'cannot-run') return { checked: false, reason: `${BASE} could not be evaluated either — no comparison to make` };
    return { checked: true, baseFailed: !baseGreen };
  } finally {
    gitTry(['worktree', 'remove', '--force', BWT], { cwd: ROOT });
    rmSync(BWT, { recursive: true, force: true });
  }
}

// --- attribute -----------------------------------------------------------------------------------------
function candidatesFor(output) {
  const named = [];
  for (const m of merged) {
    const hit = m.files.some((f) => output.includes(f) || output.includes(f.split('/').pop()));
    if (hit) named.push(m.id);
  }
  return named;
}

// --- verdict -------------------------------------------------------------------------------------------
// G-F4: the green is recorded as test-evidence/v1 (raw log + sha256 + head), the record `verified`
// must cite. Written only on green; the board re-derives the verdict from the log.
const EVIDENCE = green
  ? writeTestEvidence(ROOT, {
    producedBy: 'wave-integrate.mjs', branch: WAVE_BRANCH, base: BASE, head: gitTry(['rev-parse', WAVE_BRANCH]).out,
    mode: 'tests', command: TEST_CMD, commandSource: flags['test-command'] ? 'caller' : 'profile', exitCode: test.status, output: testOut,
  })
  : '';
// W2-10: printed commands are runnable as printed — the plugin path, and under requireActorTokens
// the token minted INLINE in the same command (a shell variable does not survive between calls).
let TOKENS = false;
try { TOKENS = JSON.parse(readFileSync(resolve(ROOT, '.studio-policy.json'), 'utf8')).requireActorTokens === true; } catch { /* no policy: no tokens */ }
const BOARD_CLI = 'node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs"';
const tokenFor = (role, id) => (TOKENS ? ` --token "$(${BOARD_CLI} actor mint --role ${role} --ticket ${id})"` : '');
const boardCommands = merged.map((m) => `  ${BOARD_CLI} move ${m.id} verified --by tech-manager --evidence ${EVIDENCE} --detail "wave ${WAVE} full suite green"${tokenFor('tech-manager', m.id)}`).join('\n');

if (cannotRun) {
  process.stdout.write(
    '\n  WAVE RESULT: CANNOT EVALUATE — the suite did not demonstrably run here.\n' +
    `  Why: ${run.why}.\n` +
    '  This is NOT a pass and NOT a failure of the code. Every ticket in this wave keeps the\n' +
    '  `verified_static` it already carries, `closed` stays refused, and ship-gate.sh keeps blocking.\n' +
    `  ${WAVE_BRANCH} is kept so the merged tree can be built somewhere that has the toolchain.\n  It is checked out at ${WT}.\n`
  );
  keep = true;
  process.exit(2);
}

if (!green) {
  const blamed = candidatesFor(testOut);
  let baselineNote = '';
  if (flags['check-baseline']) {
    // An optional diagnostic must never be able to hide the primary FAIL report it is annotating —
    // an uncaught exception here (a git error, a killed sh) would otherwise crash the process before
    // "WAVE RESULT: FAIL" ever prints, replacing the one message a human needs with a stack trace.
    let b;
    try {
      b = baselineAlsoFails();
    } catch (e) {
      b = { checked: false, reason: `baseline check crashed: ${e && e.message ? e.message : e}` };
    }
    baselineNote = !b.checked
      ? `\n  BASELINE CHECK: not possible — ${b.reason}\n`
      : b.baseFailed
        ? `\n  BASELINE CHECK: ${BASE} ALSO fails this same suite, unmodified. This failure may PRE-DATE\n` +
          `  the wave — do not assume this wave introduced it before reading the output above.\n`
        : `\n  BASELINE CHECK: ${BASE} passes this same suite, unmodified. This wave introduced the failure.\n`;
  }
  process.stdout.write(
    '\n  WAVE RESULT: FAIL — the merged tree does not pass its own suite.\n' +
    '  The wave does not advance. No ticket in it gets a real `verified`.\n' +
    baselineNote +
    (blamed.length
      ? `\n  CANDIDATE tickets (their changed files are named in the output): ${blamed.join(', ')}\n` +
        '  This is a CANDIDATE LIST, not a verdict. It is a filename match on test output, which is a\n' +
        '  heuristic and is stated as one — the alternative was attributing failures by feel, and the\n' +
        '  alternative to that was re-spawning every developer in the wave. Read the output, then\n' +
        '  re-spawn only the owners the failure actually names, with these lines verbatim.\n'
      : '\n  No ticket\'s changed files appear in the failure output. That is itself a finding: the wave\n' +
        '  broke something no single ticket touched, which is the composition failure a per-ticket\n' +
        '  build structurally cannot see. Route it to tech-lead, not to a developer.\n') +
    `\n  ${WAVE_BRANCH} is kept for inspection, checked out at ${WT}. Nothing was pushed.\n`
  );
  keep = true;
  process.exit(1);
}

process.stdout.write(
  `\n  WAVE RESULT: GREEN — ${merged.length} ticket(s) integrated and the full suite passed on the merged tree.\n\n` +
  '  Record it. This is what upgrades the per-ticket `verified_static` that --static wrote, and it\n' +
  '  is the only thing that lets these tickets reach `closed`:\n\n' +
  `${boardCommands}\n`
);

// DESIGN DECISION 6 (W2-3): high/critical runtime evidence is checked HERE, on the wave candidate —
// not demanded before `merged`, where no tree containing the ticket and its wave-mates exists yet.
// A wave holding a high/critical ticket does not record green (so cannot be pushed) until
// runtime-gate.sh passes on the merged tree. Risk = the planned tier, or the tier the ticket's own
// diff routes to under docs/team/risk-policy.json, whichever is higher.
{
  let policy = null;
  try { policy = JSON.parse(readFileSync(resolve(ROOT, 'docs/team/risk-policy.json'), 'utf8')); } catch { /* none */ }
  const tier = (m) => {
    const t = tickets.get(m.id.toUpperCase()) || [...tickets.values()].find((x) => x.id === m.id);
    const planned = t?.meta?.risk || null;
    const diff = policy && Array.isArray(policy.rules) && m.files.length ? routeFiles(policy, m.files)?.risk : null;
    return [planned, diff].filter(Boolean).sort((a, b) => RANK[b] - RANK[a])[0] || null;
  };
  const risky = merged.filter((m) => ['high', 'critical'].includes(tier(m)));
  if (risky.length) {
    const gate = process.env.STUDIO_RUNTIME_GATE || resolve(HERE, 'runtime-gate.sh'); // env: test seam
    process.stdout.write(`\n  RUNTIME GATE on the wave candidate — required by ${risky.map((m) => `${m.id} (${tier(m)})`).join(', ')}\n`);
    const rg = spawnSync('sh', [gate, '--project-root', WT], { cwd: WT, encoding: 'utf8' });
    process.stdout.write(`${`${rg.stdout || ''}${rg.stderr || ''}`.trim().split('\n').map((l) => `  | ${l}`).join('\n')}\n`);
    if (rg.status !== 0) {
      process.stdout.write(
        `\n  WAVE NOT LANDABLE — the suite is green, but runtime-gate ${rg.status === 1 ? 'FAILED' : 'could not evaluate (exit 2)'} on the merged tree,\n` +
        '  and a high/critical ticket lands only on a wave that built and launched. The `verified` commands above\n' +
        `  are still true (the suite ran); landing is not. ${WAVE_BRANCH} is kept at ${WT}.\n` +
        '  Fix it, or drop the risky ticket from the wave, then re-run with the next wave number.\n'
      );
      keep = true;
      process.exit(rg.status === 1 ? 1 : 2);
    }
  }
}

// Record WHICH tip ran green, so a later `--wave N --push` can land this exact branch without
// re-merging (W6) — and can refuse a branch that has moved since. A ref, not a file: atomic, and
// invisible to `git branch`, which the candidate matching above reads.
gitTry(['update-ref', GREEN_REF, gitTry(['rev-parse', WAVE_BRANCH]).out]);

if (!flags.push) {
  process.stdout.write(
    `\n  NOT PUSHED. --push fast-forwards ${BASE} to ${WAVE_BRANCH} and pushes ONCE — one CI run for the\n` +
    `  whole wave, which \`ci-status.mjs\` reads at the top of the next round. Or do it by hand:\n` +
    `    git checkout ${BASE} && git merge --ff-only ${WAVE_BRANCH} && git push origin ${BASE}\n`
  );
  process.exit(0);
}
pushWave();

// --- push, once ------------------------------------------------------------------------------------------
function pushWave() {
  // `git merge --ff-only` MERGES INTO WHATEVER IS CHECKED OUT — and this never checked out $BASE.
  //
  // It ran with `cwd: ROOT` and no idea what ROOT had on HEAD. If the operator was standing on any
  // other branch, that branch was silently fast-forwarded to the wave, $BASE never moved, and this
  // printed `PUSHED <base>` and exited 0. Reproduced against a bare remote: `develop` unchanged on
  // both sides, an unrelated `scratch/operator` branch advanced to the wave tip, exit 0.
  //
  // Two wrongs at once: the wave lands nowhere, and a branch nobody leased gets rewritten — which is
  // the rule this file's own header states at line 151, broken by this file.
  //
  // The fix updates the REF instead of merging into a working tree. `git fetch . <src>:<dst>` is
  // fast-forward-only by default, needs no checkout, and refuses outright when <dst> is checked out
  // somewhere — so the one case that genuinely needs a working tree is reported rather than guessed
  // at. Note the printed manual fallback below has always included the `git checkout ${BASE}` this
  // code omitted; the instructions were right and the implementation was not.
  const baseBefore = gitTry(['rev-parse', BASE]).out;
  const waveTip = gitTry(['rev-parse', WAVE_BRANCH]).out;

  let ff = gitTry(['fetch', '.', `${WAVE_BRANCH}:${BASE}`], { cwd: ROOT });
  if (!ff.ok && /checked out|refusing to fetch into/i.test(ff.out)) {
    // $BASE is checked out somewhere. If that somewhere is ROOT, a plain ff-only merge is correct and
    // safe — it is the branch we intend to move. Anywhere else, we do not touch another tree.
    const head = gitTry(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT }).out;
    if (head === BASE) ff = gitTry(['merge', '--ff-only', WAVE_BRANCH], { cwd: ROOT });
    else {
      process.stdout.write(
        `\n  PUSH SKIPPED: ${BASE} is checked out in another worktree, and this will not move a branch\n` +
        `  from under whoever is standing on it. ROOT is on "${head}".\n` +
        `  Land it from the tree that holds ${BASE}:\n` +
        `    git checkout ${BASE} && git merge --ff-only ${WAVE_BRANCH} && git push origin ${BASE}\n`
      );
      keep = true;
      process.exit(1);
    }
  }
  if (!ff.ok) {
    // W2-9: say WHY. "Something landed on BASE" was printed for every failure — including the common
    // one where BASE never moved and the checkout holds UNTRACKED files the wave adds (a planning
    // commit that missed docs/4x, CI config, ...). Name those files; never advise stashing them.
    const baseMoved = !gitTry(['merge-base', '--is-ancestor', BASE, WAVE_BRANCH]).ok;
    const untracked = [];
    let inList = false;
    for (const l of ff.out.split('\n')) {
      if (/untracked working tree files would be overwritten/i.test(l)) { inList = true; continue; }
      if (inList && /^\s+\S/.test(l) && !/^\s*(Please|Aborting)/.test(l)) untracked.push(l.trim()); else if (inList) inList = false;
    }
    process.stdout.write(
      `\n  PUSH SKIPPED: ${BASE} could not fast-forward to ${WAVE_BRANCH}:\n${ff.out.split('\n').map((l) => `    ${l}`).join('\n')}\n` +
      (untracked.length
        ? `  ${BASE} did not move. The checkout holds UNTRACKED files the wave adds:\n${untracked.map((f) => `      ${f}\n`).join('')}` +
          '  Commit them on the integration branch if they belong to the project (planning docs, CI), or delete them\n' +
          '  if the wave\'s copies supersede them — then re-run with --push. Do not stash: a stash is invisible to every gate.\n'
        : baseMoved
          ? `  Something landed on ${BASE} while the wave was integrating. Re-run the wave against the new tip\n` +
            '  rather than forcing anything: this never force-pushes and never rewrites the integration branch.\n'
          : `  ${BASE} did not move, so this is the checkout, not a race — read git's message above.\n`)
    );
    keep = true;
    process.exit(1);
  }

  // CONFIRM THE REF ACTUALLY MOVED BEFORE CLAIMING ANYTHING. The defect above printed PUSHED for a
  // branch that never changed, so "the command exited 0" is not evidence that the wave landed —
  // exactly the claim/verification gap `merge-reconcile.mjs` exists to close one level up.
  const baseAfter = gitTry(['rev-parse', BASE]).out;
  if (baseAfter !== waveTip) {
    process.stdout.write(
      `\n  PUSH SKIPPED: ${BASE} did not move. It was ${baseBefore.slice(0, 8)} and is ${baseAfter.slice(0, 8)};\n` +
      `  the wave tip is ${waveTip.slice(0, 8)}. Nothing was pushed, because nothing landed.\n`
    );
    keep = true;
    process.exit(1);
  }

  // W7: no `origin` is not a failed push. $BASE already moved (confirmed above), so the wave LANDED;
  // exit 1 here read as "the wave does not advance — re-spawn the owners" for a fast-forwarded base.
  const hasOrigin = gitTry(['remote', 'get-url', 'origin'], { cwd: ROOT }).ok;
  const push = hasOrigin ? gitTry(['push', 'origin', BASE], { cwd: ROOT }) : { ok: true, out: '' };
  process.stdout.write(!hasOrigin
    ? `\n  PUSH SKIPPED: this repository has no \`origin\` remote, so there is nowhere to push and no CI run.\n` +
      `  ${BASE} IS fast-forwarded locally to the green wave tip ${waveTip.slice(0, 8)} — the wave landed.\n` +
      `  Once a remote exists: git push origin ${BASE}\n`
    : push.ok
    ? `\n  PUSHED ${BASE} — one push, one CI run for the wave. Read it next round with ci-status.mjs.\n`
    : `\n  PUSH FAILED:\n${push.out.split('\n').map((l) => `    ${l}`).join('\n')}\n  ${BASE} is fast-forwarded locally; nothing was rewritten.\n`);

  // Future Conflict #1 (adversarial-operations-review): `orchestrator round` runs merge-reconcile.mjs
  // at ROUND START, but drift can happen at the moment the wave lands too — the same fetch/ff/push
  // sequence above is a second window between "the board believes this is merged" and "git agrees".
  // Running the same reconciliation here, once, right after the ref actually moved, closes that
  // window at the source instead of waiting for it to surface a round later.
  if (push.ok) {
    const reconcile = spawnSync(
      process.execPath,
      [resolve(HERE, 'merge-reconcile.mjs'), '--root', ROOT, '--base', BASE],
      { cwd: ROOT, encoding: 'utf8' }
    );
    process.stdout.write(`\n  merge-reconcile (post-wave):\n${(reconcile.stdout || '').split('\n').map((l) => `    ${l}`).join('\n')}\n`);
    if (reconcile.status !== 0) {
      process.stdout.write(
        `  merge-reconcile exited ${reconcile.status} after the push that just landed ${WAVE_BRANCH} on ${BASE}.\n` +
        '  The wave itself is pushed; treat this as a hand-off to the next round, not a failed push.\n'
      );
    }
  }
  process.exit(push.ok ? 0 : 1);
}
