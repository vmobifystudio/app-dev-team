# Dry run 2: the same collision, with worktree isolation

**Date:** 2026-07-29
**Method:** Re-run of the run-1 scenario with the v1.3.0 fixes applied. Two **fresh**
`android-developer` agents (not the run-1 pair — those had learned "check if HEAD moved under you",
which would have tested their memory rather than the process), the **same two tickets that
collided**, each given its own git worktree created before spawn.
**Hypotheses were written before the run**, so it could fail.

| # | Hypothesis | Result |
|---|---|---|
| H1 | No cross-contamination between branches | ✅ confirmed |
| H2 | No discarded/reimplemented work | ✅ confirmed |
| H3 | Branch naming matches spec | ✅ confirmed |
| H4 | Both agents write a daily fragment | ❌ **failed — neither did** |
| H5 | Merge *still* conflicts (worktrees alone insufficient) | ✅ confirmed — 7 files |
| H6 | Agents read and use `docs/52-analytics.md` | ✅ confirmed |
| H7 | `verify-done.sh` passes both | ❌ **failed — live bug in the fix itself** |

---

## H1–H3: isolation works

```
* d0eccc3  feat(android): APP-001 — add a todo             (feat/APP-001-add-a-todo)
| * e1a7aac  feat(android): F-002 complete a todo …        (feat/APP-002-complete-a-todo)
|/
* 8296331  chore: sandbox baseline                          (main)
```

Two clean sibling branches off baseline. Compare run 1, where one branch held both tickets' work
and the other was empty.

- **No leakage.** `git grep` for the other ticket's feature on each branch returns nothing:
  APP-002's commit contains no add/validation logic; APP-001's contains no toggle logic. In run 1,
  APP-002's commit carried 8 files including APP-001's half-written work.
- **No rework.** Neither agent discovered a corrupted tree, discarded, or reimplemented. Run 1 cost
  one agent 588s / 102k tokens, roughly half of it wasted.
- **`main` never moved.** Throughout both agents' work, the primary tree stayed clean at 1 file,
  HEAD on `main`. Mid-run polling showed APP-002 at 6 Kotlin files while APP-001's tree and `main`
  both sat at 1 — the isolation is real, not cosmetic.
- **Branch names matched the spec** this time (`feat/APP-NNN-slug`), where run 1 produced
  `app-002-complete-a-todo`.

## H5: worktrees are necessary but **not sufficient**

This was the point of re-running the *same* tickets. A trial merge of the two clean branches:

```
CONFLICT (add/add): .../data/InMemoryTodoRepository.kt
CONFLICT (add/add): .../domain/TodoRepository.kt
CONFLICT (add/add): .../ui/TodoListEvent.kt
CONFLICT (add/add): .../ui/TodoListUiState.kt
CONFLICT (add/add): .../ui/TodoListViewModel.kt
CONFLICT (add/add): .../test/.../InMemoryTodoRepositoryTest.kt
CONFLICT (add/add): .../test/.../TodoListViewModelTest.kt
Automatic merge failed
```

**7 of 10 files conflict.** Isolation removed the corruption and the wasted budget; it did nothing
about the fact that two "independent" features live in the same files.

So the two fixes are orthogonal and both are load-bearing:
- **worktrees** stop agents destroying each other's work *during* the sprint,
- **file-overlap serialization** (`sprint-planner`) stops the sprint ending in an unmergeable pile.

Under the v1.3.0 planner these two tickets would have been **serialized**, not parallelised. The run
confirms that rule earns its place.

## H6: the analytics fix works

Both agents read `docs/52-analytics.md` — a doc that, before this release, **no implementing role
referenced at all**. APP-002 used the schema's exact event name and param, and wrote tests
asserting the consent/PII rules from the doc:

```kotlin
assertTrue("undo must not log todo_completed", analytics.loggedAgeDays.isEmpty())
fun `completing a todo logs todo_completed with age in days, IDs only`()
```

That is a defect class closed: before, every ticket invented its own event names and the funnel was
unqueryable.

## H7 FAILED: `verify-done.sh` was incompatible with `agent-isolation`

Both `DONE` claims were **rejected**, wrongly:

```
REJECTED: feat/APP-001-add-a-todo
  - could not check out feat/APP-001-add-a-todo to run tests (uncommitted changes in the working tree?)
```

Root cause, unambiguous:

```
fatal: 'feat/APP-001-add-a-todo' is already checked out at '.../dryrun2-wt/APP-001'
```

`verify-done.sh` ran `git checkout <branch>` to execute the tests. Git refuses to check out a branch
that is already checked out in another worktree — which, under the isolation skill, is **always**.

**Two fixes shipped in the same release contradicted each other.** And the failure mode was not
loud: it produces a *false* `REJECTED`, so the loop discards correct work and re-spawns the
developer, repeatedly, until the 6-retry spawn budget trips. A sprint of perfectly good work would
have been thrown away and re-done, three times per ticket, with the reason buried in a message
blaming "uncommitted changes".

**Fix:** locate the branch with `git worktree list --porcelain` and run the tests *where the branch
lives*, never checking out. Falls back to the old behaviour when no worktree holds the branch.
Verified across six paths: missing branch, plain repo passing, plain repo failing, no test command,
empty branch, and branch-live-in-worktree.

After the fix, both claims verify:

```
verify-done: feat/APP-002-complete-a-todo is checked out at .../APP-002 — running tests there (no checkout).
VERIFIED: feat/APP-002-complete-a-todo
  base=main commits=1 files=10 tests=green
```

This is the release's own lesson landing on it: *the tool you build to catch the problem is subject
to it too.* It could only be found by running it.

## H4 FAILED: the daily fragment is being skipped

Neither agent wrote `docs/daily/<today>-android-developer-APP-NNN.md`, though every IC role requires
it as its final step. Across both dry runs, **1 of 4 agent-runs produced one.**

That artifact is the *sole* input to the standup — `tech-manager` builds the daily report by
concatenating fragments. So the standup has been aggregating nothing, silently.

**Fix:** `/app-build` step 3 now checks the fragment exists on the branch before moving the row to
`review`, and asks that agent for it rather than writing it on their behalf.

## New finding: parallel agents duplicate shared infrastructure

Not hypothesised — it fell out of reading the two clean branches:

| Branch | Analytics abstraction it invented |
|---|---|
| `feat/APP-001-add-a-todo` | `domain/AnalyticsLogger.kt` + `data/ConsentGatedAnalyticsLogger.kt` |
| `feat/APP-002-complete-a-todo` | `analytics/TodoAnalytics.kt` |

Two incompatible analytics layers, for the same schema, in one sprint. Both are good code. Both
correctly read `docs/52-analytics.md`. Neither agent did anything wrong.

**The file-overlap rule cannot catch this**, because the agents created *different* files. The
concern was needed by two tickets and owned by none, so it was built twice and the merge would pick
one arbitrarily.

**Fix:** `sprint-planner` now requires listing the sprint's cross-cutting concerns — analytics,
error mapping, DI, design-system components, navigation, persistence — and for each one that more
than one ticket needs, either giving it its own foundation ticket sequenced first, or naming the
existing type in every consuming ticket's `Spec` field.

## Method note

My own observation harness had the bug it was measuring: it ran a trial merge, then
`git merge --abort` followed by `git reset --hard HEAD` — which *kept* the first, successful merge
and left `main` advanced. That made a later `verify-done` run report "no commits not already on
main" for a branch that plainly had one. Caught by checking `git log main` rather than trusting the
harness output.

Third instance in this programme of the same shape. It is not a coincidence; it is the default.

## Verdict

The v1.3.0 isolation fix **works and is necessary**. It is **not sufficient** — file-overlap
serialization and shared-surface ownership are separate, load-bearing rules, and this run is the
evidence for both. Two defects in the release were found only by executing it, one of them a
self-contradiction between two of its own fixes that would have silently discarded good work.
