---
name: context-preflight
description: Run before changing a repository to verify branch, worktree, ticket, dependencies, source-of-truth documents, and unresolved obligations are understood.
---

# Context preflight

Use before implementation, review, migration, release, or any command that can change files. The
purpose is not to create more ceremony; it is to prevent an agent from acting on stale context.

## Procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/context-preflight.mjs" <project-root> [--ticket ID]`.
2. Read the reported branch, dirty-tree, active-worktree, ticket, and required-document findings.
3. Read the ticket, its dependency ancestors, the architecture/engineering-principles docs, the Git
   strategy, and the latest relevant decision or follow-up before editing.
4. If the result is `CANNOT EVALUATE`, stop. Do not convert missing context into an assumption.
5. Record assumptions and the next action in the ticket's daily evidence file.

## Operating rules

- A dirty tree belongs to somebody until proven otherwise. Preserve it and ask before overlapping it.
- The current branch and worktree are facts, not suggestions. Never work on `main` when the task writes.
- A ticket is not ready because it is assigned; its dependencies must be merged and its acceptance
  criteria must be discoverable.
- Read the latest decision and unresolved follow-up before reopening a settled thread.
- Report facts, assumptions, decisions, and unknowns separately. Never present reasoning as execution.

## Output

Return: `PREFLIGHT: CLEAR | BLOCKED | CANNOT EVALUATE`, repository identity, branch/worktree state,
ticket/dependency state, documents read, assumptions, and the next safe action. Keep the report short;
the evidence files carry detail.
