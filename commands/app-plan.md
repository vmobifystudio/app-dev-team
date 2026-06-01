---
description: Plan the next sprint — tech-manager turns backlog + impl specs into a parallelizable board
argument-hint: [sprint number or feature focus, optional]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# /app-plan — Plan the next sprint

Focus (optional): $ARGUMENTS

## Steps

1. **Confirm prerequisites exist**: `docs/11-backlog.md`, `docs/22-impl-spec-ios.md`, `docs/22-impl-spec-android.md`. If any are missing, stop and suggest `/app-init`.

2. **Spawn the `tech-manager` agent** with the `sprint-planner` skill. It produces `docs/30-sprint-plan.md` and `docs/31-board.md`.

3. **Print the sprint goal, the per-track assignment, and dependency edges.** Show what's parallel and what's serial.

4. **Ask the user**: "ready to launch the pod with `/app-build`?" — do not auto-launch.
