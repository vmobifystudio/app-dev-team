---
description: Run the sprint — launch developer agents in parallel, review each PR, gate to QA, surface bugs back into the loop
argument-hint: [ticket IDs, optional — defaults to all ready tickets]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-build — Execute the sprint

Tickets (optional, default = all ready): $ARGUMENTS

## Steps

0. **Board doctor gate.** Use the `board-doctor` skill *before spawning anything*:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
   ```

   - Exit `0` → print `BOARD DOCTOR: CLEAN — N tickets` and continue.
   - Exit `1` → **stop. Spawn nobody.** Print the anomaly list verbatim, spawn `tech-manager` once
     to repair the board, then re-run the doctor. If it fails a second time, surface to the user.
   - Exit `2` → no board yet; suggest `/app-plan`.

   This gate is not optional and it runs **every round**, not just the first — a ticket becomes
   `stranded` the moment its dependency is blocked, which happens mid-loop at step 4.

1. **Read state.**
   - `docs/31-board.md` — find tickets where `Status = todo` and every `Depends on` ID is `done`.
   - `docs/51-bugs.md` (if it exists) — for every open `S1` or `S2`, ensure a matching `BUG-NNN-fix` row exists on the board; if not, spawn `tech-manager` once with the instruction to create them, then re-read the board.

2. **Spawn developers in parallel.** Use the `parallel-orchestrator` skill. Launch IC agents concurrently in a **single assistant message** — one Task invocation per owner, each passed the full list of tickets they're working this round:
   - `ios-developer` for iOS-ready tickets
   - `android-developer` for Android-ready tickets
   - `backend-developer` only if backend is in scope per `docs/20-architecture.md`
   Run `ux-designer` and `qa-engineer` in this same message when their work is ready (early flows / test plan drafts).

3. **Streaming review.** As each developer agent returns `DONE: APP-NNN`:
   - **Verify the claim before you believe it** (`board-doctor` skill):

     ```bash
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> main "<project test command>"
     ```

     `REJECTED` → leave the row where it is and re-spawn the developer with the blocking lines
     verbatim. This counts as a **developer** retry, not a review cycle.
     `VERIFIED` → continue. If it reports `tests=unverified`, say so in the daily fragment; never
     restate the agent's "all green" as confirmed.
   - Move the board row to `Status = review`, set the `Reviewer` column, and append to the review
     ledger: `<ts> | APP-NNN | requested | <owner> -> code-reviewer`.
   - **The reviewer must not be the owner.** For a ticket owned by `code-reviewer` (or any review of
     review work), route to `tech-lead` instead.
   - Spawn a `code-reviewer` agent for that branch immediately — do not wait for the other devs. Multiple reviewers can run in parallel, and they can run in parallel with still-running developers.

4. **Process reviewer verdicts.**
   - `APPROVED` → spawn `tech-manager` to run the Merge gate (see `agents/tech-manager.md`). After merge, board row goes `review → qa`.
   - `REQUEST CHANGES` → re-spawn the original developer with the reviewer's blocking notes, and
     **increment the `Cycles` column** (not a substring in `Notes`).
   - **Cap: 2 review cycles.** On the 3rd `REQUEST CHANGES`, stop the loop for that ticket, set status to `blocked`, and surface to the user with the full reviewer + developer history. Do not auto-retry beyond that.
   - Setting a ticket `blocked` here is exactly what strands its dependents — which is why step 0
     re-runs at the top of every round.

5. **QA pass.** Once a wave of tickets is in `qa`, spawn `qa-engineer` once to exercise the acceptance criteria. QA writes new defects to `docs/51-bugs.md`. S1/S2 bugs come back into the loop in step 1 next round.

6. **Daily report.** Collect the per-agent fragments at `docs/daily/<today>-*.md` and spawn `tech-manager` to concatenate them into `docs/daily/<today>.md`.

7. **Loop** back to step 0 until the board has no ready `todo` rows and nothing in `review`/`qa`.

8. **Exit check — never declare a sprint done on an incoherent board.** Re-run the doctor one last
   time. Then print the sprint summary, which must explicitly account for **every** non-`done` row:
   blocked, stranded, and waiting tickets are named with their reason. A ticket that exists must
   never be absent from the summary. Suggest `/app-plan` (next sprint), `/app-ship` (release v1),
   or `/app-status` (inspect).

## Safety

- **Never spawn while the board doctor reports an anomaly.**
- **Never move a row to `review` on an unverified `DONE`.**
- Never spawn more than one agent for the same ticket simultaneously.
- Never auto-merge across a `REQUEST CHANGES`.
- Never re-spawn a developer past the 2-cycle cap without user input.
- **Spawn budget:** at most 6 developer retries per ticket across the whole sprint (review cycles
  plus rejected-DONE retries). Past that the ticket is `blocked` and goes to the user — a ticket
  that cannot converge in six attempts is a spec problem, not an effort problem.
- If any developer agent returns `BLOCKED: APP-NNN`, surface the blocker verbatim and stop that ticket; do not invent an answer.
