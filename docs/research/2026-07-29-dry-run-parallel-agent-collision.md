# Dry run: two parallel developer agents, one working tree

**Date:** 2026-07-29
**Method:** Two `app-dev-team:android-developer` agents launched concurrently on two *deliberately
independent* tickets, in one shared working tree, following the documented method verbatim —
exactly as `skills/parallel-orchestrator/SKILL.md` prescribes today.
**Sandbox:** throwaway git repo, minimal Android-shaped project, `APP-001` (add a todo) and
`APP-002` (complete a todo), stub `./gradlew`.
**Result:** the collision happened. One agent detected it and recovered at roughly half its budget.
The two branches still ended unmergeable.

---

## What the process says to do

`agents/android-developer.md` step 7: *"Commit on a feature branch named `feat/APP-NNN-short-slug`."*
— i.e. **branch last**, after the code is written.

`skills/parallel-orchestrator/SKILL.md` step 3: *"Launch in a single message… so they run
concurrently."*

Neither says *where* an agent works. Both agents therefore worked in the repo root and, following
the documented order, wrote all their files before any branch existed.

`skills/sprint-planner/SKILL.md` explicitly frames these two tickets as safe to parallelise:
*"Run in parallel when ticket A and ticket B touch different modules or different platforms."*
They were the same module. Nothing in the process checks that.

## What actually happened

From `git reflog` and the agents' own reports:

```
10:56  main           baseline
       [both agents writing into the same tree, on main, untracked]
11:00  APP-002 agent  checkout -b app-002-complete-a-todo   <- sweeps the shared tree
11:00  APP-002 agent  commit 6481c96: 8 files, 333 insertions
                      ^ includes APP-001's in-progress files
11:04  APP-001 agent  detects HEAD is on APP-002's branch with its edits on top
       APP-001 agent  discards its in-worktree edits, checks out main, cuts a clean branch
       APP-001 agent  reimplements the whole ticket from scratch
11:1x  APP-001 agent  commit 6877a59
```

### Final state

```
* 6877a59  APP-001: add a todo            (feat/APP-001-add-a-todo)
| * 6481c96  feat(app): APP-002 — complete a todo   (app-002-complete-a-todo)
|/
* acb80da  chore: sandbox baseline        (main)
```

## Six findings

**1. APP-002's commit is polluted.** It contains 8 files / 333 insertions, including the files
APP-001 was mid-way through writing. A reviewer reading that branch reviews another ticket's
abandoned draft as if it were APP-002's work, against APP-002's acceptance criteria.

**2. Recovery cost about half a ticket.** The APP-001 agent spent **588 seconds and 102k tokens**,
a large share of it discovering the corruption, discarding, and re-doing work it had already done
correctly once.

**3. The recovery was safe by timing, not by design.** In its own words: *"I discarded those
in-worktree edits (safe, since their work was already committed independently)."* Had APP-002 not
yet committed, that same judgment call would have destroyed APP-002's uncommitted work instead.
The process offers no way to tell those two situations apart.

**4. The branches are unmergeable.** A trial merge produces **add/add conflicts on all 8 files** —
including both test files:

```
CONFLICT (add/add): android/app/src/main/java/com/sandbox/todo/ui/TodoRow.kt
CONFLICT (add/add): android/app/src/test/java/com/sandbox/todo/ui/TodoListViewModelTest.kt
... 8 of 8 files
Automatic merge failed; fix conflicts and then commit the result.
```

Two tickets planned as independent produced a total conflict, because "independent" was judged on
*feature* boundaries and they shared every *file*.

**5. Branch naming drifted from the spec.** APP-002 produced `app-002-complete-a-todo`, not
`feat/APP-002-<slug>`. The board's Branch field and reality diverge, so a reviewer is pointed at a
branch that does not exist.

**6. Only one daily fragment was written.** APP-002 wrote none, though the role requires one per
run. The single artifact that would have surfaced any of this to `tech-manager` was half-missing.

## What this says about the agents vs the process

The APP-001 agent behaved **well**. It noticed HEAD had moved under it, reasoned about whose work
was whose, chose the recovery that didn't destroy the other agent's commit, reimplemented cleanly,
scoped strictly to its own feature, and reported the whole thing honestly including the merge
hazard it was leaving behind.

None of that should have been necessary. The process handed a capable agent a corrupted environment
and got rescued by its competence. That is not a control — it is luck that scales badly: it depends
on the agent noticing, on the other agent having already committed, and on there being enough
budget left to redo the work.

## What the old pipeline would have done with this

`/app-build` believed `DONE: APP-NNN` on sight. Both agents report success. Both rows move to
`review`. The reviewer for APP-002 reviews a branch containing another ticket's draft. The merge
gate then hits eight conflicts on two tickets that the sprint plan called independent — with no
prior signal that anything went wrong.

## The fix, and evidence it works

**Symptom** — `scripts/verify-done.sh`, run against the mid-run state (before APP-001 recovered),
rejects both claims:

```
$ verify-done.sh feat/APP-001-add-a-todo main "./gradlew test"
REJECTED — no commits on the branch that are not already on main; the branch changes no files.

$ verify-done.sh feat/APP-002-complete-a-todo main "./gradlew test"
REJECTED — branch does not exist locally or on origin. The DONE claim is unsupported.
```

**Cause** — `skills/agent-isolation/SKILL.md`:

- one git worktree per writing agent, created **before** spawn, verifiers included
- **branch before you write**, never after
- explicit-path staging only; `git add -A` / `git add .` banned outright
- confirm the mutation landed (`git diff --cached --numstat`) before believing any result

**Planning** — `sprint-planner` must judge parallelism on **files**, not features. Two tickets that
touch the same file are serialized, however independent they look on the board.

## The general lesson this instance confirms

> Verify the thing that has to be true, not the thing you changed.

Both agents verified they had written good code. Neither could verify the thing that actually had
to be true — that the code was on *its own* branch — because the process gave them no way to know.
Both reports would have been sincere. One would have been wrong.
