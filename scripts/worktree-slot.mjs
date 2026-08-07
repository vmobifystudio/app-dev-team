#!/usr/bin/env node
/**
 * worktree-slot — lease one worktree per WRITING AGENT, not one per ticket.
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
 * Usage:
 *   worktree-slot.mjs lease  --owner <role> --tickets APP-001,APP-002 [--pool N] [--base <branch>]
 *   worktree-slot.mjs release --owner <role>
 *   worktree-slot.mjs list [--json]
 *
 * Exit codes:
 *   0  leased / released / listed
 *   1  REFUSED — the pool is full, or this owner already holds a slot with different tickets
 *   2  CANNOT EVALUATE — not a git repository, or the state file is unreadable
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/args.mjs';
import { resolveProjectRoot, explainRootFailure } from './lib/root.mjs';
import { withFileLock } from './lib/atomic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const die = (code, message) => { process.stderr.write(`worktree-slot: ${message}\n`); process.exit(code); };

const { flags, positional } = parseArgs(process.argv.slice(2), {
  valueFlags: new Set(['root', 'project-root', 'owner', 'tickets', 'pool', 'dir', 'base', 'state']),
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

// The default pool is 3, which is `tech-manager.md`'s own stated default pod ("Default pod is 3
// developers"). Naming the same number twice is a drift risk, so it is stated here as a DEFAULT the
// caller overrides rather than as a rule: /app-build passes --pool from the sprint plan.
const POOL = Number(flags.pool ?? process.env.APP_TEAM_SLOT_POOL ?? 3);
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

function writeState(state) {
  mkdirSync(dirname(STATE), { recursive: true });
  withFileLock(STATE, () => { writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`); }, { die });
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
  const tickets = String(flags.tickets ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!tickets.length) die(2, 'lease needs --tickets APP-001,APP-002 — a slot with no tickets is a tree nobody asked for.');

  const state = readState();
  const held = Object.entries(state.slots || {});
  const mine = state.slots?.[owner];

  // A SECOND LEASE TO THE SAME OWNER IS REFUSED, and this is the guard that matters: it is exactly
  // the "two orchestrators both hand out work" window that `parallel-orchestrator` closes for
  // tickets with `claimed`, applied to the tree the work happens in.
  // `!flags.force` USED TO BE HERE, undocumented, disabling the check this file's own header calls
  // the guard that matters. A flag that turns off a guard and appears in no usage string is not an
  // escape hatch, it is a hole with a password — and the legitimate path already exists and is one
  // command: release the slot once its wave is committed and merged. Removed (B6).
  if (mine) {
    const same = JSON.stringify(mine.tickets) === JSON.stringify(tickets);
    if (!same) {
      die(1, `REFUSED: ${owner} already holds ${DIR}/${owner} for ${mine.tickets.join(', ')}.\n` +
             `  You asked for ${tickets.join(', ')}. Two waves in one tree is the collision this file exists\n` +
             `  to prevent. Release it first — worktree-slot.mjs release --owner ${owner} — once that\n` +
             '  wave\'s work is committed and merged.');
    }
  }

  const others = held.filter(([name]) => name !== owner);
  if (!mine && others.length >= POOL) {
    die(1, `REFUSED: the worktree pool is full — ${others.length} of ${POOL} slot(s) leased:\n` +
           others.map(([name, s]) => `    ${name}  ${(s.tickets || []).join(', ')}\n`).join('') +
           '  This is the round\'s parallelism cap doing its job. Either release a finished slot, raise\n' +
           '  the cap deliberately (--pool N), or serialize this owner into the next wave. Raising it\n' +
           '  is a decision about how much of this machine the studio may use, not a workaround.');
  }

  // Create the tree DETACHED at the base. Detached rather than on a branch because the IC cuts
  // `feat/APP-NNN-slug` itself as its first action (ic-workflow step 0) — creating a branch here
  // would either name one ticket of several, or leave a branch nobody asked for on every slot.
  if (!isWorktree(owner)) {
    let base = typeof flags.base === 'string' ? flags.base : '';
    if (!base) {
      try { base = execFileSync('sh', [resolve(HERE, 'integration-branch.sh')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
      catch { base = ''; }
    }
    if (!base) {
      die(2, 'the integration branch could not be resolved, so there is no base to create the slot from.\n' +
             '  Declare it in docs/23-git-strategy.md as: Integration branch: <name>\n' +
             '  Guessing `main` here is how a develop-model project gets branches cut from the wrong base,\n' +
             '  which is not recoverable by a later fix.');
    }
    try { git(['worktree', 'add', '--detach', resolve(ROOT, DIR, owner), base]); }
    catch (e) { die(2, `could not create ${DIR}/${owner}: ${String(e.stderr || e.message).trim()}`); }
  }

  state.pool = POOL;
  state.slots = { ...(state.slots || {}), [owner]: { path: `${DIR}/${owner}`, tickets, base: flags.base ?? null, leasedAt: new Date().toISOString() } };
  writeState(state);

  process.stdout.write(
    `LEASED: ${DIR}/${owner}\n` +
    `  owner    ${owner}\n` +
    `  tickets  ${tickets.join(', ')}\n` +
    `  pool     ${Object.keys(state.slots).length} of ${POOL} slot(s) in use\n\n` +
    '  Spawn this owner ONCE, with this path as its project root and all of these ticket IDs. It\n' +
    '  works them one after another in here, cutting feat/<TICKET>-slug per ticket and committing\n' +
    '  between — so every branch carries only its own ticket\'s files, which is what code-reviewer\n' +
    '  check 9 verifies.\n\n' +
    `  Then run the isolation gate on the OWNERS you are about to spawn, not the tickets:\n` +
    `    sh scripts/spawn-gate.sh ${Object.keys(state.slots).join(' ')}\n`
  );
}

function cmdRelease() {
  const owner = typeof flags.owner === 'string' ? flags.owner : '';
  if (!owner) die(2, 'release needs --owner <role>');
  const state = readState();
  if (!state.slots?.[owner]) { process.stdout.write(`worktree-slot: ${owner} holds no lease — nothing to release.\n`); return; }
  const tickets = state.slots[owner].tickets || [];
  delete state.slots[owner];
  writeState(state);
  process.stdout.write(
    `RELEASED: ${owner} (was holding ${tickets.join(', ') || 'nothing'})\n` +
    `  The lease is gone; the TREE is still there. Reclaiming it is worktree-reap.mjs's job, which\n` +
    `  refuses to remove a worktree with uncommitted changes — so unfinished work in ${DIR}/${owner}\n` +
    '  stops the removal and gets reported rather than deleted:\n' +
    '    node scripts/worktree-reap.mjs --root . --apply\n'
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
  case 'lease': cmdLease(); break;
  case 'release': cmdRelease(); break;
  case 'list': cmdList(); break;
  default:
    die(1, `unknown command "${command ?? ''}"\n` +
           '  lease   --owner <role> --tickets APP-001,APP-002 [--pool N] [--base <branch>]\n' +
           '  release --owner <role>\n' +
           '  list    [--json]');
}
