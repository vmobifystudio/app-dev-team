#!/usr/bin/env node
/**
 * worktree-slot — lease one worktree per SPAWNED WRITER: one ticket, one slot `<owner>-<n>` (C2-6).
 *
 * THE CONTRADICTION THIS RESOLVES (OPS-005, docs/reviews/2026-08-07-adversarial-operations-review.md).
 * Two rules in this plugin cannot both be followed:
 *
 *   `parallel-orchestrator` step 2   "Group by owner. ONE agent invocation per owner, batched.
 *                                     iOS dev gets all their ready tickets in one prompt."
 *   `agent-isolation` Rule 1         one worktree PER TICKET, `.agent-wt/APP-NNN`, and
 *                                    `spawn-gate.sh` checks `.agent-wt/<TICKET>` per ticket ID.
 *   `parallel-orchestrator` step 3   "Each agent's prompt must name ITS worktree path as the
 *                                     project root."
 *
 * One `ios-developer` owning three tickets is spawned ONCE, has three worktrees created for it, and
 * is told to use "its worktree path" — singular. There is no such path. Both resolutions are broken
 * today: work all three in one tree and the branches carry each other's files (which
 * `code-reviewer` check 9 correctly rejects, sending tech-manager hunting a collision the
 * orchestrator caused); or spawn once per ticket and throw away the batching step 2 exists for.
 *
 * It has not bitten yet only because no real multi-ticket-per-owner wave has run — the studio's own
 * throughput number is 19 tickets created, 1 closed. The first one hits it.
 *
 * THE FIX, and why it is smaller than it looks. The unit of isolation was never the ticket; it is
 * the WRITER. Two agents in one tree corrupt each other. One agent working three tickets one after
 * another in its own tree cannot corrupt anyone — it cuts `feat/APP-001`, commits, cuts
 * `feat/APP-002` from the same base, commits. Branch-per-ticket survives untouched. What changes is
 * that the DIRECTORY is keyed by owner:
 *
 *     .agent-wt/ios-developer      leased to ios-developer, holding APP-001, APP-002, APP-003
 *
 * Consequences, all of them wanted:
 *   - disk is bounded by PARALLELISM (the pool size), not by backlog size — OPS-006's leak becomes
 *     structurally impossible rather than something a reaper chases;
 *   - `spawn-gate.sh` needs NO change: it checks that `<dir>/<name>` is a real worktree, and owner
 *     names are names. Pass it the owners you are about to spawn;
 *   - one context build per owner per round instead of one per ticket.
 *
 * WHAT THIS DOES NOT DO. It does not create branches. The IC creates `feat/APP-NNN-slug` inside its
 * slot as its first action, exactly as `ic-workflow` step 0 already says. A slot is a place to
 * stand, not a claim on a branch — and keeping branch creation with the agent that writes the code
 * is what keeps `verify-done.sh`'s branch check meaningful.
 *
 * C2-6 / DESIGN DECISION 8 — ONE SPAWN PER TICKET, SLOTS KEYED `<owner>-<n>`. Keying by bare owner
 * meant an iOS-only app ran ONE developer at a time however high the cap was. A lease is now one
 * ticket, in the lowest free `<owner>-<n>` (n up to the scheduler's cap), so one platform can run
 * several ICs at once — each alone in its own tree, which is still the unit of isolation.
 *
 * Usage:
 *   worktree-slot.mjs lease  --owner <role> --tickets APP-001 [--pool N] [--base <branch>]
 *   worktree-slot.mjs release --slot <owner-n> | --owner <role> [--tickets APP-001]
 *   worktree-slot.mjs list [--json]
 *
 * Exit codes:
 *   0  leased / released / listed
 *   1  REFUSED — the pool is full, or this owner already holds a slot with different tickets
 *   2  CANNOT EVALUATE — not a git repository, or the state file is unreadable
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { withFileLock } from './lib/atomic.mjs';
import { effectiveCap } from './scheduler.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`worktree-slot: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'owner', 'tickets', 'slot', 'pool', 'dir', 'base', 'state']),
  die,
});
const [command] = positional;

let ROOT;
if (typeof flags.root === 'string') {
  ROOT = resolve(flags.root);
} else {
  const resolved = resolveProjectRoot({ explicit: typeof flags['project-root'] === 'string' ? flags['project-root'] : '' });
  if (!resolved.ok) die(2, explainRootFailure(resolved));
  ROOT = resolved.root;
}
const DIR = typeof flags.dir === 'string' ? flags.dir : '.agent-wt';
const STATE = typeof flags.state === 'string' ? resolve(flags.state) : resolve(ROOT, 'docs/team/worktree-slots.json');

// The default pool is the scheduler's cap (scheduler.mjs effectiveCap: the plan's max_parallel, else
// MAX_PARALLEL) — one number, one owner (C9). --pool / APP_TEAM_SLOT_POOL still override it.
const PLAN = resolve(ROOT, 'docs/team/schedule.json');
let plan = null;
try { plan = existsSync(PLAN) ? JSON.parse(readFileSync(PLAN, 'utf8')) : null; } catch { plan = null; }
const POOL = Number(flags.pool ?? process.env.APP_TEAM_SLOT_POOL ?? effectiveCap(plan));
if (!Number.isFinite(POOL) || POOL < 1) die(2, `--pool must be at least 1, got "${flags.pool ?? process.env.APP_TEAM_SLOT_POOL}"`);

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
try { git(['rev-parse', '--is-inside-work-tree']); }
catch { die(2, `not a git repository at ${ROOT} — worktrees are unavailable, so serialize the writers instead.\n  One at a time, each committing before the next starts. Say so in the standup.`); }

function readState() {
  if (!existsSync(STATE)) return { schema: 'worktree-slots/v1', pool: POOL, slots: {} };
  try { return JSON.parse(readFileSync(STATE, 'utf8')); }
  catch (e) { die(2, `cannot read ${STATE}: ${e.message}\n  An unreadable lease file is CANNOT EVALUATE, never an empty pool — leasing on top of it\n  would hand a slot to a second writer.`); }
  return null;
}

// Called only inside the lease/release lock below — the whole read/decide/create/write is one
// critical section (C7-3). Locking only this write let 4 concurrent leases with --pool 2 all read
// the same empty state, all pass the pool check and create 4 worktrees, and record just 1.
function writeState(state) {
  writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);
}

/** Is `<DIR>/<name>` an actual worktree? Same test spawn-gate.sh applies, for the same reason. */
function isWorktree(name) {
  const path = resolve(ROOT, DIR, name);
  if (!existsSync(path)) return false;
  try { return resolve(git(['rev-parse', '--show-toplevel'], { cwd: path })) === path; }
  catch { return false; }
}

function cmdLease() {
  const owner = typeof flags.owner === 'string' ? flags.owner : '';
  if (!owner) die(2, 'lease needs --owner <role> — the slot is keyed by the WRITER, which is the unit of isolation.');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(owner)) die(2, `--owner "${owner}" is not a role name.\n  It becomes a directory name under ${DIR}/, so it must be the plain role slug: ios-developer.`);
  // C3W-6: a gate role judges someone else's branch; it never writes one, so it never holds a slot.
  if (['code-reviewer', 'tech-lead', 'security-reviewer', 'privacy-reviewer', 'release-auditor', 'red-team-agent'].includes(owner)) {
    die(1, `REFUSED: ${owner} is a gate role — it gets no slot. It reads the branch from the main checkout and runs or\n` +
      '  edits only in a scratch `git worktree add --detach "$(mktemp -d)" <tip>` its composed prompt prints.\n' +
      `  Spawn it with \`spawn-prompt.mjs compose --role ${owner}\` output as-is; lease nothing.`);
  }
  const tickets = String(flags.tickets ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!tickets.length) die(2, 'lease needs --tickets APP-001 — a slot with no ticket is a tree nobody asked for.');
  // ONE SPAWN PER TICKET (design decision 8, W2-15): a batch of tickets in one tree is one agent
  // whose branches carry each other's files. Lease each ticket its own slot instead.
  if (tickets.length > 1) die(1, `REFUSED: one lease per ticket — lease ${tickets.join(', ')} one at a time; each gets its own ${owner}-<n> slot and its own spawn.`);
  const ticket = tickets[0];

  const state = readState();
  const held = Object.entries(state.slots || {});
  const ownerOf = (name, slot) => slot.owner || name; // pre-C2-6 state files keyed slots by bare owner
  const mineEntry = held.find(([name, sl]) => ownerOf(name, sl) === owner && (sl.tickets || []).includes(ticket));
  const mine = mineEntry ? mineEntry[1] : null;

  // Re-leasing the ticket this owner already holds returns the SAME slot. `--force` used to be
  // checked here, undocumented, disabling the guard below; removed (B6) and still absent.
  if (mine) {
    process.stdout.write(`LEASED: ${mine.path} (already held by ${owner} for ${ticket})\n`);
    return;
  }
  // ONE WRITER PER TICKET: the guard that matters — the "two orchestrators both hand out work"
  // window that `claimed` closes for tickets, applied to the tree the work happens in.
  const elsewhere = held.find(([, sl]) => (sl.tickets || []).includes(ticket));
  if (elsewhere) {
    die(1, `REFUSED: ${ticket} is already leased in ${DIR}/${elsewhere[0]}. Two writers on one ticket is the\n` +
           `  collision this file exists to prevent. Release it first — worktree-slot.mjs release --slot ${elsewhere[0]}.`);
  }

  const others = held;
  if (!mine && others.length >= POOL) {
    die(1, `REFUSED: the worktree pool is full — ${others.length} of ${POOL} slot(s) leased:\n` +
           others.map(([name, sl]) => `    ${name}  ${(sl.tickets || []).join(', ')}\n`).join('') +
           '  This is the round\'s parallelism cap doing its job. Either release a finished slot, raise\n' +
           '  the cap deliberately (--pool N), or serialize this ticket into the next wave. Raising it\n' +
           '  is a decision about how much of this machine the studio may use, not a workaround.');
  }
  let n = 1;
  while (state.slots?.[`${owner}-${n}`]) n += 1;
  const slot = `${owner}-${n}`;

  // FOUND BY RUNNING A REAL SPRINT (H9, 2026-08-09): `git worktree add` snapshots the last COMMIT,
  // never the live working directory — an uncommitted spec is invisible to the developer cut from
  // it. Report-only, read BEFORE this command's own writes. `docs/team/` is excluded: its state
  // files churn on every ordinary call, and a warning that always fires is ignored.
  const dirtyBefore = git(['status', '--porcelain'])
    .split('\n')
    .filter((line) => line.trim() && !/(^|[\s"])docs\/team\//.test(line))
    .join('\n');

  // DETACHED at the base: the IC cuts `feat/APP-NNN-slug` itself as its first action (ic-workflow).
  let base = typeof flags.base === 'string' ? flags.base : '';
  if (!base) {
    try { base = execFileSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { base = ''; }
  }
  if (!isWorktree(slot)) {
    if (!base) {
      die(2, 'the integration branch could not be resolved, so there is no base to create the slot from.\n' +
             '  Declare it in docs/23-git-strategy.md as: Integration branch: <name>\n' +
             '  Guessing `main` here is how a develop-model project gets branches cut from the wrong base,\n' +
             '  which is not recoverable by a later fix.');
    }
    try { git(['worktree', 'add', '--detach', resolve(ROOT, DIR, slot), base]); }
    catch (e) { die(2, `could not create ${DIR}/${slot}: ${String(e.stderr || e.message).trim()}`); }
  }

  state.pool = POOL;
  state.slots = { ...(state.slots || {}), [slot]: { owner, path: `${DIR}/${slot}`, tickets, base: flags.base ?? null, leasedAt: new Date().toISOString() } };
  writeState(state);

  if (dirtyBefore) {
    process.stdout.write(
      `  NOTE: the base tree had ${dirtyBefore.split('\n').length} uncommitted path(s) before this lease.\n` +
      '  This new worktree was cut from the last COMMIT, not the working directory — it will NOT see\n' +
      '  them. If the ticket or spec this owner needs was just written and not yet committed, commit\n' +
      '  it now or the developer will correctly report BLOCKED on work that, to git, does not exist yet.\n\n'
    );
  }

  process.stdout.write(
    `LEASED: ${DIR}/${slot}\n` +
    `  owner    ${owner}\n` +
    `  ticket   ${ticket}\n` +
    `  pool     ${Object.keys(state.slots).length} of ${POOL} slot(s) in use\n\n` +
    `  Spawn ONE ${owner} for ${ticket}, with ${DIR}/${slot} as its project root. Its first action cuts\n` +
    `  feat/${ticket}-<slug> from ${base || 'the integration branch'} inside that tree.\n\n` +
    '  Then run the isolation gate on the SLOTS you are about to spawn into:\n' +
    `    sh "\${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ${Object.keys(state.slots).join(' ')}\n`
  );
}

function cmdRelease() {
  const state = readState();
  const held = Object.entries(state.slots || {});
  let name = typeof flags.slot === 'string' ? flags.slot : '';
  // `--owner <slot name>` (ios-developer-2) names the slot directly — the form the prose uses.
  if (!name && typeof flags.owner === 'string' && state.slots?.[flags.owner]) name = flags.owner;
  if (!name) {
    const owner = typeof flags.owner === 'string' ? flags.owner : '';
    if (!owner) die(2, 'release needs --slot <owner-n>, or --owner <role> [--tickets APP-001]');
    const ticket = String(flags.tickets ?? '').trim();
    const mine = held.filter(([n, sl]) => (sl.owner || n) === owner && (!ticket || (sl.tickets || []).includes(ticket)));
    if (!mine.length) { process.stdout.write(`worktree-slot: ${owner} holds no lease${ticket ? ` for ${ticket}` : ''} — nothing to release.\n`); return; }
    if (mine.length > 1) die(1, `${owner} holds ${mine.length} slots (${mine.map(([n]) => n).join(', ')}) — name one: --slot <owner-n> or --tickets <ID>.`);
    [[name]] = mine;
  }
  if (!state.slots?.[name]) { process.stdout.write(`worktree-slot: ${name} holds no lease — nothing to release.\n`); return; }
  const tickets = state.slots[name].tickets || [];
  delete state.slots[name];
  writeState(state);
  process.stdout.write(
    `RELEASED: ${name} (was holding ${tickets.join(', ') || 'nothing'})\n` +
    `  The lease is gone; the TREE is still there. Reclaiming it is worktree-reap.mjs's job, which\n` +
    `  refuses to remove a worktree with uncommitted changes — so unfinished work in ${DIR}/${name}\n` +
    '  stops the removal and gets reported rather than deleted:\n' +
    '    node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply\n'
  );
}

function cmdList() {
  const state = readState();
  const slots = Object.entries(state.slots || {});
  if (flags.json) { process.stdout.write(`${JSON.stringify({ schema: 'worktree-slots-list/v1', pool: state.pool ?? POOL, slots: state.slots ?? {} }, null, 2)}\n`); return; }
  process.stdout.write(`WORKTREE SLOTS — ${slots.length} of ${state.pool ?? POOL} in use\n\n`);
  if (!slots.length) process.stdout.write('  none leased\n');
  for (const [name, s] of slots) {
    process.stdout.write(`  ${name.padEnd(24)} ${(s.tickets || []).join(', ')}${isWorktree(name) ? '' : '   TREE MISSING — the lease outlived its worktree; release it'}\n`);
  }
}

switch (command) {
  case 'lease': withFileLock(STATE, cmdLease, { die }); break;
  case 'release': withFileLock(STATE, cmdRelease, { die }); break;
  case 'list': cmdList(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n` +
           '  lease   --owner <role> --tickets APP-001 [--pool N] [--base <branch>]\n' +
           '  release --slot <owner-n> | --owner <role> [--tickets APP-001]\n' +
           '  list    [--json]');
}
