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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

// An artifact ticket is still a branch (verify-done --docs-only checks branch, commits and files),
// so the DOC profile owes `Branch:` and `Mutation confirmed:` too — a QA return without `Branch:`
// was REJECTED downstream by a contract that never asked for it (C2-8, R2-7). Every artifact role
// file already declares all six; team-doctor holds them to it.
export const ARTIFACT_CONTRACT = ['Worktree:', 'Branch:', 'Mutation confirmed:', 'Daily fragment:', 'Assumptions & open questions:', 'Shared surfaces touched:'];

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
  // Owns tickets (BUILD_SPAWNABLE_OWNERS). Certifying someone else's work it returns a
  // `VERIFICATION:` line instead — GATE_HEADERS below, which the hooks read by mode.
  'verification-engineer',
];

/**
 * Gate MODES, keyed by role: the first line a role returns when it judges someone else's work
 * rather than owning a ticket. The hooks decide by this mode, not by role alone — a ux-architect
 * returning `DESIGN QA: PASS` owes no DONE block, and its verdict is not a developer's report
 * (C2-3, R2-8). A prompt that DEMANDS one of these (and is not `Work ticket X.`) is a gate spawn.
 */
export const GATE_HEADERS = {
  'code-reviewer': ['REVIEW VERDICT:', 'DESIGN QA:'],
  'tech-lead': ['REVIEW VERDICT:'],
  'security-reviewer': ['REVIEW VERDICT:', 'SECURITY:', 'PRIVACY:'],
  'ux-architect': ['DESIGN QA:'],
  'data-analyst': ['ANALYTICS:'],
  'aso-specialist': ['ASO READY', 'ASO BLOCKED'],
  'verification-engineer': ['VERIFICATION:'],
  'release-auditor': ['RELEASE AUDIT:'],
};

/** The gate header `text` STARTS with (first non-blank line) for this role, or ''. */
export function gateHeaderOf(role, text) {
  const first = (String(text).split('\n').find((l) => l.trim()) || '').trim();
  return (GATE_HEADERS[role] || []).find((h) => first.startsWith(h)) || '';
}

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
    'Branch: feat/' + ticket + '-short-slug        (created BEFORE any file was written)',
    'Mutation confirmed: git diff --numstat -> <N files, +A/-B>',
    'Files: <list>',
    `Daily fragment: docs/daily/<today>-${role}-${ticket}.md`,
    'Assumptions & open questions: <ledger row each, or "ASSUMED, NOT RAISED">',
    'Shared surfaces touched: <shared docs or contracts other tickets read — or "none">',
    'Next: <the role/gate that consumes this artifact>',
  ].join('\n');
}

/** The BLOCKED block is the same for every role — `team-protocol`'s canonical text. */
export const BLOCKED_BLOCK = (ticket = 'APP-NNN') => [
  `BLOCKED: ${ticket}`,
  'Reason: <one paragraph>',
  'Need: <who needs to answer what>',
].join('\n');
