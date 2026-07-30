---
name: board-doctor
description: Use to validate docs/31-board.md before spawning any agent, and to verify a developer's "DONE" claim before moving a row to review. Triggers as step 0 of /app-build and /app-run, from /app-status, and any time the board looks inconsistent. Catches tickets the sprint loop cannot see.
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
event log, and `scripts/board.mjs` refuses the illegal transition *before* it is written — a
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
check and do not silently proceed.** Work the **Manual fallback** below by hand and say in your
output that you did, so the verdict is never mistaken for a machine-checked one.

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
| **`stranded`** | `todo` behind a `blocked` dependency (transitively) | **Unblock, re-scope, or mark blocked so it is reported.** Emergent, not drift — no hand-edit to hunt. A ticket that *belongs* blocked should be created that way: `board.mjs add <ID> --depends X --status blocked` |
| `reviewer_missing` | In `review` with no reviewer recorded | Record the reviewer |
| `self_review` | Reviewer role == owner role, or the owner approved in the ledger | Assign a different reviewer; void the approval |
| `done_without_review` | `qa`/`done` with no approval in the ledger | Move back to review, or append the missing line |
| `cycles_invalid` | Cycles isn't an integer | Set an integer |
| `cycle_cap_breached` | `Cycles >= 2` but status isn't `blocked` | Stop the ticket, set blocked, surface to the user |
| `ledger_action_unknown` | A ledger row uses a word outside `requested/started/changes/approved/merged` | Append a corrected line — the verdict is otherwise invisible to every check |

Warnings (non-blocking): `not_ready` (a `todo` ticket whose acceptance criteria state no observable
outcome, or which has no spec anchor — the developer will decide alone and the decision ships),
`question_unanswered`, `message_pair_exceeded`, `message_chain_too_deep`,
`ledger_cycle_mismatch`, `review_never_started`, `orphan_ledger_entry`,
`ledger_action_unknown_superseded` (a bad ledger word that a later valid line already corrected —
kept visible because the ledger is append-only, but not blocking).

## Legacy boards

A board written before the Reviewer/Cycles columns and the review ledger existed cannot answer
review-integrity questions. The doctor detects this and **degrades those checks to warnings** —
structural checks still block. It never refuses to run a project purely for predating this feature.

To migrate, add the two columns and a `## Review ledger` section (see `sprint-planner`). Existing
rows can keep `—` in Reviewer and `0` in Cycles; the ledger starts empty and fills going forward.

## Verifying a DONE claim

A developer agent's `DONE: APP-NNN / Branch / Files / Tests: N added, all green` is a self-report.
Before moving the row to `review`, prove it:

```bash
BASE=$(sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh") || { echo "$BASE"; exit 1; }
sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" feat/APP-001-login "$BASE" "<project test command>"
```

`main` is not the base — the integration branch is whatever `docs/23-git-strategy.md` declares, and
`integration-branch.sh` is the single resolver. Verifying against the wrong base compares a branch
to a tree it never forked from.

Checks that the branch exists, that it carries commits not already on the base, that those commits
change files, and — if a test command is given — whether it ran and what it said. Pure `git` +
POSIX `sh`. **Three outcomes, and the headline word on line 1 always matches the exit code:**

| Line 1 | Exit | Means | Do |
|---|---|---|---|
| `VERIFIED` | 0 | Claim holds and the tests are settled — ran green, or `--docs-only` exempted them | `board.mjs move <ID> verified`, then `review_requested`; spawn `code-reviewer` |
| `REJECTED` | 1 | The claim is false, **or** a suite ran and reported failures | **Do not move the row.** Re-spawn the developer with the blocking lines verbatim |
| `CANNOT EVALUATE` | 2 | The branch half checks out, but the suite **could not be executed** — missing toolchain, missing SDK, no gradle wrapper, or no test command given | `board.mjs move <ID> verified_static`, then review as normal. **Do not re-spawn the developer** — there is no failure to fix |

The 1/2 split exists because it once did not: on a host with no Xcode the script exited `1
REJECTED`, whose instruction is "re-spawn the developer with these failures verbatim", and a
developer was sent to fix a bug that did not exist. When the output does not prove a suite actually
ran, the script reports 2, not 1 — a false REJECTED costs a phantom hunt and looks legitimate the
whole way, a false CANNOT EVALUATE costs one question.

The project's test command comes from `docs/20-architecture.md` or the House KB. If you genuinely
don't have one, run without it — you will get `CANNOT EVALUATE`, which is the correct answer. Never
restate the agent's "all green" as if it were confirmed.

## Inspectable but not runnable

A ticket whose *environment* is broken must not also lose its *code review*. The Definition of Done
has four checks that need only `git diff` and `grep`; in dry run 4 the board had no state for
"reviewable but not runnable", so a toolchain-blocked ticket could not reach `review` at all and
**`code-reviewer` never ran once in the whole sprint.**

`verified_static` is that state:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-001 verified_static \
  --by tech-manager --detail "the executable test suite (no Xcode on this host)"
```

- It unlocks `review_requested`, `approved` and `merged` — real progress keeps happening.
- It **refuses `closed`**. `done` is the word that asserts the suite ran green, and nothing has seen
  it do that. A sprint closes as *"merged, verification deferred"*, which is the truth.
- The fact rides on the row for the rest of its life: the board renders `qa (static only)` and
  `board.mjs show` prints `NOT RUN: <what>`.
- To clear it, run the suite and append the real verdict: `move APP-001 verified`. Then `closed` is
  accepted.

**A static-only ticket must never be reported as complete, and that is now a check, not a request.**
`scripts/ship-gate.sh` **BLOCKS** on any ticket carrying the flag and names it, with the two routes
out printed: run the suite and append `move <ID> verified`, or waive it deliberately with
`WAIVED: <ID> — <who> — <why>` in `docs/60-releases.md`.

This paragraph used to be prose asking the reader to remember — in the one place `ship-gate.sh`
exists to replace. It was reproduced end to end: `APP-001 → verified_static → merged → qa_passed`
gave `ship-inflight` no output, `board-doctor` "Board is coherent", and `ship-gate` `RESULT: CLEAR`,
all exit 0. **A sprint shipped asserting a suite that never executed.** The state was in the state
machine and the consumer that decides whether to release could not reach it.

Still name it in the standup and the ship-readiness report — the gate stops the release, it does not
tell the team. Cross-check with `board.mjs show --json`, where each ticket carries `verifiedStatic`
and `unrun`.

## Manual fallback (no Node)

Read `docs/31-board.md` and check, in this order:

1. Every row has the same cell count as the header.
2. No ticket ID appears twice.
3. Every `Status` is one of the six valid values — optionally suffixed `(static only)`, which is a
   generated marker meaning the ticket's test suite never ran. Read it as the bare status for every
   check below, and as an OPEN item everywhere else: it may reach `qa`, it may not reach `done`.
4. Every `Owner` is non-empty, is a real role, **and is a role `/app-build` actually spawns to work
   a ticket** — `ios-developer`, `android-developer`, `backend-developer`, `monetization-engineer`,
   `ux-architect`, `product-designer`, `product-manager`, `product-researcher`, `qa-engineer`,
   `data-analyst`, `devops-engineer`, `aso-specialist`, `web-developer`, `test-automation-engineer`,
   `verification-engineer`. Never `security-reviewer`, `code-reviewer`, `release-manager`,
   `tech-lead` or `tech-manager`: those gate and coordinate, they do not work tickets, so a ticket
   owned by one is never picked up and never reported.
5. Every ID in `Depends on` has a row; no self-dependency; no cycle.
6. **For every `todo` row, walk its dependencies. If any is `blocked`, the row is `stranded`** —
   report it, because the loop will not.
7. Every `review` row names a Reviewer, and no Reviewer equals its own Owner.
8. Every `qa`/`done` row has an `approved` line in the review ledger.
9. Every `Cycles` is an integer; `>= 2` requires `Status = blocked`.
10. Every ledger row's action is exactly one of `requested` / `started` / `changes` / `approved` /
    `merged`. Anything else is a verdict the checks cannot see — unless a later valid row for the
    same ticket already corrects it.

Report findings in the same shape the script uses (`TICKET  code  detail -> action`) and apply the
same rule: **do not spawn while an anomaly is open.**

## Output contract

```
BOARD DOCTOR: CLEAN — N tickets, 0 anomalies, M warnings. Proceeding.
```

```
BOARD DOCTOR: BLOCKED — N anomalies. Not spawning.
<the anomaly list verbatim>
Next: tech-manager to repair the board, then re-run.
```
