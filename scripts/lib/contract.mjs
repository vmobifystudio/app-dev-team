/**
 * The IC output contract — one copy, three consumers.
 *
 * Before this file, the same six field names and the same two role lists were hand-typed in
 * `team-doctor.mjs` (checks the role FILE declares them) and `report-check.mjs` (checks a returned
 * report contains them), each carrying a comment promising to stay in sync with the other. Adding a
 * third consumer — `spawn-prompt.mjs`, which composes the contract INTO the spawn prompt so it can
 * never again be a pointer instead of the text (H5, 2026-08-07) — made a third hand-typed copy the
 * obviously wrong move: this repository's own corpus is "backend-developer and monetization-engineer
 * were two releases behind" because a list existed in exactly one place a change could miss.
 *
 * Two tiers, because the hazard differs. A role that writes source or repository config needs
 * branch and worktree discipline; a role that produces a uniquely-named document does not, but still
 * owes the orchestrator the fields its gates read.
 */

export const CODE_CONTRACT = [
  'Worktree:',
  'Branch:',
  'Mutation confirmed:',
  'Daily fragment:',
  'Assumptions & open questions:',
  'Second-path check:',
  'Shared surfaces touched:',
];

// `report-check.mjs` checked six fields, not seven — it never required `Branch:`, even though the
// contract template in `ic-workflow` has always shown it and `report-check`'s own new daily-fragment
// verification NEEDS it to resolve `git show <branch>:<path>`. A ticket-owning role could satisfy
// "CLEAR" while never stating which branch its work landed on. Folded in here rather than left as a
// seventh hand-typed field this file exists to prevent.
export const CODE_CONTRACT_CHECKED = CODE_CONTRACT.filter((f) => f !== 'Branch:');

export const ARTIFACT_CONTRACT = ['Worktree:', 'Daily fragment:', 'Assumptions & open questions:'];

/** Anything writing source or repo config (CI, signing, build flavors) is a code role. */
export const CODE_ROLES = [
  'ios-developer',
  'android-developer',
  'backend-developer',
  'web-developer',
  'monetization-engineer',
  'devops-engineer',
  'test-automation-engineer',
];

export const ARTIFACT_ROLES = [
  'ux-architect',
  'product-designer',
  'product-manager',
  'product-researcher',
  'qa-engineer',
  'data-analyst',
  'aso-specialist',
];

const CODE_ROLE_SET = new Set(CODE_ROLES);
const ARTIFACT_ROLE_SET = new Set(ARTIFACT_ROLES);

/** Which contract a role owes, or null if it is not a ticket-owning role in either tier. */
export function contractFor(role) {
  if (CODE_ROLE_SET.has(role)) return { tier: 'code', fields: CODE_CONTRACT, checked: CODE_CONTRACT_CHECKED };
  if (ARTIFACT_ROLE_SET.has(role)) return { tier: 'artifact', fields: ARTIFACT_CONTRACT, checked: ARTIFACT_CONTRACT };
  return null;
}

/**
 * The literal block to paste into a spawn prompt. Placeholders inside `<...>` are for the AGENT to
 * fill in; nothing here is templated with real values, because a value this script invented would
 * be a claim nobody made — the same rule `report-check.mjs` applies at the other end.
 */
export function contractBlock(role, { ticket = 'APP-NNN' } = {}) {
  const c = contractFor(role);
  if (!c) return null;
  if (c.tier === 'code') {
    return [
      `DONE: ${ticket}`,
      'Worktree: <the path you were given, or "none — shared tree">',
      'Branch: feat/' + ticket + '-short-slug        (created BEFORE any file was written)',
      'Staged (explicit paths): <list>',
      'Mutation confirmed: git diff --numstat -> <N files, +A/-B>',
      'Files: <list>',
      'Tests: <count> added, <exact command run>, exit 0     ("all green" is not a result)',
      'Second-path check: <the writers/readers you grepped, or "none applicable">',
      `Daily fragment: docs/daily/<today>-${role}-${ticket}.md`,
      'Assumptions & open questions: <ledger row each, or "ASSUMED, NOT RAISED">',
      'Shared surfaces touched: <shared types, DI graph, design-system components, and any',
      '  cross-cutting abstraction you had to CREATE — or "none">',
      'Next: code-reviewer',
    ].join('\n');
  }
  return [
    `DONE: ${ticket}`,
    'Worktree: <the path you were given, or "none — shared tree">',
    'Files: <list>',
    `Daily fragment: docs/daily/<today>-${role}-${ticket}.md`,
    'Assumptions & open questions: <ledger row each, or "ASSUMED, NOT RAISED">',
    'Next: <the role/gate that consumes this artifact>',
  ].join('\n');
}

/** The BLOCKED block is the same for every role — `team-protocol`'s canonical text. */
export const BLOCKED_BLOCK = (ticket = 'APP-NNN') => [
  `BLOCKED: ${ticket}`,
  'Reason: <one paragraph>',
  'Need: <who needs to answer what>',
].join('\n');
