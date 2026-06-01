---
description: Mostly-autonomous end-to-end run — idea → scope-lock → sprint loop → ship-readiness, surfacing only blockers and the two human gates (scope-lock, ship)
argument-hint: [one-line idea, optional] [--yolo to skip scope-lock] [--utility for a utility-tier app]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Agent
---

# /app-run — Drive the whole build, mostly on its own

Idea / flags: $ARGUMENTS

This is the autonomous driver. It chains init → plan → build → standup → loop until the sprint is
done or a true blocker hits. **Only two things stop for the user: scope-lock and ship.** Everything
else streams as standup reports. Wrap this command in `/loop` for fully self-paced execution.

## Operating rules

- The team **never invents intent.** When a requirement is genuinely ambiguous, write the blocker
  to the standup and surface it verbatim — do not guess.
- All build agents invoke the `house-conventions` skill before working (House KB = `knowledge/`).
- Honor the existing safety rails: 2-cycle review cap, no auto-merge across `REQUEST CHANGES`,
  one agent per ticket at a time, no destructive data actions.

## Steps

1. **Init.** Run `/app-init` with the idea (requirements-intake → CEO vision → parallel CPO/CTO →
   parallel ux-designer/tech-lead/devops-engineer → project bootstrap incl. `CLAUDE.md` + git).

2. **GATE 1 — scope-lock (human).** Print a one-screen brief: vision, the P0 feature list from the
   PRD, the architecture headline (platforms + stack), the rough effort, and the top risk. Ask:
   *"Approve scope and proceed to build?"* Wait for approval.
   - With `--yolo`, skip this gate and log that scope was auto-approved.

3. **Plan.** Run `/app-plan` (tech-manager builds the parallel board via `sprint-planner`). Ensure
   every P0 feature has a paired `APP-NNN-analytics` ticket (data-analyst schema feeds this).

4. **Build loop.** Run the `/app-build` loop autonomously, round after round:
   - parallel devs (`ios-developer`, `android-developer`, `monetization-engineer`,
     `backend-developer` if in scope) → streaming `code-reviewer` (Axiom audit gate on iOS) →
     `tech-manager` merge gate → `qa-engineer` → bug loop.
   - After each round, spawn `tech-manager` to write `docs/daily/standup-<today>.md` and print a
     3-line standup: counts per status, what merged, blockers.
   - **Escalate to the user only** for: a blocker the team can't resolve, the 2-cycle review cap
     being hit, or a scope/architecture conflict. Surface verbatim with a proposed answer.

5. **Ship-readiness.** When the board is drained and there are zero open S1/S2 bugs, spawn in
   parallel: `aso-specialist` (store assets + readiness), `security-reviewer` (MASVS), and
   `data-analyst` (instrumentation + consent verification).

6. **GATE 2 — ship (human).** Hand off to `/app-ship`, which summarizes readiness and asks for
   explicit confirmation before any store upload. Never upload without it.

## Output

A built iOS and/or Android project matching the House KB conventions, all plan/standup docs under
`docs/`, and a final summary: what shipped, what's deferred (S3/S4), and the suggested next step.
