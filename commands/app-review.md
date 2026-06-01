---
description: Run code review on a specific branch or open PR-equivalent
argument-hint: <branch name or ticket ID>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# /app-review — Review a branch

Target: $ARGUMENTS

## Steps

1. Resolve `$ARGUMENTS` to a branch name. If it looks like a ticket ID (`APP-NNN`), look up the matching branch in `docs/31-board.md`.

2. Spawn the `code-reviewer` agent with the branch name and ticket ID.

3. Print the verdict verbatim. If `REQUEST CHANGES`, also print suggested next step (re-spawn the developer, or ask user how to proceed).
