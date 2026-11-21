---
name: context-preflight
description: On an app-dev-team project, use before changing the repository, as a ticket's first step, to confirm branch, worktree, ticket row, dependencies, source-of-truth docs and open obligations. Used by ICs, code-reviewer, devops-engineer, tech-manager and /app-preflight.
---

# Context preflight

Use before implementation, review, migration, release, or any command that can change files. The
purpose is not to create more ceremony; it is to prevent an agent from acting on stale context.

## Procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/context-preflight.mjs" <project-root or slot> --ticket ID --role <role>`.
   `--role` decides the protected-branch check (writers only); a fresh slot's detached HEAD is fine.
2. Read the reported branch, dirty-tree, active-worktree, ticket, and required-document findings.
3. Read what your prompt names (the ticket, its spec excerpt, the answers on record) and any doc the
   ticket actually touches — not the whole doc set.
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

A note in your daily fragment (a reviewer: its verdict): the `PREFLIGHT:` line and documents read.
Not a return value — return your prompt's contract (`BLOCKED:` if preflight cannot clear).
