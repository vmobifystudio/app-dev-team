---
name: sprint-planner
description: Use to convert the backlog into a runnable sprint with parallel ticket assignment and dependency tracking. Used primarily by the tech-manager. Triggers on "plan the sprint", "what does the pod do next", or as part of /app-build.
---

# Sprint planner

Convert `docs/11-backlog.md` + `docs/22-impl-spec-*.md` into `docs/30-sprint-plan.md` and `docs/31-board.md`.

## Procedure

1. **Read** the backlog and impl specs. Note ticket dependencies — if APP-002 needs APP-001's auth module, that's a dependency.

2. **Sprint goal** — one sentence at the top of `docs/30-sprint-plan.md`.

3. **Capacity** — default 3 developer agents (iOS, Android, optional Backend), 1 code-reviewer, 1 qa-engineer, 1 ux-architect, 1 product-designer. Tune to project scope.

4. **Assign for parallelism** — group tickets so each developer has independent work to start with. Stack dependent work behind it.

   ```
   Track A (ios-developer)  : APP-001 → APP-004 → APP-007
   Track B (android-dev)    : APP-002 → APP-005 → APP-008
   Track C (backend-dev)    : APP-003 → APP-006
   Continuous: code-reviewer, qa-engineer, ux-architect + product-designer (early)
   ```

5. **Board — create tickets through the CLI. Never hand-write the table.**

   `docs/31-board.md` is a **generated view**. The source of truth is the append-only event log
   `docs/31-board-events.jsonl`, and `scripts/board.mjs` is its only writer. A ticket is created by:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add APP-001 \
     --title "Core todo store" --feature F-001 --owner android-developer \
     --depends APP-000 --estimate M --spec "prd#F-001 + arch§3" \
     --acceptance "Given the list, When I submit non-empty text, Then it appears at the top" \
     --notes "touches: data/TodoRepository.kt"
   ```

   Each `add` appends a `created` event and re-renders the Markdown board with the same columns as
   before — `ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate |
   Spec | Acceptance | Notes`. Editing a cell by hand does nothing: the next render overwrites it,
   and no rule reads it back. `Reviewer` and `Cycles` are **derived**, not typed — the drift between
   a hand-edited `Cycles` cell and the ledger was a live defect, and derived-on-read cannot disagree
   with itself.

   Field meanings are unchanged: `--feature` traces acceptance back to the PRD, `--spec` is a short
   anchor (`prd#F-001 + arch§3`) so devs don't grep, `--acceptance` is the Given/When/Then,
   `--notes` is free text only.

6. **The event log — `docs/31-board-events.jsonl`, one JSON object per line, append-only.**

   ```json
   {"ts":"2026-07-29T10:06:00Z","ticket":"APP-001","event":"review_requested",
    "by":"android-developer","detail":"-> code-reviewer","provenance":"cli"}
   ```

   | Field | Meaning |
   |---|---|
   | `ts` | ISO timestamp, or `null` when a `migrate` could not reconstruct one |
   | `ticket` | the ticket ID; an event on a ticket with no `created` is refused |
   | `event` | one of the vocabulary below |
   | `by` | the role that did it — this is what makes self-review detectable |
   | `detail` | free text; an object on `created` (the ticket fields) and on `assigned` (`{to}`) |
   | `provenance` | `cli` for anything the tool appended, `inferred` for anything `migrate` reconstructed |

   **Events:** `created · claimed · assigned · done_reported · verified · verified_static ·
   rejected · review_requested · started · approved · changes · merged · qa_passed · qa_failed ·
   blocked · unblocked · closed`

   `verified_static` is the lane for work that is inspectable but not runnable (verify-done exit 2).
   Omitting it from this list is how DR4-002 stayed the documented rule: it unlocks review on a
   ticket whose toolchain is broken, refuses `closed`, and holds the release gate.

   The state machine, enforced **before** the append — an illegal transition exits 1 and names what
   is legal from here, so these states are unrepresentable rather than detectable afterwards:

   ```
   todo --claimed--> in_progress --done_reported--> (verify) --review_requested--> review
                                                                                    |
                       done <--closed-- qa <--merged-- (merge gate) <--approved-----+
   ```

   | Rule | The anomaly it makes impossible |
   |---|---|
   | `review_requested` needs a preceding `verified` | a `DONE` nobody checked reaching review |
   | `approved` must be `by` ≠ the owner | `self_review` |
   | `merged` needs an `approved` by a non-owner | `done_without_review` |
   | the 3rd `changes` is refused and forces `blocked` | `cycle_cap_breached`, and the column/ledger drift |
   | `claimed` is refused while a dependency has no `merged` | `stranded` — the silent one |
   | `blocked` recomputes readiness for dependents | dependents stranded by a mid-round block |
   | any event on an unknown ticket is refused | `malformed_row` |

   Mutations during the sprint:

   ```bash
   board.mjs move APP-001 claimed --by android-developer
   board.mjs move APP-001 done_reported --by android-developer
   board.mjs move APP-001 verified --by verification-engineer --detail "verify-done.sh green"
   board.mjs move APP-001 review_requested --by android-developer --detail "-> code-reviewer"
   board.mjs move APP-001 changes --by code-reviewer --detail "docs/53-reviews/APP-NNN-cycle-N.md"
   board.mjs move APP-001 approved --by code-reviewer
   board.mjs move APP-001 merged --by tech-manager
   board.mjs show [APP-001] [--json]      # derived state + self-metrics
   board.mjs render                       # regenerate docs/31-board.md
   board.mjs migrate [board.md] --out docs/31-board-events.jsonl
   ```

   Exit codes: `0` appended · `1` refused (illegal transition, or a rule said no) · `2` cannot
   evaluate (log missing or unreadable). **A log that does not parse is exit 2, never an empty
   board** — a gate that cannot read its input must say so, not report CLEAR.

   Lines are appended, never rewritten. A wrong line is corrected by appending a later one: a strict
   reader over an append-only log with no repair path turns one typo into a permanently stuck board.

   **Existing hand-written boards.** `board.mjs migrate` reads the board plus its review ledger and
   emits a best-effort log. Ledger lines keep their real timestamp and actor; everything the board
   never recorded — that a ticket was created, claimed, verified, QA'd — is emitted with `ts: null`
   and `provenance: "inferred"`. An inferred log is honest; a fabricated one is the same class of
   lie as a false `DONE`. `board-doctor` stays as the backstop for hand edits and legacy boards.

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

9. **Validate before handing off.** Run the board doctor on the board the CLI just rendered:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
   ```

   A plan that doesn't pass its own doctor is not a plan. Fix it before the handoff — a dependency
   typo here becomes a silently stranded ticket three rounds into the sprint.

   The doctor's job has shifted from primary gate to **drift detector**: the CLI now refuses the
   states it used to report, so anything the doctor still finds arrived by a hand edit, a legacy
   board, or a bug. Both still run, on purpose.

10. **Self-metrics.** `deriveMetrics(events)` in `scripts/lib/events.mjs` takes the parsed log (not a
    path — one read path only) and returns cycle time per ticket, review pass rate, rework rate,
    gate-fire counts (`rejected`/`changes`/`qa_failed`/`blocked`), tickets per round, and median
    cycle time. `board.mjs show` prints the summary; `show --json` emits the whole object. This is
    what makes a judgement about how the team is doing evidence rather than a belief.

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
- ux-architect ← finalize flows and the screen-and-state inventory for sprint 1 features
- product-designer ← compose the screens in that inventory
- qa-engineer ← write test plan for sprint 1
Reviewer queue: code-reviewer
Daily report: docs/daily/<today>.md
```
