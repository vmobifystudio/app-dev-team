---
name: board-doctor
description: Use to validate docs/31-board.md before spawning any agent, and to verify a developer's "DONE" claim before moving a row to review. Triggers as step 0 of /app-build and /app-run, from /app-status, and any time the board looks inconsistent. Catches tickets the sprint loop cannot see.
---

# Board doctor

The board is the team's only memory across agent invocations, and every row is written by an LLM
editing a Markdown table. That means the board can drift into states the sprint loop is structurally
unable to notice.

The worst one, and the reason this skill exists:

> `/app-build` treats a ticket as ready when `Status = todo` **and** every `Depends on` ID is `done`,
> and it exits the loop when there are no ready `todo` rows and nothing in `review`/`qa`.
> A ticket whose dependency is `blocked` therefore satisfies neither condition — so the loop
> **terminates and prints a successful sprint summary without ever mentioning it.**

Same for a row with a missing owner, an owner that isn't a real role, or a `Depends on` pointing at
an ID that doesn't exist. The work is on the board, scheduled to nobody, reported as complete.

**Rule: nothing spawns while an anomaly is open.**

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
| `dependency_self` | Ticket depends on itself | Remove the edge |
| `dependency_missing` | Depends on an ID with no row | Restore or drop it |
| `dependency_cycle` | A → B → A | Break the cycle |
| **`stranded`** | `todo` behind a `blocked` dependency (transitively) | **Unblock, re-scope, or mark blocked so it is reported** |
| `reviewer_missing` | In `review` with no reviewer recorded | Record the reviewer |
| `self_review` | Reviewer role == owner role, or the owner approved in the ledger | Assign a different reviewer; void the approval |
| `done_without_review` | `qa`/`done` with no approval in the ledger | Move back to review, or append the missing line |
| `cycles_invalid` | Cycles isn't an integer | Set an integer |
| `cycle_cap_breached` | `Cycles >= 2` but status isn't `blocked` | Stop the ticket, set blocked, surface to the user |

Warnings (non-blocking): `ledger_cycle_mismatch`, `review_never_started`, `orphan_ledger_entry`.

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
sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" feat/APP-001-login main "<project test command>"
```

Checks that the branch exists, that it carries commits not already on the base, that those commits
change files, and — if a test command is given — that it exits zero. Pure `git` + POSIX `sh`.

- `VERIFIED` → move the row to `review`, spawn `code-reviewer`.
- `REJECTED` → **do not move the row.** Re-spawn the developer with the blocking lines verbatim.

The project's test command comes from `docs/20-architecture.md` or the House KB. If you genuinely
don't have one, run without it and note `tests=unverified` in the daily fragment — never restate the
agent's "all green" as if it were confirmed.

## Manual fallback (no Node)

Read `docs/31-board.md` and check, in this order:

1. Every row has the same cell count as the header.
2. No ticket ID appears twice.
3. Every `Status` is one of the six valid values.
4. Every `Owner` is non-empty and is a real role from the roster.
5. Every ID in `Depends on` has a row; no self-dependency; no cycle.
6. **For every `todo` row, walk its dependencies. If any is `blocked`, the row is `stranded`** —
   report it, because the loop will not.
7. Every `review` row names a Reviewer, and no Reviewer equals its own Owner.
8. Every `qa`/`done` row has an `approved` line in the review ledger.
9. Every `Cycles` is an integer; `>= 2` requires `Status = blocked`.

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
