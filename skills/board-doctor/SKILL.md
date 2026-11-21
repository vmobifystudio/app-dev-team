---
name: board-doctor
description: On an app-dev-team project, use to validate the board (docs/31-board.md) before spawning any agent. Run at the top of every /app-build and /app-run round, by /app-status, and whenever the board looks inconsistent.
---

# Board doctor

The board is the team's only memory across agent invocations, and every row is written by an LLM
editing a Markdown table. That means the board can drift into states the sprint loop is structurally
unable to notice.

The worst one, and the reason this skill exists:

> `/app-build` treats a ticket as ready when `Status = todo` **and** every `Depends on` ID is merged
> (`qa` or `done`), and it exits the loop when there are no ready `todo` rows and nothing in
> `review`/`qa`. A ticket whose dependency is `blocked` therefore satisfies neither condition — so
> the loop **terminates and prints a successful sprint summary without ever mentioning it.**

Same for a row with a missing owner, an owner that isn't a real role, or a `Depends on` pointing at
an ID that doesn't exist. The work is on the board, scheduled to nobody, reported as complete.

**Rule: nothing spawns while an anomaly is open.**

## Two kinds of board, and what this skill is for on each

**Generated board** (`docs/31-board-events.jsonl` exists). `docs/31-board.md` is a rendering of the
event log, and `${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs` refuses the illegal transition *before* it is written — a
self-approval, a merge with no non-owner approval, a review requested on an unverified DONE, a claim
on an unmerged dependency. Those states are unrepresentable, not merely detectable, so on this board
the doctor is mostly a **drift detector**.

Mostly, and the exception matters. Anomalies on a generated board come in two kinds, and treating
them alike sends you hunting something that never happened:

- **Drift** — `malformed_row`, `status_invalid`, `duplicate_id`, `cycles_invalid`, `self_review`,
  `done_without_review`. The CLI cannot produce these, so something wrote the Markdown directly or
  appended to the log by hand. Find what did it *before* you re-render over the evidence, because
  the next `board.mjs` call erases the edit and the trail with it.
- **Emergent** — `stranded`, `dependency_cycle`, `cycle_cap_breached`, `owner_not_spawnable`.
  These are properties of the ticket *graph*, not of the file. `board.mjs` produces them legally:
  blocking a ticket strands every `todo` that depends on it, and no single append was illegal.
  **There is no hand-edit to find.** Fix the graph — unblock the dependency, re-scope the ticket,
  or file it blocked in the first place (`board.mjs add <ID> --depends X --status blocked`), which
  is the honest shape when a bug is filed against a ticket that is itself stuck.

**Hand-written board** (no event log). Nothing changes: the doctor is the primary gate, exactly as
described below, and every check still blocks. Do not refuse to run such a project — it is the
normal state of anything planned before the log existed. `/app-plan` and `/app-build` offer it one
migration (`board.mjs migrate`), and a board too old to parse legitimately stays on this path.

Either way, `docs/31-board.md` is what you read. It is deliberately still human-readable and
diffable; that is what lets this check work without running the CLI at all.

## Run it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
```

If `CLAUDE_PLUGIN_ROOT` is not set in your environment, glob for `**/scripts/board-doctor.mjs`
inside the plugin install and run it from there.

Exit codes: `0` coherent (warnings allowed) · `1` anomalies — **do not spawn** · `2` no board / no
parseable table (run `/app-plan` first).

Add `--json` for machine-readable output, `--quiet` to print only when something is wrong.

If you cannot locate or run the script — Node missing, path unresolvable — **do not skip the
check and do not silently proceed.** Read `references/manual-fallback.md` and work it by hand
(it also covers legacy boards that predate the Reviewer/Cycles columns), and say in your output that
you did, so the verdict is never mistaken for a machine-checked one.

## What it checks

Precedence-ordered per row. The first structural problem suppresses the derived ones, because an
invalid owner makes "who acts next" unanswerable.

| Code | Meaning | Fix |
|---|---|---|
| `malformed_row` | Cell count doesn't match the header | Repair the row |
| `duplicate_id` | Ticket ID appears twice | Delete or renumber |
| `status_invalid` | Status outside `todo/in_progress/review/qa/done/blocked` | Set a valid status |
| `owner_missing` | No owner — can never become ready | Assign an owner |
| `owner_invalid` | Owner isn't a known role | Reassign from the roster |
| **`owner_not_spawnable`** | Owner is a real role, but `/app-build` never spawns it to work a ticket | **Reassign to a role the loop spawns** — otherwise the ticket is never picked up *and* never reported |
| `dependency_self` | Ticket depends on itself | Remove the edge |
| `dependency_missing` | Depends on an ID with no row | Restore or drop it |
| `dependency_cycle` | A → B → A | Break the cycle |
| **`stranded`** | `todo` behind a `descoped` dependency (transitively); behind a `blocked` one it is a **warning** (Sprint 8 SM-7 — the CLI cascade already reported it) | **Re-plan: `corrected --depends`, or `descoped` too.** Emergent, not drift — no hand-edit to hunt. A ticket that *belongs* blocked should be created that way: `board.mjs add <ID> --depends X --status blocked` |
| `reviewer_missing` | In `review` with no reviewer recorded | Record the reviewer |
| `self_review` | Reviewer role == owner role, or the owner approved in the ledger | Assign a different reviewer; void the approval |
| `done_without_review` | `qa`/`done` with no approval in the ledger | Move back to review, or append the missing line |
| `cycles_invalid` | Cycles isn't an integer | Set an integer |
| `cycle_cap_breached` | `Cycles` above the cap (2, plus one per tech-lead `reopened`) while the ticket is still active (`todo`/`in_progress`/`review`) | Stop the ticket, set blocked, hand it to tech-lead. `Cycles = 2` is a ticket that used its budget legitimately |
| `shared_file_collision` | Two `in_progress` tickets name the same `Primary file:` | Serialize them or split the file scope before spawning both writers |
| `ledger_action_unknown` | A ledger row uses a word outside `requested/started/changes/approved/merged` | Append a corrected line — the verdict is otherwise invisible to every check |

Warnings (non-blocking): `not_ready` (a `todo` ticket whose acceptance criteria state no observable
outcome, or which has no spec anchor — the developer will decide alone and the decision ships),
`question_unanswered`, `answer_not_delivered`, `follow_up_unresolved`, `waiver_expired`,
`assumption_unvalidated`, `approval_inferred_only`, `message_pair_exceeded`, `message_chain_too_deep`,
`ledger_cycle_mismatch`, `review_never_started`, `orphan_ledger_entry`,
`ledger_action_unknown_superseded` (a bad ledger word that a later valid line already corrected —
kept visible because the ledger is append-only, but not blocking).

## Verifying a DONE claim

`/app-build` step 3 is the one copy of this procedure — run it from there. In short, against the
integration branch from `integration-branch.sh` (never `main`):

| Line 1 | Exit | Do |
|---|---|---|
| `VERIFIED` | 0 | `board.mjs move <ID> verified --by tech-manager --evidence <record verify-done printed> --token <minted>`, then `review_requested` |
| `REJECTED` | 1 | `rejected` — the row stays `in_progress` and the retry is not a review cycle. Re-spawn the developer with the blocking lines verbatim |
| `CANNOT EVALUATE` | 2 | The default `--static` lane always lands here (the suite has not run), as does a toolchain that cannot run it. `verified_static`, then review as normal. **Do not re-spawn the developer** — there is no failure to fix |

Never restate the agent's "all green" as if it were confirmed.

## Inspectable but not runnable

(Orchestrator commands: the inline mint is the main session's. A subagent never runs it — it
returns the command for the orchestrator to run.)

A ticket whose *environment* is broken must not also lose its *code review* — four Definition-of-Done
checks need only `git diff` and `grep`. `verified_static` is that state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-001 verified_static \
  --by tech-manager --detail "the executable test suite (no Xcode on this host)" \
  --token "$(node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" actor mint --role tech-manager --ticket APP-001)"
```

- It unlocks `review_requested`, `approved` and `merged` — real progress keeps happening.
- It **refuses `closed`**. `done` is the word that asserts the suite ran green, and nothing has seen
  it do that. A sprint closes as *"merged, verification deferred"*, which is the truth.
- The fact rides on the row for the rest of its life: the board renders `qa (static only)` and
  `board.mjs show` prints `NOT RUN: <what>`.
- To clear it, run the suite and append the real verdict: `move APP-001 verified --evidence <record> --token <minted>`. Then `closed` is
  accepted.

**A static-only ticket must never be reported as complete, and that is now a check, not a request.**
`${CLAUDE_PLUGIN_ROOT}/scripts/ship-gate.sh` **BLOCKS** on any ticket carrying the flag and names it, with the two routes
out printed: run the suite and append `move <ID> verified --evidence <record> --token <minted>`, or waive it deliberately with
`WAIVED: <ID> — <who> — <why>` in `docs/60-releases.md`.

Still name it in the standup and the ship-readiness report — the gate stops the release, it does not
tell the team. Cross-check with `board.mjs show --json`, where each ticket carries `verifiedStatic`
and `unrun`.

## Output contract

```
BOARD DOCTOR: CLEAN — N tickets, 0 anomalies, M warnings. Proceeding.
```

```
BOARD DOCTOR: BLOCKED — N anomalies. Not spawning.
<the anomaly list verbatim>
Next: tech-manager to repair the board, then re-run.
```
