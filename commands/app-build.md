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

2. **Spawn developers in parallel.** Use the `parallel-orchestrator` skill, which now requires a
   **git worktree per writing agent, created before the spawn** (`agent-isolation`), and serializes
   any ticket pair that shares a file. Launch IC agents concurrently in a **single assistant
   message** — one Task invocation per owner, each passed its worktree path and the full list of
   tickets they're working this round:
   **Spawn by the ticket's `Owner` column — never from a hardcoded list.** Any of these can own and
   work a ticket, and the board doctor rejects an owner this loop cannot spawn:

   | Owner | Spawn when |
   |---|---|
   | `ios-developer` | iOS-ready tickets |
   | `android-developer` | Android-ready tickets |
   | `backend-developer` | backend is in scope per `docs/20-architecture.md` |
   | `monetization-engineer` | paywall / IAP / ads tickets |
   | `data-analyst` | `APP-NNN-analytics` instrumentation tickets |
   | `devops-engineer` | CI / signing / build-config tickets |
   | `aso-specialist` | store-asset tickets |
   | `verification-engineer` | tickets that add a constant, threshold, guard rule, or baseline |
   | `ux-designer`, `qa-engineer` | in the same message when their work is ready (early flows / test plan drafts) |

   The previous version listed only the three platform developers. `/app-audit` files `AUDIT-NNN`
   tickets against monetization, analytics, ASO, DevOps and security findings and then says
   "remediate via the normal `/app-build` loop" — so those tickets were owned by roles this step
   never spawned. They were never picked up, never blocked, and never reported: the loop drained
   around them and printed a successful sprint. Same silent-drop class as a stranded dependency.

   `security-reviewer`, `code-reviewer`, `release-manager`, `tech-lead` and `tech-manager` do
   **not** work tickets — they gate, review, and coordinate. A ticket owned by one of them is a
   board error (`owner_not_spawnable`).

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

4a. **Clean up worktrees.** After each merge, remove the ticket's worktree so the next round starts
   clean: `git worktree remove ../.agent-wt/APP-NNN && git worktree prune`.

5. **QA pass.** Once a wave of tickets is in `qa`, spawn `qa-engineer` once to exercise the acceptance criteria. QA writes new defects to `docs/51-bugs.md`. S1/S2 bugs come back into the loop in step 1 next round.

6. **Daily report + board view.** Collect the per-agent fragments at `docs/daily/<today>-*.md` and
   spawn `tech-manager` to concatenate them into `docs/daily/<today>.md`. Then render the board so
   the state is visible rather than tabular:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-render.mjs" docs/31-board.md --out docs/32-board-view.md
   ```

   Print the terminal view in the standup. `docs/32-board-view.md` carries a Mermaid dependency
   graph that renders on GitHub — stranded and blocked tickets are outlined in red.

   Also surface unanswered team messages: any `question` in `docs/team/messages.md` with no matching
   `answer` is a `tech-manager` action item, not a thing to leave sitting.

7. **Loop** back to step 0 until the board has no ready `todo` rows and nothing in `review`/`qa`.

8. **Exit check — never declare a sprint done on an incoherent board.** Re-run the doctor one last
   time. Then print the sprint summary, which must explicitly account for **every** non-`done` row:
   blocked, stranded, and waiting tickets are named with their reason. A ticket that exists must
   never be absent from the summary. Suggest `/app-plan` (next sprint), `/app-ship` (release v1),
   or `/app-status` (inspect).

## Safety

- **Never spawn a writing agent without its own worktree** (or, failing that, serialized). Measured
  cost of ignoring this: `docs/research/2026-07-29-dry-run-parallel-agent-collision.md`.
- **Never spawn while the board doctor reports an anomaly.**
- **Never move a row to `review` on an unverified `DONE`.**
- **Never merge a branch containing another ticket's files.** That means a shared tree was used and
  the sibling ticket's branch is probably wrong too — stop the round and check both.
- Never spawn more than one agent for the same ticket simultaneously.
- Never auto-merge across a `REQUEST CHANGES`.
- Never re-spawn a developer past the 2-cycle cap without user input.
- **Spawn budget:** at most 6 developer retries per ticket across the whole sprint (review cycles
  plus rejected-DONE retries). Past that the ticket is `blocked` and goes to the user — a ticket
  that cannot converge in six attempts is a spec problem, not an effort problem.
- If any developer agent returns `BLOCKED: APP-NNN`, surface the blocker verbatim and stop that ticket; do not invent an answer.
