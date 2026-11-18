/**
 * Which branch is a ticket's, and is it on the integration branch — asked ONE way.
 *
 * merge-reconcile.mjs answered both questions inline; board.mjs now needs the same answers at
 * `approved --bind` (which commit was reviewed), `merged` (which tip must the approval equal) and
 * `closed` (is the code actually integrated). Three readers with three matchers would disagree on
 * the first ticket whose branch name is unusual, so the matcher lives here.
 */
import { execFileSync } from 'node:child_process';

/** A git runner bound to `cwd`: stdout trimmed on exit 0, null on any failure. */
export function gitAt(cwd) {
  return (args) => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
}

/** `develop`, then `main`, then `master` — the flagship model integrates on develop. '' when none. */
export function integrationBase(git, explicit = '') {
  if (explicit) return explicit;
  for (const candidate of ['develop', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate]) !== null) return candidate;
  }
  return '';
}

/** Every local branch whose name contains the ticket id (case-insensitive). */
export function ticketBranches(git, id) {
  const needle = String(id).toLowerCase();
  return (git(['branch', '--format=%(refname:short)']) || '')
    .split('\n').filter(Boolean).filter((b) => b.toLowerCase().includes(needle));
}

/**
 * The ticket's branch tip. `{sha, branch}` when exactly one branch is named for it, `{sha: ''}`
 * with `ambiguous` listing them when several are — guessing between two candidates is how the
 * wrong commit gets bound — and `{sha: ''}` when none is.
 */
export function ticketTip(git, id) {
  const mine = ticketBranches(git, id);
  if (mine.length !== 1) return { sha: '', branch: '', ambiguous: mine.length > 1 ? mine : [] };
  return { sha: git(['rev-parse', '--verify', `${mine[0]}^{commit}`]) || '', branch: mine[0], ambiguous: [] };
}

/** `merge-base --is-ancestor` prints nothing on success: this asks the exit code, never stdout. */
export function isAncestor(git, a, b) {
  return git(['merge-base', '--is-ancestor', a, b]) !== null;
}
