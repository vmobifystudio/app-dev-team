/**
 * Which branch is a ticket's, and is it on the integration branch — asked ONE way.
 *
 * merge-reconcile.mjs answered both questions inline; board.mjs now needs the same answers at
 * `approved --bind` (which commit was reviewed), `merged` (which tip must the approval equal) and
 * `closed` (is the code actually integrated). Three readers with three matchers would disagree on
 * the first ticket whose branch name is unusual, so the matcher lives here.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A git runner bound to `cwd`: stdout trimmed on exit 0, null on any failure. */
export function gitAt(cwd) {
  return (args) => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { return null; }
  };
}

/**
 * The branch DECLARED in docs/23-git-strategy.md (or 20-architecture.md), resolved by the one
 * resolver wave-integrate lands on (integration-branch.sh) — else `develop`, then `main`, then
 * `master`. Codex on PR #46: a project declaring `main` that still had a `develop` branch got its
 * waves landed on main while `closed` checked develop and refused. '' when none.
 */
export function integrationBase(git, explicit = '') {
  if (explicit) return explicit;
  const top = git(['rev-parse', '--show-toplevel']);
  if (top) {
    const r = spawnSync('sh', [resolve(HERE, '..', 'integration-branch.sh')], { cwd: top, encoding: 'utf8' });
    const name = (r.stdout || '').trim();
    if (r.status === 0 && name && /\(declared in /.test(r.stderr || '')) return name;
  }
  for (const candidate of ['develop', 'main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', candidate]) !== null) return candidate;
  }
  return '';
}

/**
 * Is `name` (a branch, or another ticket id) named for ticket `id`? WHOLE-ID match: the id must
 * start the name or follow a `/`, and be followed by the end or `-<letter>…` (a slug). The ID part
 * is case-sensitive. `includes()` made APP-1 match feat/APP-10-x and APP-001 match APP-0010
 * (G2-20, W2-4) — one ticket's branch bound another's approval, evidence and integration check.
 *
 * A NAME ALONE CANNOT TELL A SLUG FROM AN ID SUFFIX: feat/APP-001-analytics-events is either
 * APP-001's "analytics-events" branch or APP-001-analytics's "events" branch. So ownership goes to
 * the LONGEST board id that matches: pass `allIds` (ticketIdsFromBoard, or the reduced board's ids)
 * and `id` loses the name to any longer `id-…` ticket that also matches it.
 *   feat/APP-001-login  ~ APP-001     feat/APP-0010-x !~ APP-001
 *   feat/APP-001-analytics-events ~ APP-001-analytics, and !~ APP-001 when APP-001-analytics is on the board
 */
const SLUG = '(-[A-Za-z][A-Za-z0-9._-]*)?';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const bare = (name, id) => new RegExp(`(^|/)${esc(id)}${SLUG}$`).test(name);
export function matchesTicket(name, id, allIds = []) {
  const want = String(id ?? '').trim();
  const n = String(name ?? '');
  if (!want || !bare(n, want)) return false;
  return !allIds.some((other) => {
    const o = String(other ?? '').trim();
    return o.length > want.length && o.startsWith(`${want}-`) && bare(n, o);
  });
}

/** Every ticket id `created` on the board log under `root` ([] when there is none). */
export function ticketIdsFromBoard(root, log = 'docs/31-board-events.jsonl') {
  try {
    return readFileSync(resolve(root, log), 'utf8').split('\n').flatMap((l) => {
      try { const e = JSON.parse(l); return e.event === 'created' && e.ticket ? [String(e.ticket)] : []; } catch { return []; }
    });
  } catch { return []; }
}

/** Every local branch named for the ticket (matchesTicket, longest board id wins). */
export function ticketBranches(git, id, allIds = []) {
  return (git(['branch', '--format=%(refname:short)']) || '')
    .split('\n').filter(Boolean).filter((b) => matchesTicket(b, id, allIds));
}

/**
 * The ticket's branch tip. `{sha, branch}` when exactly one branch is named for it, `{sha: ''}`
 * with `ambiguous` listing them when several are — guessing between two candidates is how the
 * wrong commit gets bound — and `{sha: ''}` when none is.
 */
export function ticketTip(git, id, allIds = []) {
  const mine = ticketBranches(git, id, allIds);
  if (mine.length !== 1) return { sha: '', branch: '', ambiguous: mine.length > 1 ? mine : [] };
  return { sha: git(['rev-parse', '--verify', `${mine[0]}^{commit}`]) || '', branch: mine[0], ambiguous: [] };
}

/** `merge-base --is-ancestor` prints nothing on success: this asks the exit code, never stdout. */
export function isAncestor(git, a, b) {
  return git(['merge-base', '--is-ancestor', a, b]) !== null;
}
