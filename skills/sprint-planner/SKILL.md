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
   ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes
   ```

   - `F-NNN` is the PRD feature ID this implements (so reviewers and QA can trace acceptance back to the PRD).
   - `Reviewer` is the role that gates this ticket. Starts `—`; set when the row enters `review`.
     **It must never equal `Owner`** — a role does not gate its own work.
   - `Cycles` is the review-cycle counter as its own integer column, starting `0`. It is a safety
     counter enforcing the 2-cycle cap, so it does not live inside prose where an edit can lose it.
   - `Spec` is a short anchor like `prd#F-001 + arch§3` so devs don't need to grep.
   - `Acceptance` is the Given/When/Then copied from the PRD (or a one-line summary plus pointer if long).
   - `Notes` carries free text only — `BUG-NNN-fix` linkage, caveats. Never status or counters.

   Status starts `todo`. Update through `in_progress → review → qa → done` (or `blocked`).

6. **Review ledger** — append a section at the bottom of `docs/31-board.md`:

   ```markdown
   ## Review ledger (append-only — never edit or delete a line)
   Action must be exactly one of: `requested` `started` `changes` `approved` `merged`

   | Timestamp | Ticket | Action | Actor |
   |---|---|---|---|
   | 2026-07-29T09:00Z | APP-001 | requested | android-developer -> code-reviewer |
   | 2026-07-29T09:20Z | APP-001 | started | code-reviewer |
   | 2026-07-29T09:30Z | APP-001 | changes | code-reviewer |
   | 2026-07-29T10:10Z | APP-001 | approved | code-reviewer |
   | 2026-07-29T10:15Z | APP-001 | merged | tech-manager |
   ```

   Actions: `requested` · `started` · `approved` · `changes` · `merged`.

   The table cells are the summary; **the ledger is the record.** It is what makes "this was
   reviewed" checkable rather than asserted — the `Cycles` column is recomputable from it, an
   approval by the owner is detectable in it, and a `qa`/`done` row with no `approved` line is a
   ticket that skipped the gate. `board-doctor` checks all three.

   Lines are appended, never rewritten. A wrong line is corrected by appending a later one.

7. **Definition of done** — list it at the top of the board so everyone uses the same one.
   **Every gate named here must be runnable by someone reading the board**, with the command
   written out. A DoD that cites a tool the project cannot invoke is a gate nobody can audit:

   ```
   - Tests green — verified by:
       sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> <integration-branch> "<test cmd>"
     NOT by the developer's own report.
   ```

   An independent verifier once graded this `NOT-GATED` because the script was nowhere in the
   project tree — it had in fact run, invoked by the orchestrator from the plugin install, but
   nothing on the board said where it lived, so from inside the project the gate was unverifiable.
   **A gate whose location is unstated is indistinguishable from a gate that does not exist.**
   - Code merged
   - Code-reviewer approved, by a role that is not the owner, with an `approved` ledger line
   - QA exercised the acceptance criteria
   - Daily report mentions the close

8. **Definition of Ready — a ticket must be answerable before it is assigned.**

   The Definition of Done says when work is finished. Nothing said when it was *startable*. A ticket
   whose acceptance criteria state no observable outcome forces the developer to invent one, alone,
   mid-flow — and that decision ships. Observed: an export ticket said nothing about the empty-list
   case, the developer decided sensibly and unilaterally, and it reached `qa` on an assumption
   nobody had approved.

   Before a row leaves `todo`, it needs:
   - **Acceptance criteria naming an observable outcome** — Given/When/Then, or at minimum something
     a test could assert. "Make export nicer" is not a ticket.
   - **A spec anchor** (`prd#F-001 + arch§3`) so intent can be read rather than guessed.
   - **The empty, error and cancel cases considered** — not necessarily specified, but if the ticket
     is silent on them, say so in `Notes` so the developer knows it is their call and declares it.

   `board-doctor` warns `not_ready` on `todo` rows that fail this. It is a warning, not a block —
   a thin ticket is a planning problem to fix at planning time, not a reason to stop a sprint.

9. **Validate before handing off.** Run the board doctor on the board you just wrote:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
   ```

   A plan that doesn't pass its own doctor is not a plan. Fix it before the handoff — a dependency
   typo here becomes a silently stranded ticket three rounds into the sprint.

## Parallelism rules

**Judge parallelism on files, not features.** Two tickets can be perfectly independent as features
and still be the same handful of files. A dry run of "add a todo" and "complete a todo" — planned
as independent, different features, no shared acceptance criteria — produced add/add conflicts on
**all 8 files**, including both test files. See
`docs/research/2026-07-29-dry-run-parallel-agent-collision.md`.

For every ticket, write a **Touches** note: the files or packages it will most likely modify, taken
from the impl spec. Then:

- **Run in parallel** when A and B touch **disjoint files** — different modules, different
  platforms, different feature packages.
- **Serialize** when A and B share any file, even if the features are unrelated. The second picks
  up the first's commit.
- **Serialize** when A's output is B's input (shared component, API contract change).
- **Never spawn more dev agents in parallel than there are independent tickets ready.** Idle
  agents waste tokens; busy agents waste each other's context with merge conflicts.

A first ticket that establishes a shared surface — the ViewModel, the repository, the UI state type
— should be sequenced **alone**, with everything that touches it stacked behind it. One serialized
foundation ticket is cheaper than three parallel tickets and a merge.

### Name the shared surfaces, or they get built twice

File overlap does not catch duplication, because two agents solving the same cross-cutting concern
create **different** files. Observed in a dry run: two parallel tickets each needed to emit an
analytics event, and independently invented incompatible abstractions —
`domain/AnalyticsLogger.kt` + `data/ConsentGatedAnalyticsLogger.kt` on one branch,
`analytics/TodoAnalytics.kt` on the other. Both were good code. Both read the same schema. Neither
was wrong. The sprint still produced two analytics layers.

So: before sequencing, list the **cross-cutting concerns** this sprint touches — analytics logging,
error mapping, DI wiring, the design-system component set, navigation, persistence access,
feature-flagging. For each one that more than one ticket needs:

- give it its **own foundation ticket**, owned by one role, sequenced **before** its consumers, or
- name the existing type in every consuming ticket's `Spec` field so nobody invents a second one.

A concern that two tickets need and no ticket owns will be built twice, in two shapes, and the
merge will pick one arbitrarily.

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
