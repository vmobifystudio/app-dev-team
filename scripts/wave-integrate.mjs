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
 *
 * Exit codes:
 *   0  the wave merged clean and the suite ran green
 *   1  a merge conflicted, or the suite ran and FAILED. The wave does not advance.
 *   2  CANNOT EVALUATE — no base, no candidates, no test command declared, or the suite could not be
 *      executed here. Never a pass: a wave nobody could test is not a tested wave.
 */
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { parseEventLog, reduce } from './lib/events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`wave-integrate: ${message}\n`); process.exit(code); };

const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'base', 'wave', 'test-command', 'log', 'dir']),
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
const candidates = [];
const noBranch = [];
for (const t of tickets.values()) {
  if (t.status !== 'qa') continue;
  const mine = branches.filter((b) => b.toLowerCase().includes(String(t.id).toLowerCase()));
  if (!mine.length) { noBranch.push(t.id); continue; }
  const already = mine.some((b) => gitTry(['merge-base', '--is-ancestor', b, BASE]).ok);
  if (already) continue;
  candidates.push({ id: t.id, branch: mine[0], allBranches: mine });
}

if (!candidates.length) {
  process.stdout.write(
    `WAVE ${WAVE}: nothing to integrate into ${BASE}.\n` +
    `  ${[...tickets.values()].filter((t) => t.status === 'qa').length} ticket(s) are at \`qa\`; every one is either already an ancestor of ${BASE} or has no branch.\n` +
    (noBranch.length ? `  NO BRANCH FOUND: ${noBranch.join(', ')} — reported, never assumed merged (merge-reconcile.mjs's rule).\n` : '')
  );
  process.exit(2);
}

process.stdout.write(`WAVE ${WAVE} — ${candidates.length} ticket(s) to integrate into ${BASE}\n\n`);
for (const c of candidates) process.stdout.write(`  ${c.id.padEnd(16)} ${c.branch}\n`);
if (noBranch.length) process.stdout.write(`\n  NO BRANCH FOUND (not integrated, not assumed merged): ${noBranch.join(', ')}\n`);

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
const WT = mkdtempSync(join(tmpdir(), `wave-${WAVE}-`));
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

if (gitTry(['rev-parse', '--verify', WAVE_BRANCH]).ok) {
  die(2, `${WAVE_BRANCH} already exists.\n` +
         '  A second run of the same wave would merge on top of the first one\'s result and report it\n' +
         `  as a fresh integration. Delete it deliberately (git branch -D ${WAVE_BRANCH}) once you know\n` +
         '  what it holds, or run the next wave number.');
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
// that do not exist (DR4-001).
const CANNOT_RUN = /command not found|: not found|no such file or directory|xcode-select: error|requires Xcode|xcrun: error|unable to find utility|GradleWrapperMain|permission denied/i;
const RAN = /test case|executed [0-9]+ test|tests? run:|[0-9]+ (test|assertion|example)s?[,.]? .*(fail|pass)|TEST FAILED|FAILED \(|assertion (failed|error)|[0-9]+ (passing|failing)/i;
const cannotRun = test.status === 126 || test.status === 127 || CANNOT_RUN.test(testOut) || !RAN.test(testOut);
const green = test.status === 0 && !cannotRun;

process.stdout.write(`\n${testOut.split('\n').slice(-30).map((l) => `  | ${l}`).join('\n')}\n`);

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
const boardCommands = merged.map((m) => `  node scripts/board.mjs move ${m.id} verified --by tech-manager --detail "wave ${WAVE} full suite green"`).join('\n');

if (cannotRun) {
  process.stdout.write(
    '\n  WAVE RESULT: CANNOT EVALUATE — the suite did not demonstrably run here.\n' +
    '  This is NOT a pass and NOT a failure of the code. Every ticket in this wave keeps the\n' +
    '  `verified_static` it already carries, `closed` stays refused, and ship-gate.sh keeps blocking.\n' +
    `  ${WAVE_BRANCH} is kept so the merged tree can be built somewhere that has the toolchain.\n  It is checked out at ${WT}.\n`
  );
  keep = true;
  process.exit(2);
}

if (!green) {
  const blamed = candidatesFor(testOut);
  process.stdout.write(
    '\n  WAVE RESULT: FAIL — the merged tree does not pass its own suite.\n' +
    '  The wave does not advance. No ticket in it gets a real `verified`.\n' +
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

if (!flags.push) {
  process.stdout.write(
    `\n  NOT PUSHED. --push fast-forwards ${BASE} to ${WAVE_BRANCH} and pushes ONCE — one CI run for the\n` +
    `  whole wave, which \`ci-status.mjs\` reads at the top of the next round. Or do it by hand:\n` +
    `    git checkout ${BASE} && git merge --ff-only ${WAVE_BRANCH} && git push origin ${BASE}\n`
  );
  process.exit(0);
}

// --- push, once ------------------------------------------------------------------------------------------
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
  process.stdout.write(
    `\n  PUSH SKIPPED: ${BASE} could not fast-forward to ${WAVE_BRANCH}:\n${ff.out.split('\n').map((l) => `    ${l}`).join('\n')}\n` +
    `  Something landed on ${BASE} while the wave was integrating. Re-run the wave against the new tip\n` +
    '  rather than forcing anything: this never force-pushes and never rewrites the integration branch.\n'
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

const push = gitTry(['push', 'origin', BASE], { cwd: ROOT });
process.stdout.write(push.ok
  ? `\n  PUSHED ${BASE} — one push, one CI run for the wave. Read it next round with ci-status.mjs.\n`
  : `\n  PUSH FAILED:\n${push.out.split('\n').map((l) => `    ${l}`).join('\n')}\n  ${BASE} is fast-forwarded locally; nothing was rewritten.\n`);
process.exit(push.ok ? 0 : 1);
