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

3c. **Open team threads.** From `docs/team/messages.md`, list any `question` with no matching
   `answer`, and any `escalation` not yet closed by a `decision`. These are the conversations the
   team is stuck inside.

4. Print today's daily report if it exists at `docs/daily/<today>.md`.
5. Print recent bug list from `docs/51-bugs.md` if it exists — show open S1/S2 only.
5a. If `docs/81-findings.md` exists, print the findings register summary: counts per status, and
   **name every row still `OPEN` or `IN-PROGRESS`**. A register with open rows means the audit is
   not closed, however quiet the board looks.
6. Suggest the next action: `/app-build`, `/app-plan`, or "ship".

Be terse. This is a status print, not a narration.
