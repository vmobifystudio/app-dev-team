---
description: Show the current state of the project — vision, sprint goal, board, blockers, daily report
allowed-tools: Read, Glob, Grep, Bash
---

# /app-status — Where are we?

## Steps

1. Print the project's one-line vision from `docs/00-vision.md` (first heading + first paragraph).
2. Print the current sprint goal from `docs/30-sprint-plan.md`.
3. Print the board summary from `docs/31-board.md`:
   - Count of tickets per status (todo / in_progress / review / qa / done / blocked)
   - List any `blocked` rows or rows with notes
   - **Run the board doctor** (`board-doctor` skill) and print its verdict:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
     ```
     Anomalies go at the **top** of the status output, not the bottom. A `stranded` ticket is the
     single most important thing on this screen: it is work the sprint loop will never surface on
     its own.
3a. **Render the board** so the shape is visible, not tabular:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-render.mjs" docs/31-board.md --out docs/32-board-view.md
   ```

   Print the kanban, the per-owner load, and the NEEDS ATTENTION block. **`--out` is not optional:**
   without it, checking status never refreshes the committed `docs/32-board-view.md`, which is the
   view humans actually read on GitHub — it silently drifts away from the board it claims to show.

3b. **Self-metrics — the only quantitative thing this system can say about itself.** Derived from
   `docs/31-board-events.jsonl` by `lib/events.mjs`; read them out of the CLI:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json
   ```

   Print the `metrics` object as exactly this block, and nothing more:

   ```
   SELF-METRICS  (E events, I inferred)
     cycle time (median)   4h 12m   claimed -> closed, over T tickets that have both
     review pass rate      67%      4 of 6 tickets approved with no rework
     rework rate           33%      2 of 6 went back for changes
     gates fired           rejected 1 · changes 2 · qa_failed 0 · blocked 1
     tickets per round     2026-07-28 3 · 2026-07-29 2
   ```

   Rules, because a metric that lies is worse than no metric:

   - `reviewPassRate` and `reworkRate` are `null` until some ticket has reached review. Print
     **`n/a`**, never `0%` — an empty denominator reads as "every review failed".
   - `medianCycleTimeMs` is `null` when no ticket has both a `claimed` and a `closed`/`merged`
     timestamp. Print `n/a — no ticket has completed`, and say how many are in flight.
   - **Migrated events have `ts: null`**, so a project that was migrated has tickets that cannot
     contribute a cycle time. Print the inferred count in the header and, if it is more than half
     the log, add one line: `most of this log is inferred from a hand-written board — timings
     start from the migration, not from the sprint`. A thin number presented as a measurement is
     the failure mode this block exists to avoid.
   - `gateFires` counts times a gate **caught** something. All zeros on a busy board is not a
     healthy team; it is a loop that is not running its gates. Say so rather than printing it
     approvingly.
   - Exit `2` → the log is missing or unreadable. Print `SELF-METRICS: CANNOT EVALUATE` with the
     reason. Exit `1` with output → the log folds with sequence violations (hand-appended lines);
     print the metrics *and* the violation list, since the numbers are derived from a log that
     disagrees with itself.
   - No `docs/31-board-events.jsonl` at all → print `SELF-METRICS: n/a — this project's board is
     hand-written; run /app-plan or /app-build once to migrate it`. Do not migrate from here:
     `/app-status` is a read-only command and migration rewrites `docs/31-board.md`.

3bb. **Loop trend and budget** — what happened to the *loop*, which the event log cannot answer:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/round-journal.mjs" show
   node "${CLAUDE_PLUGIN_ROOT}/scripts/round-journal.mjs" check
   ```

   Both read `docs/33-rounds.jsonl`, appended once per round by `/app-build` step 6a. `show` is the
   per-round burn-down (tickets waved, verdicts, retries, refusals);
   `check` is the one-line budget position, and it prints here whether or not it is near a ceiling —
   a spend first seen when it stops the run was seen too late. `ROUND JOURNAL: no rounds yet` is the
   correct output before the first `/app-build` round; it is not an error.

   **Spend reads `not measurable in this harness` unless a round actually reported a number.** That
   sentence is the honest one: rounds, spawns, retries and refusals are counted because they are
   countable, and no token figure is invented to fill the gap.

3c. **Open team threads.** From `docs/team/messages.jsonl`, list any `question` with no matching
   `answer`, and any `escalation` not yet closed by a `decision`. These are the conversations the
   team is stuck inside.

4. Print today's daily report if it exists at `docs/daily/<today>.md`.
5. Print recent bug list from `docs/51-bugs.md` if it exists — show open S1/S2 only.
   Then print the register view at `docs/90-register.md` — every item still `OPEN` or `IN-PROGRESS`,
   and separately the ones with **no ticket**, which are the ones nothing on the board will ever pick
   up. `node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" check` is the same answer as an exit code.
5a. If `docs/81-findings.md` exists, print the findings register summary: counts per status, and
   **name every row still `OPEN` or `IN-PROGRESS`**. A register with open rows means the audit is
   not closed, however quiet the board looks.
5b. **Refresh the founder inbox if `chief-of-staff` is active.** Read `docs/02-team-roster.md`. If
   its `chief-of-staff` row says `active`, spawn `chief-of-staff` **once** to write or update
   `docs/17-founder-inbox.md` from the board, the message log and the findings register, then
   continue to step 6.

   If the row says `conditional` or `off`, do not spawn it, and say so in one line at step 6 —
   `founder inbox: N/A — chief-of-staff is <state> per docs/02-team-roster.md`. That is the `off`
   reporting convention, not a `WAIVED:`.

   **Why this step exists.** The activation matrix could mark `chief-of-staff` active and *nothing
   anywhere spawned it*: step 6 below read `docs/17-founder-inbox.md` "if it exists", and no
   command wrote it. A trigger that fires into nothing is FC-002 — the rule that cannot fail — and
   the cost lands exactly where it hurts most, because this role's whole output is the one place a
   decision waiting on the founder is visible. Found by codex reviewing PR #11: the role had an
   activation trigger, a contract and a reason it cannot be a skill, and failed the fourth test —
   a spawn site.
6. Print the founder inbox from `docs/17-founder-inbox.md` — the `## Needs you now` section
   verbatim, plus the count of open and overdue commitments. It is written by `chief-of-staff`
   (step 5b) and is the one place a decision waiting on the founder is visible; a status report
   that omits it reports the machine and not the blockage.

   If the file is still absent after step 5b, say which case applies rather than printing nothing:
   `founder inbox: N/A — chief-of-staff is <state>`, or `founder inbox: CANNOT EVALUATE —
   chief-of-staff is active but wrote no docs/17-founder-inbox.md`. Silence here is
   indistinguishable from "nothing needs you", which is the one thing this section must never imply.
7. Suggest the next action: `/app-build`, `/app-plan`, or "ship".

Be terse. This is a status print, not a narration.
