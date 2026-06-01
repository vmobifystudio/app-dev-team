---
name: parallel-orchestrator
description: Use to actually launch multiple developer agents in parallel via the Agent tool, given a sprint plan and board. Triggers from /app-build or when the tech-manager says "spawn the pod". Encapsulates the rules for safe concurrent agent execution.
---

# Parallel orchestrator

You launch IC agents concurrently. This skill exists because parallel agent launches need rules — without them, agents stomp each other.

## When to use

Called from `/app-build` or by the tech-manager once `docs/31-board.md` has tickets in `todo` ready to start.

## Procedure

1. **Read the board.** Find tickets where `Status = todo` and all `Depends on` IDs are `done`.

2. **Group by owner.** One agent invocation per owner, batched. iOS dev gets all their ready tickets in one prompt; same for Android; same for backend.

3. **Launch in a single message.** Use the Agent tool with multiple invocations in the same assistant message so they run concurrently. This is the critical step — sequential launches give up the parallelism we just earned.

4. **Each agent prompt** includes:
   - The ticket ID(s)
   - The board entry verbatim
   - Pointers to PRD section, impl spec, design tokens
   - The expected output contract (`DONE: APP-NNN ...` or `BLOCKED: APP-NNN ...`)
   - Reminder: do not edit specs; flag blockers and stop

5. **Stream the reviews — do not wait for the whole batch.** As each developer Task returns `DONE: APP-NNN`, update the board row to `Status = review` and spawn a `code-reviewer` Task for that branch in the next message. Reviewers run in parallel with each other **and** with still-running developers. Waiting for the slowest dev before any review starts wastes wall-clock time.

6. **Merge gate.** Only `APPROVED` PRs go to tech-manager for merge → board moves `review → qa`. `REQUEST CHANGES` re-spawns the original developer with the reviewer's notes. The review-cycle cap (2 cycles, per `/app-build` step 4) is enforced by the orchestrator — past it, surface to the user.

## Anti-patterns

- **Sequential launches when parallel is safe.** If APP-001 and APP-002 don't conflict, never launch them back-to-back in different messages.
- **Parallel launches when serial is required.** If two tickets touch the same module, serialize them — let the second pick up the first's commit.
- **Forgetting to write the result back to the board.** The board is the only memory across agent invocations.

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
