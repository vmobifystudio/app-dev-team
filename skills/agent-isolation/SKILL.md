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
git worktree add .agent-wt/APP-001 -b feat/APP-001-short-slug
```

The agent is given that path as its **project root** and never leaves it. Its `git` commands are
confined there. Parallel agents cannot see each other's uncommitted state, because they do not
share one.

Cleanup after the merge gate:

```bash
git worktree remove .agent-wt/APP-001
git worktree prune
```

`.agent-wt/` sits inside the repo and **must be in `.gitignore`** — `/app-init` adds it for new
projects. On an existing project, add it yourself before the first spawn: an un-ignored worktree
directory shows up as untracked noise in every agent's `git status` and invites exactly the blanket
`git add` this skill bans.

**Verifiers and auditors get one too.** "Read-only" describes the intent, not the guarantee.

### The rule is not "never touch the shared tree" — it is "never touch a path another agent could"

Some artifacts genuinely belong outside a feature branch. A review verdict has to survive the branch
being rejected; a findings register spans tickets. Forbidding all shared writes would push those
back into ephemeral messages, which is the failure this whole design exists to stop.

The real test is **collision**, not location:

| Artifact | Where | Why |
|---|---|---|
| all source and test code | **worktree only** | two agents on the same file is the corruption case |
| `docs/daily/<today>-<role>-<ticket>.md` | **worktree**, committed on the branch | reaches `main` at merge; a fragment for unmerged work should not appear in the standup |
| `docs/53-reviews/APP-NNN-cycle-N.md` | shared tree — **safe** | the path is unique per (ticket, cycle); no other agent can target it, and it must outlive a rejected branch |
| `docs/31-board.md`, `docs/team/messages.md` | shared tree — **append-only** | never edit an existing line; appends from different agents merge cleanly |

A shared write is safe when **no other agent can write that same path**. Uniquely-named files and
append-only logs qualify. Anything else — source, tests, a doc two roles both edit — is worktree-only.

Observed: a developer wrote its daily fragment to the repo root instead of its worktree, because the
orchestrator's prompt named a repo-root path. The fragment then sat on `main` describing work that
was still on an unmerged branch. Name the worktree-relative path when you spawn.

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

## Rule 5 — if HEAD moved under you, stop and report

You may be running without a worktree — the orchestrator failed to make one, or the project cannot
use them. That is a supported state, and it is the state in which this rule is the only thing
standing between you and another agent's lost work.

If `HEAD` is not where you left it, or files you did not write have appeared, **stop.** Do not
`git reset --hard`, do not `git checkout -- .`, do not `git stash drop`, do not delete an untracked
file to "clean up". Another agent's uncommitted work may be in that tree, and none of those
commands can be undone from inside your run.

Write a `blocker` naming what moved and let `tech-manager` resolve it. A stalled ticket is cheap; a
discarded working tree is not recoverable.

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
Worktree: .agent-wt/APP-NNN
Branch: feat/APP-NNN-short-slug
Staged (explicit paths): <list>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Files: <list>
Tests: <count> added, <command run>, exit 0
Next: code-reviewer
```
