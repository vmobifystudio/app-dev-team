---
name: parallel-orchestrator
description: Use to actually launch multiple developer agents in parallel via the subagent tool (Task/Agent), given a sprint plan and board. Triggers from /app-build or when the tech-manager says "spawn the pod". Encapsulates the rules for safe concurrent agent execution.
---

# Parallel orchestrator

You launch IC agents concurrently. This skill exists because parallel agent launches need rules — without them, agents stomp each other.

## When to use

Called from `/app-build` or by the tech-manager once `docs/31-board.md` has tickets in `todo` ready to start.

## Procedure

0. **Doctor gate.** Run the `board-doctor` skill first. If it exits non-zero, spawn nobody — a
   parallel launch against an incoherent board multiplies the damage across every track at once.

0a. **Budget gate.** The loop has no economic brake other than this one:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/round-journal.mjs" check
   ```

   Exit `1` means a ceiling is reached: **stop the loop**, print the line verbatim, and report what
   is unfinished. Do not start a round you cannot finish. Ceilings come from `--max-rounds` /
   `--max-spawns` / `--max-retries` / `--max-spend-usd`, or `APP_TEAM_MAX_*` in the environment.
   Raising one is a decision the user makes, not one you make to keep going.

1. **Read the board.** Find tickets where `Status = todo` and all `Depends on` IDs are **merged**
   (`qa` or `done`) — a dependency is satisfied once its code is on the integration branch, not once
   QA has signed it off. Requiring `done` stalls every dependent behind a QA pass.

   Read it from the log rather than the table where one exists —
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json` gives you `status` and `dependsOn`
   per ticket already derived.

   Note what this readiness rule *cannot* express: a ticket behind a `blocked` dependency is not
   ready and never will be, but it is also never reported. That is the doctor's `stranded` check,
   and it is why step 0 exists.

1a. **Claim before you spawn.** One append per ticket, and it is also the readiness check you cannot
   forget to run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-001 claimed --by ios-developer
   ```

   `claimed` is **refused** on a ticket whose dependency has never merged. That refusal is the
   answer, not an obstacle: spawn nobody for that ticket and say why in the standup. Claiming before
   the spawn also means the board says who is working on what *while* they work — the window in
   which two orchestrators could both hand out the same ticket closes here.

2. **Group by owner.** One agent invocation per owner, batched. iOS dev gets all their ready tickets in one prompt; same for Android; same for backend.

2a. **Lease one slot per writing agent, then let the gate check you** (`agent-isolation`):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner ios-developer --tickets APP-001,APP-004
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner android-developer --tickets APP-002
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ios-developer android-developer
   ```

   **The gate takes OWNERS now, because that is what has a tree each.** Step 2 above batches by
   owner and step 3 below tells each agent to use "its worktree path" — those two sentences and a
   worktree-per-ticket rule could not all be true at once, and the first owner with two ready
   tickets is where it breaks (`agent-isolation` Rule 1 has the full argument). The owner cuts a
   branch per ticket inside its slot, so branch-per-ticket and `code-reviewer`'s "this branch
   contains only this ticket's files" both still hold.

   `lease` refuses when the pool is full — that is the round's parallelism cap doing its job, and
   raising it (`--pool N`) is a decision about how much of the machine the studio may use, not a
   workaround to keep going.

   The gate is the last thing you run before the launch message, and **its exit code decides
   whether the launch happens**:

   - `0 GO` → spawn. With one ticket it prints `SERIALIZED` instead — that is the legal one-writer
     path, and it holds only while the writer stays alone. Say so in the standup.
   - `1 REFUSED` → **spawn nobody.** Two or more writers, at least one with no worktree. It names
     the missing IDs and prints the `git worktree add` line for each. Create them and re-run, or
     serialize the round.
   - `2 CANNOT EVALUATE` → not a git repo, so worktrees are unavailable. Serialize; never treat a
     2 as a go-ahead.

   **Why this is a script and not a paragraph.** The paragraph existed. It had existed since v1.4.0,
   backed by a measured collision — a commit containing another ticket's half-written files, ~50% of
   an agent's budget burned redoing work it had already done, add/add conflicts on all 8 files
   (`docs/research/2026-07-29-dry-run-parallel-agent-collision.md`). Then, hours after spending a day
   hardening that paragraph, the orchestrator spawned two writers into one checkout anyway; one ran
   `git stash` + `git reset` and 22 files of the other's work vanished, recoverable only by luck
   (DR4-027). Knowing a rule, having written it, and having defended it does not make you apply it.
   Run the gate.

2a-i. **Destructive commands are banned for any agent that shares a tree** — and you tell every
   agent so in its prompt. Never, repo-wide:

   ```
   git reset (--hard or otherwise)   git stash   git checkout -- .
   git clean                          git add -A / git add . / git commit -a
   ```

   Stage by explicit path (`agent-isolation` Rule 2). If you need a clean tree to run a check,
   **copy the repo to a temp dir and dirty that instead** — `cp -R` or `git worktree add` a scratch
   worktree. Those commands are all unrecoverable from inside your run, and one of them is exactly
   how DR4-027 lost 22 files. If HEAD moved under you, stop and report (`agent-isolation` Rule 5).

2b. **Check for file overlap, not just feature independence.** The sprint plan judges tickets
   independent by *feature*. Two "independent" tickets that touch the same files still produce a
   total merge conflict. Before launching a batch, list the files each ticket is likely to touch
   (from the impl spec and the ticket's own description). Any ticket pair sharing a file is
   **serialized**, not parallelised.

3. **Launch in a single message.** Use the subagent tool (`Task`/`Agent`) with multiple invocations in the same assistant message so they run concurrently. This is the critical step — sequential launches give up the parallelism we just earned.

   Each agent's prompt must name **its worktree path** as the project root — never the repo root.

4. **Compose each agent's prompt with `spawn-prompt.mjs` — do not hand-write it.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-prompt.mjs" compose \
     --root . --ticket APP-NNN --role <owner> --slot .agent-wt/<owner>
   ```

   Use its stdout as the spawn message **verbatim**. It already contains the ticket ID, the board
   entry, spec pointers, the worktree/slot path, and — the part that matters — **the six-field
   output contract INLINED as literal text**, not a pointer to `team-protocol`.

   **This is not a style preference.** The first agent ever spawned against this loop (2026-08-06,
   H4) returned 1 of 6 contract fields. `report-check.mjs` was built in response. The very next
   measured spawn (2026-08-07, H5) — with `report-check.mjs` live — returned **0 of 6**, because the
   prompt said *"Return the CODE profile defined in `team-protocol`"* instead of containing it. The
   identical ticket, role and slot, re-spawned with the contract pasted in literally (H5b), returned
   all six. Same model, same role file — the only variable was whether the prompt text contained the
   field labels or pointed at them. That is a dispatch failure, not a capability one, and it is now a
   command instead of something to remember: `spawn-prompt.mjs verify --role <owner> --prompt <file>`
   confirms a composed prompt actually contains the labels before you trust it.

5. **Stream the reviews — do not wait for the whole batch.** As each developer Task returns
   `DONE: APP-NNN`, **verify the claim before you act on it**:

   ```bash
   BASE=$(sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh") || { echo "$BASE"; exit 1; }
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" "<project test command>"
   ```

   **Never hardcode `main` as the base.** The integration branch comes from the project's own
   `docs/23-git-strategy.md` via that resolver, once per round; on a develop-model project a
   hardcoded `main` diffs and merges against the wrong branch, which is not recoverable by a later
   fix. If the resolver exits 2, stop the round and surface its message.

   Every outcome is an append (`done_reported` on arrival, then `verified` / `verified_static` /
   `rejected`, then `review_requested`) — see `/app-build` step 3 for the exact commands.

   **verify-done has THREE outcomes, and the third is the one that keeps the review stage alive:**

   | Line 1 | Exit | Do |
   |---|---|---|
   | `VERIFIED` | 0 | `board.mjs move APP-NNN verified --by <owner>`, then `review_requested` |
   | `REJECTED` | 1 | The row stays where it is. Re-spawn that developer with the blocking lines verbatim |
   | `CANNOT EVALUATE` | 2 | `board.mjs move APP-NNN verified_static --by tech-manager --detail "<what could not run>"`, then `review_requested`. **Do not re-spawn the developer — there is no failure to fix** |

   This skill used to say there were two outcomes and that "only on `VERIFIED`" could a ticket reach
   review. That is DR4-002, the most expensive finding of dry run 4: a ticket blocked on the
   *environment* also lost its *code review*, and **`code-reviewer` never ran once in the entire
   sprint**. `verified_static` was added to unlock exactly this lane — and `/app-build` delegates
   streaming review to this skill, so the fix had to land here or the dead-end stays the rule.

   `verified_static` unlocks `review_requested`, `approved` and `merged`, and refuses `closed`: the
   sprint closes as *"merged, verification deferred"*, and `ship-gate.sh` blocks on any ticket still
   carrying the flag. Real progress keeps happening; nobody gets to call it green.

   On either passing outcome, `board.mjs move APP-NNN review_requested --by <owner> --detail
   "-> code-reviewer"` succeeds — status, reviewer and ledger row in one write instead of three —
   and then you spawn a `code-reviewer` Task for that branch in the next message.
   Reviewers run in parallel with each other **and** with still-running developers. Waiting for the
   slowest dev before any review starts wastes wall-clock time.

6. **Merge gate.** Only `APPROVED` PRs go to tech-manager for merge → board moves `review → qa`. `REQUEST CHANGES` re-spawns the original developer with the reviewer's notes. The review-cycle cap (2 cycles, per `/app-build` step 4) is enforced by the orchestrator — past it, surface to the user.

6a. **Escalate the model on a retry.** The first attempt runs the role's default tier (its agent
   file's `model:`). A re-spawn after `REQUEST CHANGES` runs **one tier up**, capped at the top:

   ```
   haiku → sonnet → opus → opus
   ```

   Pass the tier explicitly on the re-spawn (the subagent tool's `model` parameter, where the
   harness has one; otherwise say so in the prompt and note it in the standup). A ticket that failed
   review is by definition harder than it looked — this is the cheapest place in the loop to put
   effort where the evidence already says it is needed. A `rejected` verify-done retry is *not* an
   escalation: nothing was reviewed, so nothing said the work was hard.

7. **Journal the round.** One line, at the end of every round, after the standup:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/round-journal.mjs" append --round N \
     --tickets APP-001,APP-002 --verdicts approved=1,changes=1 \
     --spawns 4 --retries 1 --refusals 0 --wall-clock-sec 900
   ```

   The event log records what happened to **tickets**; this records what happened to the **loop**.
   Only the first was answerable before, so "is this run converging or thrashing?" had no data
   behind it. Omit `--spend-usd` when the harness cannot report token cost — the field stays `null`
   and every reader says "not measurable here" rather than printing a number nobody measured.

## Warm managers (optional — the portable default is respawn)

Where the harness supports named agents plus `SendMessage`, `tech-manager` and `tech-lead` may
**persist across a sprint** instead of being respawned cold each round: the manager keeps the
round's context, and the mid-sprint Q&A round becomes a message rather than a fresh spawn.

The condition that makes this safe, and the only one: **all durable state stays in files** — the
event log, the ledger, the board, the fragments, this journal. A warm manager is a cache, never a
source. Nothing may exist only in a warm agent's context, so the two modes are interchangeable
mid-sprint: kill a warm manager and the next cold respawn reads the same files and continues.

If the harness has no named agents, do nothing — respawn per round is the portable baseline and is
what every other step here assumes.

## Anti-patterns

- **Sequential launches when parallel is safe.** If APP-001 and APP-002 don't conflict, never launch them back-to-back in different messages.
- **Parallel launches when serial is required.** If two tickets touch the same module, serialize them — let the second pick up the first's commit.
- **Forgetting to write the result back to the board.** The event log is the only memory across
  agent invocations.
- **Editing `docs/31-board.md` to record a result.** It is generated from the log. The edit survives
  until the next append, is read by nothing, and the work it recorded disappears with it.
- **Retrying past a refusal.** Exit 1 from `board.mjs` is a rule catching something. Read the reason
  it printed and fix that, rather than reaching for the file underneath it.
- **Believing a `DONE` you didn't verify.** The branch may not exist, may carry no commits, and the
  "tests all green" line is a claim by the same agent that wrote the code.
- **Spawning against a board you didn't check.** One bad dependency edge silently strands a whole
  track, and the loop will still report the sprint complete.
- **Spawning without running `spawn-gate.sh`.** Isolation you remembered is not isolation you
  checked, and the one operator best placed to remember it is the one who has already forgotten.
- **Re-spawning after `REQUEST CHANGES` at the same tier.** The default tier is the one that just
  failed a review on this exact ticket.

## Worked example

Board ready state:
```
APP-001 todo ios-developer
APP-002 todo android-developer
APP-003 todo backend-developer
APP-004 todo ios-developer (depends on APP-001)
```

Correct launch:
```
[same message]
Agent(ios-developer, "Work APP-001, see board row + spec links ...")
Agent(android-developer, "Work APP-002 ...")
Agent(backend-developer, "Work APP-003 ...")
```

APP-004 is NOT launched until APP-001 reports DONE.

After all three return DONE:
```
[same message]
Agent(code-reviewer, "Review feat/APP-001-... for APP-001")
Agent(code-reviewer, "Review feat/APP-002-... for APP-002")
Agent(code-reviewer, "Review feat/APP-003-... for APP-003")
```

Then APP-004 launches with ios-developer, in parallel with whatever else is now ready.
