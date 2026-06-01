---
description: Show the current state of the project — vision, sprint goal, board, blockers, daily report
allowed-tools: Read, Glob, Grep, Bash
---

# /app-status — Where are we?

## Steps

1. Print the project's one-line vision from `docs/00-vision.md` (first heading + first paragraph).
2. Print the current sprint goal from `docs/30-sprint-plan.md`.
3. Print the board summary from `docs/31-board.md`:
   - Count of tickets per status (todo / in_progress / review / qa / done)
   - List any `BLOCKED` rows or rows with notes
4. Print today's daily report if it exists at `docs/daily/<today>.md`.
5. Print recent bug list from `docs/51-bugs.md` if it exists — show open S1/S2 only.
6. Suggest the next action: `/app-build`, `/app-plan`, or "ship".

Be terse. This is a status print, not a narration.
