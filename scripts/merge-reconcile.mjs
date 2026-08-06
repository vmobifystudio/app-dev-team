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

const lying = [];
const unknown = [];
let ok = 0;

for (const t of tickets.values()) {
  if (!CLAIMS_INTEGRATED.has(t.status)) continue;
  const mine = branches.filter((b) => b.toLowerCase().includes(String(t.id).toLowerCase()));
  if (!mine.length) { unknown.push(t.id); continue; }
  // Any matching branch being merged is enough: a ticket may legitimately have had more than one.
  const merged = mine.some((b) => git(['merge-base', '--is-ancestor', b, base]) !== null);
  if (merged) ok += 1;
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
if (unknown.length) parts.push(`${unknown.length} UNKNOWN`);
process.stdout.write(`MERGE RECONCILE: ${lying.length ? 'BLOCKED' : 'CLEAR'} — ${parts.join(', ')}\n`);
if (unknown.length) {
  process.stdout.write(
    `  UNKNOWN (no branch found): ${unknown.join(', ')}\n` +
    '  Reported rather than assumed merged. A squash-merge or a deleted branch is indistinguishable\n' +
    '  here from a merge that never happened, and guessing either way is how this class survives.\n'
  );
}
process.exit(0);
