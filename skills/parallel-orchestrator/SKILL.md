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

1. **Read the board.** Find tickets where `Status = todo` and all `Depends on` IDs are `done`.

   Note what this readiness rule *cannot* express: a ticket behind a `blocked` dependency is not
   ready and never will be, but it is also never reported. That is the doctor's `stranded` check,
   and it is why step 0 exists.

2. **Group by owner.** One agent invocation per owner, batched. iOS dev gets all their ready tickets in one prompt; same for Android; same for backend.

2a. **Create one worktree per writing agent — before you spawn anything** (`agent-isolation` skill):

   ```bash
   git worktree add ../.agent-wt/APP-001 -b feat/APP-001-short-slug
   ```

   This is not optional and it is not a nicety. Measured, in a real dry run of exactly this step
   without it: a commit containing another ticket's half-written files, one agent burning ~50% of
   its budget discovering and redoing work it had already done correctly, and two branches with
   add/add conflicts on **all 8 files**. See
   `docs/research/2026-07-29-dry-run-parallel-agent-collision.md`.

   If worktrees are genuinely unavailable, **serialize the writers** — one at a time, each
   committing before the next starts — and say in the standup that you serialized and why. Never
   run parallel writers in one tree.

2b. **Check for file overlap, not just feature independence.** The sprint plan judges tickets
   independent by *feature*. Two "independent" tickets that touch the same files still produce a
   total merge conflict. Before launching a batch, list the files each ticket is likely to touch
   (from the impl spec and the ticket's own description). Any ticket pair sharing a file is
   **serialized**, not parallelised.

3. **Launch in a single message.** Use the subagent tool (`Task`/`Agent`) with multiple invocations in the same assistant message so they run concurrently. This is the critical step — sequential launches give up the parallelism we just earned.

   Each agent's prompt must name **its worktree path** as the project root — never the repo root.

4. **Each agent prompt** includes:
   - The ticket ID(s)
   - The board entry verbatim
   - Pointers to PRD section, impl spec, design tokens
   - The expected output contract (`DONE: APP-NNN ...` or `BLOCKED: APP-NNN ...`)
   - Reminder: do not edit specs; flag blockers and stop

5. **Stream the reviews — do not wait for the whole batch.** As each developer Task returns
   `DONE: APP-NNN`, **verify the claim before you act on it**:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> main "<project test command>"
   ```

   `REJECTED` → the row stays where it is; re-spawn that developer with the blocking lines. Only on
   `VERIFIED` do you update the board row to `Status = review`, set `Reviewer`, append the
   `requested` ledger line, and spawn a `code-reviewer` Task for that branch in the next message.
   Reviewers run in parallel with each other **and** with still-running developers. Waiting for the
   slowest dev before any review starts wastes wall-clock time.

6. **Merge gate.** Only `APPROVED` PRs go to tech-manager for merge → board moves `review → qa`. `REQUEST CHANGES` re-spawns the original developer with the reviewer's notes. The review-cycle cap (2 cycles, per `/app-build` step 4) is enforced by the orchestrator — past it, surface to the user.

## Anti-patterns

- **Sequential launches when parallel is safe.** If APP-001 and APP-002 don't conflict, never launch them back-to-back in different messages.
- **Parallel launches when serial is required.** If two tickets touch the same module, serialize them — let the second pick up the first's commit.
- **Forgetting to write the result back to the board.** The board is the only memory across agent invocations.
- **Believing a `DONE` you didn't verify.** The branch may not exist, may carry no commits, and the
  "tests all green" line is a claim by the same agent that wrote the code.
- **Spawning against a board you didn't check.** One bad dependency edge silently strands a whole
  track, and the loop will still report the sprint complete.

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
