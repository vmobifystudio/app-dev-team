---
description: Run code review on a specific branch or open PR-equivalent
argument-hint: <branch name or ticket ID>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent, Skill
---

# /app-review — Review a branch

Target: $ARGUMENTS

## Steps

1. Resolve `$ARGUMENTS` to a branch name. If it looks like a ticket ID (`APP-NNN`), take its branch from the `Branch:` line of its newest DONE report in `docs/team/reports/`, never a
   prefix glob (`APP-001` must not pick up `APP-0010` or `APP-001-analytics`). The reviewer's base is the integration branch
   (`integration-branch.sh`), never an assumed `main`.

2. Compose the prompt with `node "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-prompt.mjs" compose --root . --ticket <ID> --role code-reviewer` and spawn `code-reviewer` with that output verbatim (the hook refuses a ticket review prompt without the verdict contract). A bare branch with no ticket is spawned with the branch name.

3. Print the verdict verbatim. If `REQUEST CHANGES`, also print suggested next step (re-spawn the developer, or ask user how to proceed).
