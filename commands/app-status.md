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
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-render.mjs" docs/31-board.md
   ```

   Print the kanban, the per-owner load, and the NEEDS ATTENTION block.

3b. **Open team threads.** From `docs/team/messages.md`, list any `question` with no matching
   `answer`, and any `escalation` not yet closed by a `decision`. These are the conversations the
   team is stuck inside.

4. Print today's daily report if it exists at `docs/daily/<today>.md`.
5. Print recent bug list from `docs/51-bugs.md` if it exists — show open S1/S2 only.
5a. If `docs/81-findings.md` exists, print the findings register summary: counts per status, and
   **name every row still `OPEN` or `IN-PROGRESS`**. A register with open rows means the audit is
   not closed, however quiet the board looks.
6. Suggest the next action: `/app-build`, `/app-plan`, or "ship".

Be terse. This is a status print, not a narration.
