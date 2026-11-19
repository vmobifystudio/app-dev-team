# team-protocol — the output contract, every field

Loaded from `team-protocol` SKILL.md when you need what a field means or which profile a role uses. `${CLAUDE_PLUGIN_ROOT}/scripts/lib/contract.mjs` is canonical (`CODE_ROLES`, `ARTIFACT_ROLES`); `spawn-prompt.mjs` inlines the contract into every spawn prompt; this is the reference for what each field means.

The sprint loop parses your closing block. It is not a summary for a human; it is the input to
`verify-done.sh`, the merge gate, the collision check, and the standup. **A field you omit is a
gate that silently passes.**

There are two profiles. Every spawnable ticket owner uses one of them — including roles whose
ticket produces documents rather than code, because a doc ticket is still work on a branch that
still has to be verified and merged.

**CODE profile** — `ios-developer`, `android-developer`, `backend-developer`, `web-developer`,
`monetization-engineer`, `devops-engineer`, `test-automation-engineer`:

```
DONE: APP-NNN
Worktree: <the path you were given, or "none — shared tree">
Branch: feat/APP-NNN-short-slug        (created BEFORE any file was written)
Staged (explicit paths): <list>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Files: <list>
Tests: <count> added, <exact command run>, exit 0
Second-path check: <the writers/readers you grepped, or "none applicable">
Daily fragment: <path to docs/daily/<today>-<role>-<ticket>.md that you wrote>
Assumptions & open questions: <every place the spec did not answer something and you decided
  anyway, with the decision and the reasoning. Paste the docs/team/messages.md ledger row for each
  one you raised; write "ASSUMED, NOT RAISED" for each one you did not. Never write that you
  raised something you did not — the orchestrator and the standup read this line as fact.>
Shared surfaces touched: <files/types that are not exclusively yours — a shared model, an error
  type, a DI graph, a design-system component — or "none". Also name any cross-cutting abstraction
  you had to CREATE (an analytics logger, a clock, a result wrapper): if another ticket needed one
  too, you have both just built it and the merge will pick one arbitrarily.>
Next: code-reviewer
```

**DOC profile** — `ux-architect`, `product-designer`, `product-manager`, `product-researcher`,
`qa-engineer`, `data-analyst`, `aso-specialist`:

```
DONE: APP-NNN
Worktree: <the path you were given, or "none — shared tree">
Branch: docs/APP-NNN-short-slug        (created BEFORE any file was written)
Files: <the docs you wrote or edited>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Daily fragment: <path to docs/daily/<today>-<role>-<ticket>.md that you wrote>
Assumptions & open questions: <as above — ledger row or "ASSUMED, NOT RAISED">
Shared surfaces touched: <single-owner docs another ticket may also be writing —
  13-design-tokens.md, 52-analytics.md, 15-aso.md, 50-test-plan.md — or "none">
Next: <the role that consumes this doc>
```

The DOC profile has no `Tests:` line, so the loop verifies it with
`verify-done.sh <branch> <base> --docs-only`: branch, commits and changed files are still checked,
the test command is not required. **`Branch:` is required in both profiles.** A doc ticket with no
branch cannot be verified, cannot be merged, and cannot be told apart from a ticket nobody worked.

Roles that **gate** rather than work tickets — `code-reviewer`, `security-reviewer`,
`verification-engineer` in its certifying role, `release-manager`, `tech-lead`, `tech-manager` —
return their own verdict block instead (`REVIEW VERDICT: APPROVE` / `REVIEW VERDICT: REQUEST
CHANGES` / `SECURITY:` / `VERIFICATION:` / `SHIP CANDIDATE:`). `verification-engineer` is in
neither profile list even when it owns a ticket: it returns its `VERIFICATION:` block. A role that can do both says which it is doing in its first
line.

**The dispatch manifests** — `dispatch-preflight` refuses to spawn any owner without them.
`/app-plan` runs `${CLAUDE_PLUGIN_ROOT}/scripts/team-bootstrap.mjs`, which writes them at the safe end of each contract
for a project to then edit.

Their paths are in the canonical paths table in `team-protocol` SKILL.md.
