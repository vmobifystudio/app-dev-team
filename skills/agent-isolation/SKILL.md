---
name: agent-isolation
description: Use before spawning any agent that writes files, and by every developer/fixer agent as its first and last action. Gives each agent its own git worktree, forbids blanket staging, and requires confirming a mutation actually landed. Triggers from /app-build, /app-audit, parallel-orchestrator, and any parallel agent launch. Prevents parallel agents corrupting each other's work.
---

# Agent isolation

Parallel agents that share one working tree corrupt each other. Not "might" — *do*.

The default developer method is: write the files, then `git checkout -b feat/APP-NNN` and commit.
Run two of those concurrently in one tree and the sequence is:

```
dev A writes  ui/TodoListUiState.kt          (on main, untracked)
dev B writes  data/InMemoryTodoRepository.kt (on main, untracked)
dev A runs    git checkout -b feat/APP-001   -> B's file comes along
dev A runs    git add . && git commit        -> A ships B's half-finished work
dev B runs    git checkout -b feat/APP-002   -> from A's branch, inheriting A's commit
```

Both branches are now wrong, and neither agent can tell. Worse, this is silent: every agent
reports `DONE`, tests pass, and the review reads a diff that contains someone else's changes.

**A read-only agent is not exempt.** A verification agent sharing a working tree once left a
billing file with its guest-purchase guard deleted. Only explicit-path staging kept it out of the
commit. One `git add -A` ships a removed billing guard.

## Rule 1 — one worktree per agent, always

Before spawning any agent that writes, the orchestrator creates its worktree:

```bash
git worktree add ../.agent-wt/APP-001 -b feat/APP-001-short-slug
```

The agent is given that path as its **project root** and never leaves it. Its `git` commands are
confined there. Parallel agents cannot see each other's uncommitted state, because they do not
share one.

Cleanup after the merge gate:

```bash
git worktree remove ../.agent-wt/APP-001
git worktree prune
```

Add `.agent-wt/` to `.gitignore` (the `/app-init` bootstrap does this).

**Verifiers and auditors get one too.** "Read-only" describes the intent, not the guarantee.

If the project genuinely cannot use worktrees (not a git repo, or a tool that needs the canonical
path), then agents that write **must be serialized** — one at a time, each committing before the
next starts. Never run parallel writers in one tree. Say in the daily fragment that you serialized
and why.

## Rule 2 — never stage blindly

Banned, without exception:

```bash
git add -A        git add .        git add --all        git commit -a
```

Stage by explicit path, every time:

```bash
git add android/app/src/main/java/com/sandbox/todo/ui/TodoListScreen.kt \
        android/app/src/test/java/com/sandbox/todo/ui/TodoListViewModelTest.kt
```

Then look at what you actually staged before committing:

```bash
git diff --cached --numstat
```

If a path you didn't touch appears, stop and unstage it. Another agent's work, or your own
accidental edit, is about to be attributed to your ticket.

## Rule 3 — confirm the mutation landed

Never believe an edit worked because the tool returned success. Between "I ran the edit" and "the
file changed" sits every silent no-op: a pattern that didn't match, a path that didn't exist, a
write to a stale worktree.

```bash
git diff --numstat            # something changed, and it is what you think
git diff -- <the one file>    # the change is the change you intended
```

A refactor that silently matched nothing looks *identical* to a refactor that succeeded, and the
test suite that then passes is proving nothing. This is how a pass gets read as evidence.

Corollary for destructive checks: **prefer deleting a guarded call to renaming it.** A rename is a
compile error the moment it is wrong. A deletion still compiles, the test runs, and `0 failures`
looks exactly like success.

## Rule 4 — verify agents by running their work, not by reading their reports

An agent's report is a claim about work, produced by the same agent that did the work. Reports are
consistently more confident than the work justifies.

- A developer's `DONE` is checked with `verify-done.sh` — branch, commits, files, test exit code.
- A rule, guard, or test an agent wrote is checked by **making it fail on purpose** — see the
  `defect-hunting` skill. A rule that cannot fail reports success forever.
- An audit finding is checked by reproducing it, not by re-reading the finding.

## Orchestrator checklist

Before a parallel launch:

- [ ] Each writing agent has its own worktree, created before spawn
- [ ] Each agent's prompt names **its worktree path** as the project root, not the repo root
- [ ] No two agents are assigned the same file (if unavoidable, serialize those tickets)
- [ ] Agents are told: explicit-path staging only, and confirm the mutation landed

After each agent returns:

- [ ] `verify-done.sh` before believing `DONE`
- [ ] `git diff --cached --numstat` on the branch shows only that ticket's paths
- [ ] Worktree removed after merge

## Output contract

Developer/fixer agents report their isolation state so the orchestrator can check it:

```
DONE: APP-NNN
Worktree: ../.agent-wt/APP-NNN
Branch: feat/APP-NNN-short-slug
Staged (explicit paths): <list>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Files: <list>
Tests: <count> added, <command run>, exit 0
Next: code-reviewer
```
