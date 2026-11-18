/**
 * Is each approval bound to the exact change it claims to approve — ONE implementation, read by
 * `approval-check.mjs` (ship-gate, the merge gate in prose) and by `board.mjs move <T> merged`
 * (the merge gate in code) so the two can never disagree.
 *
 * ONLY THE LATEST APPROVAL PER (TICKET, ROLE) COUNTS. A ticket reviewed twice carries two
 * `approved` events; the first binds a commit the second superseded. Evaluating both made the old
 * one fail ("not the change on disk") forever, so a re-reviewed ticket could never merge (W5).
 * Superseded approvals are ignored, not failures.
 *
 * WITH A TICKET AND A HEAD, THE APPROVED COMMIT MUST EQUAL THE HEAD. The ancestor test let a
 * commit added after the review ride in under it (G-F2). Without a ticket — ship-gate checking a
 * release candidate that integrates many tickets — no single approval can equal the head, so the
 * check there is "the approved commit is IN what ships" (ancestor) AND (G2-9) "the ticket's branch
 * did not move after it was approved": a branch still carrying commits past its approval shipped
 * them unreviewed under the ancestor test. A ticket whose branch is gone is judged by ancestry.
 */
import { createHash } from 'node:crypto';

import { gitAt, isAncestor, ticketTip } from './integration.mjs';

const sameTicket = (a, b) => String(a ?? '').toUpperCase() === String(b ?? '').toUpperCase();

/**
 * @param {object[]} events   parsed board events
 * @param {{ticket?: string, head?: string, cwd?: string}} opts
 * @returns {{counted: object[], superseded: number, issues: string[]}}
 */
export function checkApprovals(events, { ticket = '', head = '', cwd = process.cwd() } = {}) {
  const git = gitAt(cwd);
  const all = events.filter((e) => e.event === 'approved' && (!ticket || sameTicket(e.ticket, ticket)));
  const latest = new Map();
  for (const e of all) latest.set(`${String(e.ticket).toUpperCase()}\u0000${e.by || ''}`, e);
  const counted = [...latest.values()];
  const ids = [...new Set(events.filter((e) => e.event === 'created').map((e) => String(e.ticket)))];
  const issues = [];
  const headSha = head ? git(['rev-parse', '--verify', `${head}^{commit}`]) : null;
  if (head && !headSha) issues.push(`--head ${head} does not resolve to a commit`);

  for (const event of counted) {
    let detail = event.detail;
    if (typeof detail === 'string') { try { detail = JSON.parse(detail); } catch { detail = null; } }
    const id = event.ticket || 'unknown-ticket';
    for (const field of ['commit', 'diff_hash', 'context_snapshot', 'evidence_hash']) if (!detail?.[field]) issues.push(`${id}: approved event is missing detail.${field}`);
    if (!detail?.commit) continue;
    if (git(['cat-file', '-e', `${detail.commit}^{commit}`]) === null) issues.push(`${id}: approval commit does not exist: ${detail.commit}`);
    if (headSha && detail.commit !== headSha) {
      const behind = isAncestor(git, detail.commit, headSha);
      if (ticket) {
        issues.push(behind
          ? `${id}: ${headSha} has commits added after the approval of ${detail.commit} — a re-review is needed (approve again, bound to the new tip)`
          : `${id}: approval commit ${detail.commit} is not the head ${headSha} and not an ancestor of it`);
      } else if (!behind) {
        issues.push(`${id}: approval commit ${detail.commit} is not an ancestor of ${head}`);
      }
    }
    if (!ticket) {
      const tip = ticketTip(git, id, ids);
      if (tip.sha && tip.sha !== detail.commit) {
        issues.push(`${id}: its branch ${tip.branch} is at ${tip.sha.slice(0, 12)}, not the approved ${String(detail.commit).slice(0, 12)} — commits after the approval are unreviewed. Re-review, or drop them.`);
      }
    }
    // VERIFY THE CANDIDATE THE APPROVAL NAMED, NOT ITS LAST COMMIT. Legacy approvals carry no
    // `base`; they are verified the old way AND reported, because silently accepting them would let
    // the weaker binding persist unnoticed.
    const base = detail.base || null;
    if (!base) {
      issues.push(`${id}: approval names no base — it binds the single commit ${detail.commit}, so any earlier commit on the branch is unapproved. Re-bind with --bind (or --base <sha>).`);
    }
    const diff = git(['diff', base || `${detail.commit}^`, detail.commit, '--binary']);
    if (diff !== null) {
      const actual = createHash('sha256').update(diff).digest('hex');
      if (actual !== detail.diff_hash) issues.push(`${id}: diff_hash does not match ${base || `${detail.commit}^`}..${detail.commit} — the approved change is not the change on disk`);
    }
    // The file manifest is what makes the blast radius readable. A mismatch means files entered or
    // left the candidate after it was approved.
    if (Array.isArray(detail.files) && base) {
      const now = git(['diff', '--name-only', base, detail.commit]);
      if (now !== null) {
        const actual = now.split('\n').filter(Boolean);
        const added = actual.filter((f) => !detail.files.includes(f));
        const gone = detail.files.filter((f) => !actual.includes(f));
        if (added.length || gone.length) {
          issues.push(`${id}: the approved file set no longer matches${added.length ? ` (now also touches: ${added.join(', ')})` : ''}${gone.length ? ` (no longer touches: ${gone.join(', ')})` : ''}`);
        }
      }
    }
  }
  return { counted, superseded: all.length - counted.length, issues };
}
