/**
 * Who may write which gate event — capability, enforced at the append, not asked for by prose.
 *
 * Every role file already declares a `tools:` allowlist. `tools:` is a mechanism boundary (may this
 * agent run Bash) and says nothing about the SEMANTIC boundary the studio actually depends on: a
 * designer must not be able to merge, a developer must not sign off its own work, QA must not pass
 * the tests it wrote, the release manager must not touch test evidence. Until this file existed all
 * five were conventions in Markdown, and dry run 4's sharpest lesson is that knowing a rule, having
 * written it and having defended it for hours does not make you apply it (DR4-027).
 *
 * So the rule becomes an append the CLI refuses.
 *
 * TWO KINDS OF EVENT, and the distinction is the whole design:
 *
 *   WORK events   — created, claimed, assigned, done_reported, review_requested, started, changes,
 *                   blocked, unblocked. Anyone may write these. They report; they do not decide.
 *   GATE events   — verified, verified_static, rejected, approved, merged, qa_passed, qa_failed,
 *                   closed. These ASSERT something was checked. Each has a closed list of roles.
 *
 * Only gate events are policed, because only gate events can launder an unchecked claim into a
 * board state a human trusts. Policing `claimed` would buy nothing and would fire constantly.
 *
 * FALSE-POSITIVE BEHAVIOUR, stated plainly:
 *   - An empty `--by` on a gate event is REFUSED. That is deliberate — an unattributed approval is
 *     the thing the audit chain exists to make impossible — and it is the only change that can
 *     surprise an existing caller. Work events with an empty `--by` are untouched.
 *   - A `--by` naming a role that is NOT in this file's roster is refused on gate events with a
 *     list of who may. A project that renames roles must edit ROLE_GATES, and that edit is the
 *     record of the decision.
 *   - `migrate` writes `by: ""` on inferred events and does not route through `validate`, so a
 *     migrated log is unaffected. Its inferred approvals were already marked `provenance:
 *     "inferred"` — not evidence, and this does not pretend otherwise.
 */

/** The gate events, and the closed set of roles that may write each. */
const ROLE_GATES = {
  // A verification asserts the branch, the diff and the checks were actually inspected.
  // `release-manager` is absent from every evidence row on purpose: the role that decides a build
  // ships must not be able to author the evidence that it is shippable.
  verified: ['verification-engineer', 'tech-manager', 'tech-lead', 'qa-engineer'],
  verified_static: ['verification-engineer', 'tech-manager', 'tech-lead', 'qa-engineer'],
  rejected: ['verification-engineer', 'tech-manager', 'tech-lead', 'qa-engineer'],

  // Review verdicts. A developer cannot approve — not even someone else's ticket: review is a role,
  // not a favour. (The owner-approving-own-ticket rule is separate and older; it still fires first,
  // because its message is the one a reviewer needs to read.)
  //
  // tech-manager is NOT in `approved` (G-F1): it writes `merged` and `closed`, and a role that can
  // approve AND merge clears the whole review gate alone. It keeps `changes`, which is how a
  // verification or design-QA FAIL goes back to the developer.
  approved: ['code-reviewer', 'tech-lead', 'cto', 'security-reviewer'],
  changes: ['code-reviewer', 'tech-lead', 'cto', 'security-reviewer', 'tech-manager'],

  // The merge. This is the row that stops a designer, a doc role or an ASO specialist from putting
  // code on the integration branch, and it is the row most likely to be argued with: a developer
  // "just landing a one-liner" is exactly the merge nobody reviewed.
  merged: ['tech-manager', 'tech-lead', 'devops-engineer', 'release-manager'],

  // QA verdicts. Not tech-manager: the role that merges does not also certify what it merged.
  qa_passed: ['qa-engineer', 'verification-engineer'],
  qa_failed: ['qa-engineer', 'verification-engineer'],

  closed: ['tech-manager', 'tech-lead'],

  // The wave could not land a merged ticket: only the orchestrator, which runs the wave, sends it back.
  rework: ['tech-manager'],
};

/**
 * Gate events that a ticket's OWNER may never write about their own ticket.
 *
 * `approved` already had this rule. `qa_passed` did not, and that is the hole the brief names: a
 * qa-engineer who owns the test-plan ticket could write the test plan, then pass it. The evidence
 * and the sign-off would carry the same name, which is the definition of an ungated gate.
 *
 * FALSE POSITIVE: on a one-person tier where qa-engineer owns its own test ticket, this refuses and
 * the exit is to have tech-manager or verification-engineer write the verdict. That is one extra
 * call, not a wall, and it is stated in the refusal.
 */
const NOT_ON_OWN_TICKET = new Set(['approved', 'qa_passed', 'verified', 'verified_static']);

/**
 * Gates only the human may open. Kept OUT of ROLE_GATES on purpose: every role there must be an
 * agent (team-doctor checks agents/<role>.md exists), and the founder is not one. `reopened` hands
 * a capped or in-review ticket back to the developer with one more review cycle — overriding the
 * cycle cap is a founder decision, never an agent's.
 */
const HUMAN_GATES = { reopened: ['founder'] };

const GATE_EVENTS = new Set([...Object.keys(ROLE_GATES), ...Object.keys(HUMAN_GATES)]);

/**
 * S7-2 / S7-3: events that are gates BECAUSE OF WHAT THEY CHANGE. Kept out of GATE_EVENTS (which
 * freezes test commands and is the static roster) — the board treats these exactly like a gate:
 * a closed role list here, and a token under requireActorTokens (board.mjs stampActor).
 *   corrected   rewrites invariants, acceptance, files and owner — what the reviewer checks and QA
 *               tests. The orchestrator's route (app-plan), never a worker's.
 *   unblocked   of a `needs-approval:` block (app-audit's Risky ticket) — the founder's approval,
 *               recorded by the founder or by the orchestrator relaying it (its inline token).
 */
const needsApproval = (state) => {
  if (state?.status !== 'blocked') return false;
  const d = (state.events || []).findLast((e) => e.event === 'blocked')?.detail;
  const text = typeof d === 'string' ? d : (d && (d.reason || d.note)) || '';
  return /^\s*needs-approval:/i.test(String(text));
};
function conditionalGate(state, name) {
  if (name === 'corrected') return ['tech-manager'];
  if (name === 'unblocked' && needsApproval(state)) return ['tech-manager', 'founder'];
  return null;
}

/** Every role named anywhere in this file — team-doctor checks each one is a real agent. */
const ROLES_IN_MATRIX = [...new Set(Object.values(ROLE_GATES).flat())].sort();

/**
 * @returns {{ok: true} | {ok: false, reason: string, legal: string[]}}
 */
function checkCapability(state, candidate, legal) {
  const { event: name, by } = candidate;
  const allowed = ROLE_GATES[name] || HUMAN_GATES[name] || conditionalGate(state, name);
  if (!allowed) return { ok: true };
  const actor = String(by || '').trim();

  if (!actor) {
    return {
      ok: false,
      reason:
        `"${name}" is a gate event and carries no --by. A gate that cannot name who fired it is a ` +
        `gate nobody can be held to.\n  who may write "${name}": ${allowed.join(', ')}`,
      legal: legal.filter((e) => e !== name),
    };
  }

  if (!allowed.includes(actor)) {
    return {
      ok: false,
      reason:
        `"${actor}" may not write "${name}" — that capability belongs to ${allowed.join(', ')}.\n` +
        '  This is enforced at the append, not asked for in a role file: a role that can write a ' +
        'gate event can launder an unchecked claim into a state a human trusts.',
      legal: legal.filter((e) => e !== name),
    };
  }

  // Compare NORMALIZED forms. `actor` is trimmed on the way in and `state.owner` is not, so an
  // owner carrying insignificant whitespace — from a migrated Markdown board, a hand-edited legacy
  // log, or any path that did not go through `add --owner` — would not equal the trimmed actor, and
  // the role could sign off its own ticket. Not reproducible through today's CLI, which trims; that
  // is exactly why it is worth closing, because the comparison should not depend on every writer
  // remembering. Reported by codex on PR #12.
  const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
  if (NOT_ON_OWN_TICKET.has(name) && state && same(actor, state.owner)) {
    return {
      ok: false,
      reason:
        `${actor} owns ${state.id} — "${name}" on your own ticket is evidence and sign-off in one ` +
        'name, which is the shape of an ungated gate.\n' +
        `  Have ${allowed.filter((r) => r !== actor).join(' or ')} write it instead.`,
      legal: legal.filter((e) => e !== name),
    };
  }

  return { ok: true };
}

export { ROLE_GATES, HUMAN_GATES, GATE_EVENTS, NOT_ON_OWN_TICKET, ROLES_IN_MATRIX, checkCapability, conditionalGate };
