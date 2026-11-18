---
name: agent-isolation
description: Use before spawning any agent that writes files, and as every developer/fixer agent's first and last action — one git worktree per writer, explicit-path staging, confirm the mutation landed. Used by the /app-build orchestrator and every IC.
---

# Agent isolation

Parallel agents that share one working tree corrupt each other, silently: every agent reports
`DONE`, the tests pass, and the review reads a diff that contains someone else's changes. A
read-only agent is not exempt — one `git add -A` ships whatever another agent left in the tree.

**Spawning agents?** Read `references/orchestrator.md` — leasing one worktree per writer
(`worktree-slot.mjs`), cleanup on every terminal outcome, which shared-tree writes are safe, and the
`spawn-gate.sh` check you run before the launch message. Everything below applies to every agent.

## Rule 1 — work only in the worktree you were given

Your spawn prompt names your worktree (`.agent-wt/<owner>`). It is your **project root**; never
leave it. Cut one branch per ticket (`feat/APP-NNN-short-slug`) before you write anything. If you
were given no worktree, say so in your first line and treat Rule 5 as live.

Shared-tree files are the exception, and only these: your review verdict
(`docs/53-reviews/APP-NNN-cycle-N.md`, unique per ticket and cycle) and the append-only logs written
through their CLI. `docs/31-board.md` is **generated, CLI-only** — never edit it; `board.mjs move`
is its only writer.

## Rule 2 — never stage blindly, and never run a repo-wide destructive command

Banned, without exception:

```bash
git add -A        git add .        git add --all        git commit -a
git reset         git stash        git checkout -- .    git clean
```

The top row attributes someone else's work to your ticket. The bottom row **destroys** it, and none
of those can be undone from inside your run — one `git stash` + `git reset` for "a clean tree"
once discarded 22 files of another agent's live work.

**If you need a clean tree to test, copy the repo to a temp dir and dirty that** — `cp -R . "$TMP"`,
or `git worktree add` a scratch worktree. Never clean the tree you are standing in.

Stage by explicit path, every time, then look at what you staged before committing:

```bash
git add android/app/src/main/java/com/sandbox/todo/ui/TodoListScreen.kt \
        android/app/src/test/java/com/sandbox/todo/ui/TodoListViewModelTest.kt
git diff --cached --numstat
```

If a path you didn't touch appears, stop and unstage it.

## Rule 3 — confirm the mutation landed

Never believe an edit worked because the tool returned success. A pattern that didn't match, a path
that didn't exist, a write to a stale worktree — all look identical to success.

```bash
git diff --numstat            # something changed, and it is what you think
git diff -- <the one file>    # the change is the change you intended
```

For destructive checks, **prefer deleting a guarded call to renaming it**: a rename is a compile
error the moment it is wrong; a deletion still compiles and `0 failures` looks like success.

## Rule 4 — verify agents by running their work, not by reading their reports

- A developer's `DONE` is checked with `verify-done.sh` — branch, commits, files, test exit code.
- A rule, guard, or test an agent wrote is checked by **making it fail on purpose**
  (`defect-hunting` §3).
- An audit finding is checked by reproducing it, not by re-reading it.

## Rule 5 — if HEAD moved under you, stop and report

If `HEAD` is not where you left it, or files you did not write have appeared, **stop.** Do not
`git reset --hard`, `git checkout -- .`, `git stash drop`, or delete an untracked file to "clean
up" — another agent's uncommitted work may be in that tree. Write a `blocker` naming what moved and
let `tech-manager` resolve it. A stalled ticket is cheap; a discarded working tree is not
recoverable.

## Output contract

Report `Worktree: .agent-wt/<owner>`, `Branch:`, `Staged (explicit paths):` and `Mutation
confirmed:` inside your role's output contract (`spawn-prompt.mjs` inlines it; `team-protocol` is
the reference).
