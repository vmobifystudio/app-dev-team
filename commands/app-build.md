---
description: Run the sprint — launch developer agents in parallel, review each PR, gate to QA, surface bugs back into the loop
argument-hint: [ticket IDs, optional — defaults to all ready tickets]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# /app-build — Execute the sprint

Tickets (optional, default = all ready): $ARGUMENTS

## Steps

1. **Read state.**
   - `docs/31-board.md` — find tickets where `Status = todo` and every `Depends on` ID is `done`.
   - `docs/51-bugs.md` (if it exists) — for every open `S1` or `S2`, ensure a matching `BUG-NNN-fix` row exists on the board; if not, spawn `tech-manager` once with the instruction to create them, then re-read the board.

2. **Spawn developers in parallel.** Use the `parallel-orchestrator` skill. Launch IC agents concurrently in a **single assistant message** — one Task invocation per owner, each passed the full list of tickets they're working this round:
   - `ios-developer` for iOS-ready tickets
   - `android-developer` for Android-ready tickets
   - `backend-developer` only if backend is in scope per `docs/20-architecture.md`
   Run `ux-designer` and `qa-engineer` in this same message when their work is ready (early flows / test plan drafts).

3. **Streaming review.** As each developer agent returns `DONE: APP-NNN`:
   - Move the board row to `Status = review`.
   - Spawn a `code-reviewer` agent for that branch immediately — do not wait for the other devs. Multiple reviewers can run in parallel, and they can run in parallel with still-running developers.

4. **Process reviewer verdicts.**
   - `APPROVED` → spawn `tech-manager` to run the Merge gate (see `agents/tech-manager.md`). After merge, board row goes `review → qa`.
   - `REQUEST CHANGES` → re-spawn the original developer with the reviewer's blocking notes. Track the cycle count per ticket in the board row's `Notes` column as `cycles=N`.
   - **Cap: 2 review cycles.** On the 3rd `REQUEST CHANGES`, stop the loop for that ticket, set status to `blocked`, and surface to the user with the full reviewer + developer history. Do not auto-retry beyond that.

5. **QA pass.** Once a wave of tickets is in `qa`, spawn `qa-engineer` once to exercise the acceptance criteria. QA writes new defects to `docs/51-bugs.md`. S1/S2 bugs come back into the loop in step 1 next round.

6. **Daily report.** Collect the per-agent fragments at `docs/daily/<today>-*.md` and spawn `tech-manager` to concatenate them into `docs/daily/<today>.md`.

7. **Loop** until the board has no ready `todo` rows and nothing in `review`/`qa`. Then print the sprint summary and suggest `/app-plan` (next sprint), `/app-ship` (release v1), or `/app-status` (inspect).

## Safety

- Never spawn more than one agent for the same ticket simultaneously.
- Never auto-merge across a `REQUEST CHANGES`.
- Never re-spawn a developer past the 2-cycle cap without user input.
- If any developer agent returns `BLOCKED: APP-NNN`, surface the blocker verbatim and stop that ticket; do not invent an answer.
