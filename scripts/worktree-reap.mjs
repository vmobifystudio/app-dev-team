#!/usr/bin/env node
/**
 * worktree-reap — find the agent worktrees nothing is using any more, and say what they cost.
 *
 * THE MEASURED PROBLEM (OPS-006, docs/reviews/2026-08-07-adversarial-operations-review.md).
 * Worktree REMOVAL is specified in exactly three places in this plugin, and all three are the merge
 * path: `/app-build` step 4a ("after each merge"), `tech-manager.md` ("after its merge"),
 * `agent-isolation` ("cleanup after the merge gate"). Nothing removes a worktree after `rejected`,
 * after the 2-cycle cap converts a third `changes` into `blocked`, after a `BLOCKED:` return, at
 * sprint exit, or after a round that crashed. There was no cap on how many could exist, no disk
 * budget among `round-journal.mjs`'s ceilings, and no reaper anywhere.
 *
 * It is not hypothetical. Measured in THIS repository on 2026-08-07, which contains no application
 * code at all — only Markdown and Node scripts:
 *
 *     git worktree list | wc -l   ->  13   (1 main + 12 agent worktrees)
 *     du -sh .claude/worktrees    ->  88M
 *
 * several of them holding branches whose work merged days earlier. On a real iOS project each
 * worktree that gets built also carries its own DerivedData — commonly 1–3 GB — so the same leak is
 * tens of gigabytes per sprint, growing, with nothing that ever mentions it.
 *
 * TWO RULES THIS WILL NOT BREAK, because a reaper that loses work is worse than the leak:
 *
 *   1. NEVER `--force`. `git worktree remove` refuses a worktree with uncommitted changes, and that
 *      refusal is the correct answer — it is the same class of loss as DR4-027's `git stash`, where
 *      one command discarded 22 files of another agent's in-progress work. A dirty orphan is
 *      REPORTED, loudly, and left exactly where it is.
 *   2. NEVER remove anything without `--apply`. The default is a report. `orchestrator.mjs round`
 *      calls this WITHOUT `--apply` precisely because that command is documented as read-only and
 *      must stay so; the removal is an explicit step in `/app-build`.
 *
 * WHAT COUNTS AS LIVE, and why it is derived rather than declared: a slot is live while the board
 * says a ticket it holds is `in_progress` or `review`. Those are the two states in which a developer
 * or a reviewer may still need the TREE. Deriving it from the event log means the reaper cannot
 * disagree with the board; a hand-maintained list of "active worktrees" would be a second source of
 * truth for the one thing the board already knows.
 *
 * THIS USED TO SAY "a merged ticket's work is on the integration branch" (N9). Under the wave model
 * that is false: a `qa` ticket is merge-GATED and its code may not be integrated until the wave
 * runs. The behaviour here is still correct — a branch ref survives its worktree, so reclaiming the
 * tree of a gated ticket loses nothing, and `wave-integrate` reads branches rather than worktrees.
 * But the sentence was the exact belief that produced EE-001 and B2, still written down as true,
 * and a comment that teaches the next reader a false rule is how a class recurs. `hasShipped()` in
 * `lib/board.mjs` is the one predicate that answers it.
 *
 * Usage:
 *   worktree-reap.mjs [--root <path>] [--dir .agent-wt] [--apply] [--max-disk-mb N] [--json]
 *
 * Exit codes:
 *   0  CLEAR            — nothing orphaned, and the pool is inside its disk ceiling
 *   1  BLOCKED          — the pool is over its disk ceiling, or an `--apply` removal failed
 *   2  CANNOT EVALUATE  — not a git repository, or the event log is unreadable. Never a pass.
 *
 * Orphans alone are exit 0 with a REPORT: an orphan is reclaimable, not a reason to stop a round.
 * Disk is different — a full disk fails every build on the machine, so that one blocks.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename, sep } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { parseEventLog, reduce, key } from './lib/events.mjs';

const die = (code, message) => { process.stderr.write(`worktree-reap: ${message}\n`); process.exit(code); };

const { flags } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'dir', 'max-disk-mb', 'log', 'slots']),
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

const DIR = typeof flags.dir === 'string' ? flags.dir : '.agent-wt';
const LOG = typeof flags.log === 'string' ? resolve(flags.log) : resolve(ROOT, 'docs/31-board-events.jsonl');
const SLOTS = typeof flags.slots === 'string' ? resolve(flags.slots) : resolve(ROOT, 'docs/team/worktree-slots.json');

/**
 * The default ceiling is ON, and 5 GB, and that combination is the decision worth arguing about.
 *
 * A ceiling that defaults to "unlimited unless someone opts in" is a gate that never fires, which
 * is the exact shape this repository has been caught by repeatedly (the orphaned invariant suite,
 * the unreachable `--driver`, the detector nobody called). 5 GB is chosen to be far above any
 * healthy pool — three iOS slots with warm DerivedData sit well under it once `build-env.sh` moved
 * the caches OUT of the worktrees — and far below the point where a laptop is in trouble.
 *
 * Raising it is the operator's call, exactly like every other ceiling in `round-journal.mjs`:
 *   APP_TEAM_MAX_DISK_MB=20000    or    --max-disk-mb 20000
 */
const MAX_DISK_MB = Number(flags['max-disk-mb'] ?? process.env.APP_TEAM_MAX_DISK_MB ?? 5000);
// `0` is legal and means "no agent worktree pool is permitted here" — a real setting for a project
// that has chosen serialization. Rejecting it would also make the ceiling branch untestable on a
// pool small enough to fit in a fixture, and an untestable branch is an unverified one.
if (!Number.isFinite(MAX_DISK_MB) || MAX_DISK_MB < 0) die(2, `--max-disk-mb must be zero or a positive number, got "${flags['max-disk-mb'] ?? process.env.APP_TEAM_MAX_DISK_MB}"`);

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

try { git(['rev-parse', '--is-inside-work-tree']); }
catch { die(2, `not a git repository at ${ROOT} — there are no worktrees to reap here.\n  This is CANNOT EVALUATE, not a clean pool.`); }

// --- which slots exist -------------------------------------------------------------------------
//
// Parsed from `git worktree list --porcelain` rather than from the filesystem: a directory under
// .agent-wt/ that git does NOT know about is not a worktree, it is a stray copy, and removing it
// with `git worktree remove` would fail confusingly. Those are reported separately below.
const POOL_PREFIX = resolve(ROOT, DIR) + sep;
const registered = [];
{
  let current = null;
  for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ')) { current = { path: line.slice(9), branch: null }; registered.push(current); }
    else if (line.startsWith('branch ') && current) current.branch = line.slice(7).replace('refs/heads/', '');
  }
}
const pool = registered.filter((w) => resolve(w.path).startsWith(POOL_PREFIX));

// --- what the board says is still being worked --------------------------------------------------
const LIVE_STATUSES = new Set(['in_progress', 'review']);
let live = new Set();
let boardKnown = false;
if (existsSync(LOG)) {
  let parsed;
  try { parsed = parseEventLog(readFileSync(LOG, 'utf8')); }
  catch (e) { die(2, `cannot read the event log at ${LOG}: ${e.message}\n  A half-readable log is not an empty board — refusing to call anything an orphan on it.`); }
  const { tickets } = reduce(parsed.events);
  for (const t of tickets.values()) if (LIVE_STATUSES.has(t.status)) live.add(key(t.id));
  boardKnown = true;
}

// A slot may be keyed by TICKET (`.agent-wt/APP-001`, the historical shape) or by OWNER
// (`.agent-wt/ios-developer`, the slot-leasing shape from worktree-slot.mjs — see OPS-005). Both
// are supported on purpose: this reaper must work on a project mid-migration, and a reaper that
// only understands the new shape would silently declare every old worktree an orphan.
let leases = {};
if (existsSync(SLOTS)) {
  try { leases = JSON.parse(readFileSync(SLOTS, 'utf8')).slots || {}; }
  catch (e) { die(2, `cannot read the slot lease file at ${SLOTS}: ${e.message}`); }
}

function liveness(name) {
  // AN INTEGRATION WORKTREE IS NEVER AUTO-REAPED.
  //
  // `wave-integrate.mjs` keeps `.agent-wt/integration-wave-N` on every non-green outcome, and tells
  // the operator the merged tree is preserved so it can be built somewhere with a toolchain. It
  // lived in os.tmpdir(), where this reaper could not see it, so it was neither counted nor
  // protected and the OS could purge it (N3). Moving it here fixed that and created a worse
  // problem: a kept wave tree is CLEAN — its merges are committed — so the dirty check would not
  // have stopped `--apply` from deleting the one artifact the message promised.
  //
  // So it is reported, counted against the ceiling, and removed only by a human who knows what it
  // holds. That is the same reasoning as the dirty-orphan rule: this reaper does not destroy work
  // nobody has read.
  if (/^integration-wave-/.test(name)) {
    return { live: true, why: 'an integration worktree — kept for inspection, counted, never auto-reaped. Remove it deliberately once you know what it holds' };
  }
  if (!boardKnown) return { live: true, why: 'no event log — nothing can be called an orphan without a board' };
  if (live.has(key(name))) return { live: true, why: `ticket ${name} is in flight` };
  const lease = leases[name];
  if (lease) {
    const held = (lease.tickets || []).filter((t) => live.has(key(t)));
    if (held.length) return { live: true, why: `leased to ${name}, holding ${held.join(', ')}` };
    return { live: false, why: `leased to ${name}, and none of ${(lease.tickets || []).join(', ') || 'its tickets'} is still in flight` };
  }
  return { live: false, why: `no ticket named ${name} is in flight, and no slot lease claims it` };
}

const diskKb = (path) => {
  try { return Number(execFileSync('du', ['-sk', path], { encoding: 'utf8' }).trim().split(/\s+/)[0]) || 0; }
  catch { return 0; }
};

const dirty = (path) => {
  try { return git(['status', '--porcelain'], { cwd: path }).length > 0; }
  catch { return true; }   // unreadable is treated as dirty: never remove what you cannot inspect
};

// --- assess ---------------------------------------------------------------------------------------
const rows = pool.map((w) => {
  const name = basename(w.path);
  const state = liveness(name);
  const kb = diskKb(w.path);
  return { name, path: w.path, branch: w.branch, live: state.live, why: state.why, dirty: state.live ? false : dirty(w.path), mb: Math.round(kb / 1024) };
});

const orphans = rows.filter((r) => !r.live);
const removable = orphans.filter((r) => !r.dirty);
const stuck = orphans.filter((r) => r.dirty);
const poolMb = rows.reduce((n, r) => n + r.mb, 0);

// THE LEAK MOVED OUT FROM UNDER ITS OWN CEILING (B4).
//
// `build-env.sh` relocates DerivedData, the Gradle home and the SwiftPM cache to `.studio-cache/`
// precisely so reaping a slot cannot throw away a warm build. Correct — and it means the single
// largest consumer of disk on a real iOS project is no longer inside the directory this ceiling
// measures. The reported number would say "3 worktrees, 40 MB" beside a 12 GB cache, and the gate
// added to stop the disk filling would never fire on the thing that fills it.
//
// So it is COUNTED here and never reaped: a warm cache is an asset, and deleting it is the
// operator's call with `rm -rf .studio-cache`. Counting it makes the ceiling honest; reaping it
// would make the caches pointless.
const cacheDir = resolve(ROOT, '.studio-cache');
const cacheMb = existsSync(cacheDir) ? Math.round(diskKb(cacheDir) / 1024) : 0;
const totalMb = poolMb + cacheMb;
const reclaimableMb = removable.reduce((n, r) => n + r.mb, 0);

// --- apply ------------------------------------------------------------------------------------------
const removed = [];
const failed = [];
if (flags.apply) {
  for (const r of removable) {
    // NEVER --force. See rule 1 in the header: the refusal on a dirty tree is the feature.
    try { git(['worktree', 'remove', r.path]); removed.push(r); }
    catch (e) { failed.push({ ...r, error: String(e.stderr || e.message).trim() }); }
  }
  try { git(['worktree', 'prune']); } catch { /* prune is best-effort; nothing depends on it */ }
}

// --- report -------------------------------------------------------------------------------------------
if (flags.json) {
  process.stdout.write(`${JSON.stringify({
    schema: 'worktree-reap/v1', root: ROOT, dir: DIR, applied: Boolean(flags.apply),
    maxDiskMb: MAX_DISK_MB, totalMb, poolMb, cacheMb, reclaimableMb,
    worktrees: rows, removed: removed.map((r) => r.name), failed,
  }, null, 2)}\n`);
} else {
  process.stdout.write(`WORKTREE POOL — ${DIR}/ under ${ROOT}\n\n`);
  if (!rows.length) process.stdout.write('  no agent worktrees\n');
  for (const r of rows) {
    const tag = r.live ? 'LIVE    ' : r.dirty ? 'ORPHAN* ' : 'ORPHAN  ';
    process.stdout.write(`  ${tag} ${r.name.padEnd(24)} ${String(r.mb).padStart(6)} MB  ${r.branch || '(detached)'}\n`);
    process.stdout.write(`           ${' '.repeat(24)}         ${r.why}\n`);
  }
  process.stdout.write(
    `\n  ${rows.length} worktree(s) ${poolMb} MB` +
    `${cacheMb ? ` + shared cache .studio-cache/ ${cacheMb} MB (counted, never reaped)` : ''}` +
    ` = ${totalMb} MB total, ceiling ${MAX_DISK_MB} MB\n`
  );
  if (removable.length) {
    process.stdout.write(`  RECLAIMABLE: ${removable.length} orphan(s), ${reclaimableMb} MB — ${flags.apply ? 'removed' : 'run with --apply to remove'}\n`);
  }
  if (stuck.length) {
    process.stdout.write(
      `\n  ORPHAN* — ${stuck.length} worktree(s) have UNCOMMITTED CHANGES and were NOT touched:\n` +
      stuck.map((r) => `      ${r.name}  ${r.path}\n`).join('') +
      '    The ticket is no longer in flight but somebody left work in the tree. Read it before you\n' +
      '    delete it. This reaper never runs `--force` and never will: one `git stash` in a shared\n' +
      '    tree cost 22 files of live work (DR4-027), and an automatic cleanup is the same move with\n' +
      '    better manners.\n'
    );
  }
  if (failed.length) {
    process.stdout.write('\n  REMOVAL FAILED:\n' + failed.map((f) => `      ${f.name}: ${f.error}\n`).join(''));
  }
  if (removed.length) process.stdout.write(`\n  Removed: ${removed.map((r) => r.name).join(', ')}\n`);
}

if (failed.length) {
  process.stderr.write('worktree-reap: at least one removal failed — the pool is not in the state this reports.\n');
  process.exit(1);
}

// Measured AFTER any removal, so `--apply` can bring a pool back under the ceiling in one call.
const finalMb = totalMb - removed.reduce((n, r) => n + r.mb, 0);
if (finalMb > MAX_DISK_MB) {
  process.stderr.write(
    `worktree-reap: BLOCKED — ${finalMb} MB (${poolMb} MB worktrees + ${cacheMb} MB shared cache) ` +
    `exceeds the ${MAX_DISK_MB} MB ceiling.\n` +
    `  The cache is not reclaimable by this tool — it is a warm build, and deleting it is yours:\n` +
    `    rm -rf ${cacheDir}\n` +
    `  ${stuck.length ? `${stuck.length} orphan(s) are dirty and cannot be reclaimed automatically; read them first.\n  ` : ''}` +
    'Reclaim space, or raise the ceiling deliberately — APP_TEAM_MAX_DISK_MB / --max-disk-mb.\n' +
    '  Raising a ceiling is the operator\'s decision, never a workaround an agent applies to keep going.\n'
  );
  process.exit(1);
}
process.exit(0);
