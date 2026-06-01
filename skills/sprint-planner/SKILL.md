---
name: sprint-planner
description: Use to convert the backlog into a runnable sprint with parallel ticket assignment and dependency tracking. Used primarily by the tech-manager. Triggers on "plan the sprint", "what does the pod do next", or as part of /app-build.
---

# Sprint planner

Convert `docs/11-backlog.md` + `docs/22-impl-spec-*.md` into `docs/30-sprint-plan.md` and `docs/31-board.md`.

## Procedure

1. **Read** the backlog and impl specs. Note ticket dependencies — if APP-002 needs APP-001's auth module, that's a dependency.

2. **Sprint goal** — one sentence at the top of `docs/30-sprint-plan.md`.

3. **Capacity** — default 3 developer agents (iOS, Android, optional Backend), 1 code-reviewer, 1 qa-engineer, 1 ux-designer. Tune to project scope.

4. **Assign for parallelism** — group tickets so each developer has independent work to start with. Stack dependent work behind it.

   ```
   Track A (ios-developer)  : APP-001 → APP-004 → APP-007
   Track B (android-dev)    : APP-002 → APP-005 → APP-008
   Track C (backend-dev)    : APP-003 → APP-006
   Continuous: code-reviewer, qa-engineer, ux-designer (early)
   ```

5. **Board** — `docs/31-board.md`. Columns must match the ticket shape in `agents/tech-manager.md`:

   ```
   APP-NNN | F-NNN | Title | Owner | Status | Depends on | Estimate | Spec | Acceptance | Notes
   ```

   - `F-NNN` is the PRD feature ID this implements (so reviewers and QA can trace acceptance back to the PRD).
   - `Spec` is a short anchor like `prd#F-001 + arch§3` so devs don't need to grep.
   - `Acceptance` is the Given/When/Then copied from the PRD (or a one-line summary plus pointer if long).
   - `Notes` carries the review-cycle counter (`cycles=0`, `cycles=1`, `cycles=2 → blocked`) and any `BUG-NNN-fix` linkage.

   Status starts `todo`. Update through `in_progress → review → qa → done` (or `blocked`).

6. **Definition of done** — list it at the top of the board so everyone uses the same one:
   - Code merged
   - Tests green
   - Code-reviewer approved
   - QA exercised the acceptance criteria
   - Daily report mentions the close

## Parallelism rules

- **Run in parallel** when ticket A and ticket B touch different modules or different platforms.
- **Serialize** when A's output is B's input (e.g., shared component, API contract change).
- **Never spawn more dev agents in parallel than there are independent tickets ready.** Idle agents waste tokens; busy agents waste each other's context with merge conflicts.

## Output format for the tech-manager handoff

```
SPRINT 1 KICKED OFF
Parallel launch:
- ios-developer ← APP-001, APP-004
- android-developer ← APP-002, APP-005
- backend-developer ← APP-003 (or skip if out of scope)
- ux-designer ← finalize flows for sprint 1 features
- qa-engineer ← write test plan for sprint 1
Reviewer queue: code-reviewer
Daily report: docs/daily/<date>.md
```
