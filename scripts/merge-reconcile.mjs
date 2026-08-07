#!/usr/bin/env node
/**
 * merge-reconcile — does the board's `merged` agree with git?
 *
 * FOUND BY EXECUTION, 2026-08-06, in a five-minute targeted experiment with no agents involved:
 *
 *   git merge FAILED (a dirty tree refused the checkout)
 *   board.mjs move APP-001 merged   -> accepted
 *   board.mjs move APP-001 qa_passed -> accepted
 *   board.mjs move APP-001 closed    -> accepted
 *   final state: done. main does not contain the commit. The branch is not merged.
 *
 * A ticket reached `done` — the strongest claim this system makes — with the code never merged.
 * That is FC-003 ("green while nothing happened") living inside the merge gate, which is the
 * single most consequential transition on the board.
 *
 * WHY THE GATE CANNOT SIMPLY CHECK THIS ITSELF. `board.mjs move <ID> merged` is deliberately a
 * PRECONDITION: tech-manager.md says it "runs before any git command", so that a merge which must
 * not happen is refused before anything touches the repository. That ordering is correct and worth
 * keeping — it is why an unapproved merge is impossible rather than merely detectable.
 *
 * But a precondition is not a confirmation, and nothing was checking afterwards. The window between
 * "allowed to merge" and "merged" was unobserved, and any failure inside it — a conflict, a dirty
 * tree, a push rejection, an agent that simply never ran the command — left the board asserting a
 * merge that did not exist.
 *
 * So this reconciles. It does not replace the gate; it closes the window the gate leaves open by
 * construction.
 *
 * WHAT IT CHECKS. For every ticket whose board state claims the code is integrated (`qa` or `done`),
 * find a branch named for that ticket and ask git whether it is an ancestor of the integration
 * branch. Three answers, and the third is why this is not a naive `--merged` grep:
 *
 *   MERGED       the branch is in the integration branch. The board is telling the truth.
 *   NOT MERGED   the branch exists and is not integrated. The board is lying. BLOCKED.
 *   UNKNOWN      no branch matches this ticket. Reported as CANNOT EVALUATE, never as merged:
 *                a squash-merge or a deleted branch looks exactly like a merge that never happened,
 *                and guessing in either direction is how this class survives.
 *
 * Usage:  merge-reconcile.mjs [--root <dir>] [--base <branch>]
 * Exit:   0 every integrated claim is true (or there are none)
 *         1 a ticket claims integration and its branch is not merged
 *         2 cannot evaluate — a repository that exists could not be read
 *   N/A (exit 0) no git, no board, or no integration branch: nothing for this class to be true of
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { parseArgs } from './lib/args.mjs';
import { parseEventLog, reduce } from './lib/events.mjs';

const die = (code, message) => { process.stderr.write(`merge-reconcile: ${message}\n`); process.exit(code); };
const { flags } = parseArgs(process.argv.slice(2), { valueFlags: new Set(['root', 'base', 'log']), die });

const ROOT = resolve(String(flags.root || '.'));
const LOG = typeof flags.log === 'string' ? resolve(flags.log) : resolve(ROOT, 'docs/31-board-events.jsonl');

const git = (args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

// N/A, NOT CANNOT-EVALUATE — and I got this wrong here for the second time in one day, having
// made the identical mistake in silent-fallback-scan.mjs hours earlier.
//
// Exiting 2 for "no git" or "no board" felt right ("we could not check"), and it poisoned six
// ship-gate fixtures that are docs-only directories: the release gate went CANNOT EVALUATE on
// projects that were genuinely fine. That is the false-BLOCK half of the false-positive problem,
// and it switches a gate off just as fast as noise does.
//
// The distinction that resolves it: a phantom merge is a claim about CODE. A project with no git
// has no branches to be unmerged and no code to be missing — there is nothing for this class to be
// true of. That is NOT APPLICABLE. Exit 2 is reserved for a repository that exists and could not
// be read, which is a genuinely different sentence.
if (git(['rev-parse', '--git-dir']) === null) {
  process.stdout.write('MERGE RECONCILE: N/A — not a git repository, so there are no branches to reconcile.\n');
  process.exit(0);
}
if (!existsSync(LOG)) {
  process.stdout.write('MERGE RECONCILE: N/A — no event log, so no ticket claims its code is integrated.\n');
  process.exit(0);
}

// The integration branch, resolved the same way everything else here resolves it rather than
// assuming `main` — the flagship model integrates on `develop`, and a check that silently compared
// against the wrong branch would report every ticket as unmerged.
let base = typeof flags.base === 'string' ? flags.base : '';
if (!base) {
  for (const candidate of ['develop', 'main', 'master']) {
    if (git(['rev-parse', '--verify', candidate]) !== null) { base = candidate; break; }
  }
}
if (!base) {
  // A repository with no develop/main/master is usually a fresh fixture with a single unnamed
  // branch. Stated, and not treated as a failure to look at something that exists.
  process.stdout.write('MERGE RECONCILE: N/A — no develop/main/master branch to integrate into.\n');
  process.exit(0);
}

let tickets;
try { tickets = reduce(parseEventLog(readFileSync(LOG, 'utf8')).events).tickets; }
catch (e) { die(2, `cannot read the event log: ${e.message}`); }

const branches = (git(['branch', '--format=%(refname:short)']) || '').split('\n').filter(Boolean);
const CLAIMS_INTEGRATED = new Set(['qa', 'done']);

/**
 * `qa` MEANS TWO DIFFERENT THINGS NOW, AND CONFLATING THEM DEADLOCKS THE LOOP.
 *
 * When this file was written, `board.mjs move <ID> merged` was immediately followed by `git merge`
 * in the same breath — tech-manager merged per ticket — so a ticket at `qa` whose branch was not an
 * ancestor of the integration branch could only mean the board was lying. That was true and this
 * check was right.
 *
 * The wave model (`wave-integrate.mjs`, 2026-08-07) split those two acts on purpose. The merge gate
 * is now PERMISSION and the wave pass is the FACT, and between them every gated ticket sits at `qa`
 * with an unmerged branch. That is not a lie; it is the design, and `tech-manager.md` says so.
 *
 * MEASURED CONSEQUENCE OF NOT KNOWING THAT. This file is a precondition of `orchestrator.mjs round`,
 * whose exit 1 means "spawn nobody this round". So a wave that failed (exit 1), a wave that could
 * not run (exit 2 — the expected path wherever no `full` scope is declared), or a round that simply
 * ended between step 4 and step 5 left the next round BLOCKED by a false accusation, with the
 * remedy text telling the operator to hand-merge — i.e. to route around the wave model. Reproduced
 * on a fixture the day the wave model landed.
 *
 * THE SIGNAL ALREADY EXISTED, so this needs no new field and no new event. `verified_static` is
 * exactly "reviewed, merge-gated, and the suite has NOT run", and the wave's green is what upgrades
 * it to a real `verified`:
 *
 *   qa + verifiedStatic   the wave has not run yet          -> PENDING. Report it. Not a lie.
 *   qa - verifiedStatic   the wave ran and reported green   -> the branch MUST be integrated.
 *   done                  cannot be reached without both    -> the branch MUST be integrated.
 *
 * A project that does NOT use the wave model is unaffected: it merges per ticket, `verifiedStatic`
 * is false at `qa`, and this bites exactly as it always did.
 */
const awaitingWave = (t) => t.status === 'qa' && t.verifiedStatic === true;

const lying = [];
const pending = [];
const unknown = [];
let ok = 0;

for (const t of tickets.values()) {
  if (!CLAIMS_INTEGRATED.has(t.status)) continue;
  const mine = branches.filter((b) => b.toLowerCase().includes(String(t.id).toLowerCase()));
  if (!mine.length) { unknown.push(t.id); continue; }
  // Any matching branch being merged is enough: a ticket may legitimately have had more than one.
  const merged = mine.some((b) => git(['merge-base', '--is-ancestor', b, base]) !== null);
  if (merged) ok += 1;
  else if (awaitingWave(t)) pending.push({ id: t.id, branches: mine });
  else lying.push({ id: t.id, status: t.status, branches: mine });
}

if (lying.length) {
  process.stdout.write(`MERGE RECONCILE: ${lying.length} ticket(s) claim integrated code that is NOT in ${base}\n\n`);
  for (const l of lying) {
    process.stdout.write(`  ${l.id} [${l.status}] — ${l.branches.join(', ')} is not an ancestor of ${base}\n`);
  }
  process.stdout.write(
    '\n  The board asserts this code is integrated and git says it is not.\n' +
    '  `board.mjs move <ID> merged` is a PRECONDITION — it runs before any git command, by design,\n' +
    '  so an unapproved merge is impossible. It cannot confirm the merge afterwards, and nothing\n' +
    '  was doing so: a conflict, a dirty tree, a rejected push, or an agent that simply never ran\n' +
    '  the command all left the board claiming a merge that never happened.\n' +
    '\n  Merge it, or correct the board with `board.mjs move <ID> corrected` naming what went wrong.\n'
  );
  process.exit(1);
}

const parts = [`${ok} integrated claim(s) verified against ${base}`];
if (pending.length) parts.push(`${pending.length} awaiting the wave`);
if (unknown.length) parts.push(`${unknown.length} UNKNOWN`);
process.stdout.write(`MERGE RECONCILE: ${lying.length ? 'BLOCKED' : 'CLEAR'} — ${parts.join(', ')}\n`);
if (pending.length) {
  process.stdout.write(
    `  AWAITING INTEGRATION: ${pending.map((p) => p.id).join(', ')}\n` +
    '  Merge-gated and carrying `verified_static`, so the wave pass has not run for them yet. This\n' +
    '  is the wave model working, not the board lying: the gate is permission, the wave is the fact.\n' +
    '  Land them with:  node scripts/wave-integrate.mjs --root . --wave <N>\n' +
    '  They cannot reach `closed` and `ship-gate.sh` blocks the release until it has.\n'
  );
}
if (unknown.length) {
  process.stdout.write(
    `  UNKNOWN (no branch found): ${unknown.join(', ')}\n` +
    '  Reported rather than assumed merged. A squash-merge or a deleted branch is indistinguishable\n' +
    '  here from a merge that never happened, and guessing either way is how this class survives.\n'
  );
}
process.exit(0);
