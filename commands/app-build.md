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
   - `docs/31-board.md` — find tickets where `Status = todo` and every `Depends on` ID is **merged**
     — that is, `qa` **or** `done`.

     A dependency is satisfied when its code is on the integration branch, not when QA has finished
     with it. Requiring `done` stalls every dependent behind a QA pass: observed live, a foundation
     ticket merged cleanly and both features that depended on it stayed unready, so the sprint had
     nothing to do while one QA cycle ran. QA failures already have their own mechanism — they
     become `BUG-NNN-fix` tickets in step 1 — so blocking dependents a second time buys nothing and
     serializes the whole board behind its slowest gate.
   - `docs/51-bugs.md` (if it exists) — for every open `S1` or `S2`, ensure a matching `BUG-NNN-fix` row exists on the board; if not, spawn `tech-manager` once with the instruction to create them, then re-read the board.

2. **Spawn developers in parallel.** Use the `parallel-orchestrator` skill, which now requires a
   **git worktree per writing agent, created before the spawn** (`agent-isolation`), and serializes
   any ticket pair that shares a file. Launch IC agents concurrently in a **single assistant
   message** — one Task invocation per owner, each passed its worktree path and the full list of
   tickets they're working this round.

   **Spawn by the ticket's `Owner` column — never from a hardcoded list.** The authority on which
   owners this loop can spawn is `board-doctor` (Manual-fallback check 4) and the
   `BUILD_SPAWNABLE_OWNERS` set it shares with `scripts/lib/board.mjs`; `team-doctor.mjs` fails the
   build if this file and that set disagree, which is the only reason naming them here is safe:
   `ios-developer`, `android-developer`, `backend-developer`, `monetization-engineer`,
   `ux-designer`, `qa-engineer`, `data-analyst`, `devops-engineer`, `aso-specialist`,
   `verification-engineer`. **Do not copy this roster into any file `team-doctor` does not check** —
   the unchecked copy in `/app-audit` had already dropped `ux-designer` and `qa-engineer`, so its
   accessibility and test-plan remediation tickets were filed to roles nothing spawned: never picked
   up, never blocked, never reported, and the loop drained around them and printed a successful
   sprint.

   Spawn only what the project actually has this round: `backend-developer` when backend is in scope
   per `docs/20-architecture.md`, `ux-designer` / `qa-engineer` when their flow or test-plan work is
   ready. `security-reviewer`, `code-reviewer`, `release-manager`, `tech-lead` and `tech-manager`
   gate and coordinate — they never own a ticket, and the doctor rejects one that does
   (`owner_not_spawnable`).

3. **Streaming review.** As each developer agent returns `DONE: APP-NNN`:
   - **Verify the claim before you believe it** (`board-doctor` skill). The base is the project's
     integration branch, resolved once from its own git strategy — never a hardcoded `main`, because
     the flagship model integrates on `develop` (`knowledge/git-workflow.md`) and merging features
     straight to `main` there is not recoverable by a later fix:

     ```bash
     BASE=$(sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh") \
       || { echo "$BASE"; echo "STOP: integration branch unresolved"; exit 2; }
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" "<project test command>"
     ```

     **If `integration-branch.sh` exits 2, STOP the round** and surface its message (it prints on
     stdout, so `$BASE` holds it) — do not run `verify-done.sh`, do not merge. Exit 2 means the
     integration branch could not be resolved, and every base you might substitute is a guess.
     Merging feature work into the wrong branch is not recoverable by a later fix, which is exactly
     why this no longer falls back to `main` on its own.

     Use that same `$BASE` for the merge gate in step 4 — one resolution per round, not one per
     call site.

     **For a ticket whose deliverable is a document, not code, pass `--docs-only` instead of a test
     command** — that is, tickets owned by `ux-designer`, `qa-engineer`, `aso-specialist`,
     `data-analyst`, or `verification-engineer`:

     ```bash
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" --docs-only
     ```

     Branch, commits and changed files are still verified; only the test requirement is lifted.
     Without this the flag was unreachable — this loop always passed a test command — so a doc
     ticket either failed a test it structurally cannot have, or got waved through unverified.

     `REJECTED` → leave the row where it is and re-spawn the developer with the blocking lines
     verbatim. This counts as a **developer** retry, not a review cycle.
     `VERIFIED` → continue. If it reports `tests=unverified`, say so in the daily fragment; never
     restate the agent's "all green" as confirmed.
     Exit `2` → **CANNOT EVALUATE**, not a pass: you supplied no test command for a code ticket, so
     nothing verified the "all green" claim. Supply the project's test command and re-run, or use
     `--docs-only` if the ticket really has no test.
   - **Read the `Shared surfaces touched` line.** If two returning agents name the same file, or
     both report *creating* a cross-cutting abstraction for the same concern, route it to
     `tech-manager` **now** — before the merge gate, while both agents still exist — to pick one
     shape and re-spawn the loser with the winner named.
   - **Verify the `Assumptions & open questions` line against the ledger.** Every question the agent
     says it raised must have its row in `docs/team/messages.md`. A missing row is a defect in the
     report, not something to quietly fix: file the question yourself, note in the standup that the
     agent reported raising it and had not, and treat that report's other unverifiable claims with
     the same suspicion. `ASSUMED, NOT RAISED` is fine and just needs routing. (Observed live —
     a sincere, false "raised" line in the one artifact the standup aggregates; see `defect-hunting`
     on claims that read fine and are not true.)
   - **Check the daily fragment exists** at `docs/daily/<today>-<role>-<ticket>.md` on the branch —
     that exact spelling, per `team-protocol`'s canonical paths table; no other is recognised. It is
     the sole input to the standup and only 1 of 4 dry-run agents wrote one. Missing → ask that
     agent for it before moving the row; never write it on their behalf.
   - Move the board row to `Status = review`, set the `Reviewer` column, and append to the review
     ledger: `<ts> | APP-NNN | requested | <owner> -> code-reviewer`.
   - **The reviewer must not be the owner.** For a ticket owned by `code-reviewer` (or any review of
     review work), route to `tech-lead` instead.
   - Spawn a `code-reviewer` agent for that branch immediately — do not wait for the other devs. Multiple reviewers can run in parallel, and they can run in parallel with still-running developers.

4. **Process reviewer verdicts.**
   - `APPROVED` → spawn `tech-manager` to run the Merge gate (see `agents/tech-manager.md`), passing
     the `$BASE` resolved in step 3 as the branch to merge into. After merge, board row goes
     `review → qa`.
   - `REQUEST CHANGES` → re-spawn the original developer **pointed at
     `docs/53-reviews/APP-NNN-cycle-N.md`**, not at notes you are holding in context, and
     **increment the `Cycles` column** (not a substring in `Notes`). If that file does not exist,
     ask the reviewer to write it before re-spawning anyone — an unpersisted verdict is one
     compaction away from being lost, and then nobody can say what was wrong.
   - **Cap: 2 review cycles.** On the 3rd `REQUEST CHANGES`, stop the loop for that ticket, set status to `blocked`, and surface to the user with the full reviewer + developer history. Do not auto-retry beyond that.
   - Setting a ticket `blocked` here is exactly what strands its dependents — which is why step 0
     re-runs at the top of every round.

4a. **Clean up worktrees.** After each merge, remove the ticket's worktree so the next round starts
   clean: `git worktree remove .agent-wt/APP-NNN && git worktree prune`.

5. **QA pass — starting with the runtime gate.** Once a wave of tickets is in `qa`, run the
   `runtime-gate` skill's script **on the integration branch, before spawning `qa-engineer`**:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-gate.sh" --project-root .
   ```

   **Why here and not per-ticket after `verify-done.sh`:** one app build per wave instead of one per
   ticket, run on the merged tree — which is the only place "three individually-approved tickets and
   no composition root" is visible at all. A per-ticket run costs N builds to ask a question no
   single feature branch can answer.

   - Exit `0` → the app builds and launches. Name the evidence path in the standup and continue.
   - Exit `1` → **the wave does not advance.** No row moves `qa → done`. File it as an `S1` in
     `docs/51-bugs.md` (an app that does not build or launch is data-loss-tier by definition), so
     step 1 turns it into a `BUG-NNN-fix` ticket next round. Re-spawn the owning developer with the
     gate's compiler output **verbatim** — it printed it precisely so you would not have to
     paraphrase it.
   - Exit `2` → **CANNOT EVALUATE, which is not a pass.** Print its lines verbatim in the standup
     under `RUNTIME GATE: CANNOT EVALUATE`. QA still runs and rows may still advance on QA's own
     verdict, but nothing anywhere may record this build as having been launched — `/app-ship`
     re-runs the same gate and will ask again.

   Then spawn `qa-engineer` once to exercise the acceptance criteria; where the Axiom toolchain is
   present it drives the P0 journey per the `runtime-gate` skill rather than stopping at launch. QA
   writes new defects to `docs/51-bugs.md`. S1/S2 bugs come back into the loop in step 1 next round.

6. **Daily report + board view.** Collect the per-agent fragments at
   `docs/daily/<today>-<role>-<ticket>.md` and spawn `tech-manager` to concatenate them into the
   standup at `docs/daily/<today>.md` (both spellings from `team-protocol`'s paths table). Render the board so
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
- **Never advance a wave across a `RUNTIME GATE: FAIL`, and never record a `CANNOT EVALUATE` as a
  launched build.** Every other gate here checks that the process was followed; this is the only one
  that runs the artifact.
- **Never merge a branch containing another ticket's files.** That means a shared tree was used and
  the sibling ticket's branch is probably wrong too — stop the round and check both.
- Never spawn more than one agent for the same ticket simultaneously.
- Never auto-merge across a `REQUEST CHANGES`.
- Never re-spawn a developer past the 2-cycle cap without user input.
- **Spawn budget:** at most 6 developer retries per ticket across the whole sprint (review cycles
  plus rejected-DONE retries). Past that the ticket is `blocked` and goes to the user — a ticket
  that cannot converge in six attempts is a spec problem, not an effort problem.
- If any developer agent returns `BLOCKED: APP-NNN`, surface the blocker verbatim and stop that ticket; do not invent an answer.
