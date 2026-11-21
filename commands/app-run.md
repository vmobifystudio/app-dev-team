---
description: Mostly-autonomous end-to-end run — idea → scope-lock → sprint loop → ship-readiness, surfacing only blockers and the two human gates (scope-lock, ship)
argument-hint: [one-line idea, optional] [--yolo to skip scope-lock] [--utility for a utility-tier app]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent, Skill
disable-model-invocation: true
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
- **The board doctor gate is not skippable, including under `--yolo`.** `--yolo` skips *human*
  gates, never correctness gates. An autonomous run is exactly the situation where a silently
  stranded ticket goes unnoticed for the whole sprint.
- **"Run `/app-X`" here means read `${CLAUDE_PLUGIN_ROOT}/commands/app-X.md` and follow it** — the
  model-invocation-disabled commands (`/app-init`, `/app-ship`) are not callable as a tool.
- **No `DONE` is believed unverified.** `verify-done.sh` runs on every developer return — `--static`
  by default, which checks the branch, the commits and the changed files and states plainly that the
  suite has not run. The suite runs once per wave on the merged tree (step 4). "Verified" here never
  means "an agent said so".

## Steps

1. **Detect greenfield vs brownfield.** Using the `brownfield-onboarding` skill's detection, check
   whether the target directory already contains an app.

   Either branch writes `docs/02-team-roster.md` via the `role-activation` skill before it spawns
   anyone. **`--utility` sets the tier**; without it the tier is derived and stated at Gate 1, where
   scope is approved anyway. Everything after this step spawns from the roster and never from a list
   in this file — read it, do not re-derive it. `off` roles are not spawned; their gates report
   `N/A` with the roster's reason, never silence.
   - **Empty / no app → greenfield:** run `/app-init` with the idea (requirements-intake → CEO
     vision → parallel CPO/CTO → ux-architect/tech-lead/devops-engineer, then product-designer → project bootstrap
     incl. `CLAUDE.md` + git). `/app-init` ends with its own scope-lock gate — **this command owns
     that gate (step 2), so `/app-init` skips it here** and the user is asked once, not twice.
   - **Existing app → brownfield:** run `/app-onboard` (reverse-engineer the as-built baseline +
     `CLAUDE.md`), then `/app-audit` (grade vs the House KB → `docs/80-audit.md` → remediation
     backlog). If an idea/goal was given, treat it as the upgrade goal and add it as feature tickets
     alongside the `AUDIT-NNN` remediation tickets.

1a. **Intent validation — before Gate 1, outside the chain that wrote the docs.** On the greenfield
   path `/app-init` step 6a has already spawned `product-validator`: **reuse that result** —
   `docs/04-intent-validation.md` and its `INTENT:` line — and do not spawn it a second time. Spawn
   it here only on the brownfield path, or when `/app-init` did not run it. It compares `docs/00-founder-intent/` — the founder's
   recorded words — against `docs/10-prd.md` and the vision, writes `docs/04-intent-validation.md`,
   and returns `INTENT: ALIGNED | DRIFTED | CANNOT EVALUATE`. Then:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs" --project-root .
   node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --project-root . --only conflicts
   node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --project-root . --only gates
   ```

   The first proves the founder record has not been edited to match the plan; the others report
   every conflict resolved by precedence and every conditional founder gate that fired. The ticket
   half of the chain (criterion → ticket → test → analytics) needs a board, so on greenfield it runs
   after step 3: `trace.mjs --project-root . --only trace`, findings into the first standup.
   **All of it goes into the Gate 1 brief and none of it is resolved by an agent.** `--yolo` skips
   human gates, not this: it is the only check in the system that is not inside the loop it is
   checking. `trace.mjs` exit 2 is `CANNOT EVALUATE`, never a pass.

2. **GATE 1 — scope-lock / audit-approval (human).**
   - *Greenfield:* print a one-screen brief — vision, P0 feature list, architecture headline,
     rough effort, top risk, **plus the roster headline: tier (and whether it was flagged or
     derived), product type, and every `off` role with its reason** — and ask *"Approve scope and
     proceed to build?"* Activation is a scope decision, so it is reviewed at the gate that already
     reviews scope. **This adds no third gate**; a user who disagrees with the derived tier says so
     here, and `docs/02-team-roster.md` is rewritten before anything spawns.
   - *Brownfield:* print the audit scorecard and the remediation backlog grouped by severity and
     Safe/Risky, and ask *"Which gaps should we fix?"* Risky changes proceed only if approved here.
   Wait for the answer. With `--yolo`, skip the gate (greenfield: auto-approve scope; brownfield:
   fix all S1/S2 + Safe, defer Risky — the /app-audit --yolo mechanism: Risky stays
   `blocked needs-approval:` and is listed as DEFERRED) and log the decision.

3. **Plan.** Run `/app-plan` (tech-manager builds the parallel board via `sprint-planner`), which
   runs **non-interactively here** — scope was approved at Gate 1 and this command has no third
   gate. Ensure every P0 feature has a paired `APP-NNN-analytics` ticket, owned per the roster
   (`data-analyst` where active; otherwise the feature's IC), and that it passes `dispatch-preflight`
   for that owner like any other ticket.

   Brownfield reaches this step with a real backlog: `/app-onboard` writes `docs/11-backlog.md`
   (existing features as baseline rows) and `docs/00-vision.md`, and `/app-audit` has already put
   `AUDIT-NNN` remediation tickets on the board. `/app-plan` sequences those plus the upgrade goal;
   it does not re-propose the app that already exists.

4. **Build loop.** Run the `/app-build` loop autonomously, round after round:
   - round preconditions (`orchestrator round`: board · budget · merge truth · toolchain · CI ·
     worktree pool) → parallel ICs **spawned by each ticket's `Owner`, per `/app-build` step 2**
     (never a list named here — an out-of-date copy is how `AUDIT-NNN` tickets stopped being picked
     up) → **static** `DONE` verification → streaming `code-reviewer` (Axiom audit gate on iOS) →
     merge **gate** (run inline by this session, no `tech-manager` spawn) → **wave integration** → `qa-engineer` → bug loop.
   - The merge gate grants permission per ticket; the wave pass merges, tests and pushes once
     (`/app-build` steps 3–5, where per-ticket `--static` verification and `verified_static` are
     explained). **A wave that does not go green is a normal outcome an autonomous run survives**,
     not an escalation: re-spawn only the owners the failure names.
   - **Escalations are surfaced to the user in the round they are raised** (`/app-build` step 6).
   - After each round, the standup at `docs/daily/<today>.md` is the concatenation `/app-build`
     step 6 runs (no `tech-manager` spawn); print a 3-line summary: counts per status, what merged,
     blockers.
   - Before each `claimed` — `QA-` tickets included — run
     `${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-preflight.mjs` (`/app-build`'s top); no ticket is claimed
     until context, scheduling, capabilities, and risk routing all clear. It gates the claim, not
     every spawn: a reviewer, a gate role or a retry on an already-claimed ticket gets no new
     preflight (it would refuse a ticket in `review` or `qa`).
   - Where named-agent persistence is available, run the warm/cold manager scenario and retain its
     digest; otherwise use the portable respawn model backed by the same files.
   - **The budget ceiling stops this loop and says why** (`/app-build` step 0). An unattended run
     has no other economic brake: `round-journal.mjs check` runs at the top of every round, exit 1
     ends the run with the ceiling named and every unfinished ticket listed. Do not raise a ceiling
     to keep going — that is a decision to hand back to the user, and it is Gate-shaped.
   - **The kill switch outranks everything in this file.** An unattended run is the case the studio
     emergency stop exists for: an operator who cannot reach a keyboard writes
     `echo "reason" > .studio-stop` at the repository root (or sets `APP_TEAM_STOP`) and every spawn
     stops at the next gate. `round-journal.mjs check` and `spawn-gate.sh` both refuse while it is
     set, so it takes effect before the next agent launches, not at the end of the round. **Never
     clear it.** Report the reason it carries, list what is unfinished, and end the run. It halts
     *spawning*; agents already running are not killed, so say which ones were in flight.
   - **The conditional founder gates run every round**, because a pricing change or a waiver
     arrives mid-sprint, not at Gate 1:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --project-root . --only gates
     ```

     Exit 1 means a trigger fired — pricing · sensitive data · destructive migration · account
     deletion · legal disclosure · visual direction · paid infrastructure · **any waiver of a failed
     or unavailable gate** — and no founder decision covers it. Stop the loop and ask. The exit is
     one appended line in `docs/00-founder-intent/decisions.md`; the exit is never an agent deciding
     the trigger was fine, and `--yolo` does not clear one. Exit 2 is CANNOT EVALUATE — almost
     always a missing `docs/00-founder-intent/` (`/app-init` step 0, `/app-onboard` step 5b). It is
     not a pass: create the record before the next round rather than running rounds blind to the
     gates it exists to fire.
   - **Escalate to the user only** for: a blocker the team can't resolve (a capped review goes to
     `tech-lead`, not the user: one `reopened --by tech-lead`, then take over, re-scope or `descoped`),
     the budget ceiling, a fired founder gate, or a scope/architecture conflict. Surface
     verbatim with a proposed answer.

   - **Sprint over, backlog not.** When the board drains while P0 or approved backlog rows remain
     unplanned (including S3/S4 bugs queued "to sprint N+1"), go back to step 3 for sprint N+1 —
     journal its rounds with `--sprint N+1`. Step 5 starts only when no planned work remains.

5. **Ship-readiness.** When the board is drained and there are zero open S1/S2 bugs, spawn in
   parallel **the `active` ones among** `aso-specialist` (store assets + readiness),
   `security-reviewer` (MASVS), and `data-analyst` (instrumentation + consent verification).
   `security-reviewer` is never off, at any tier. For an `off` role, print
   `N/A: <its gate> — <role> is off(<reason>) per docs/02-team-roster.md` — an inactive role's gate
   is structurally not applicable, which is **not** a waiver and **not** a skip. A readiness agent that cannot evaluate —
   the artifact it reads was never written — reports `CANNOT EVALUATE` and goes to Gate 2 as a
   produce-or-waive decision (`/app-ship` step 1a). **Never resolve one by skipping it here:**
   `--yolo` skips human gates, not correctness gates, and this is a correctness gate.

   "Drained" means the doctor is clean **and** every non-`done`, non-`descoped` row is named with its reason.
   A board with an open anomaly is not drained, however empty the `todo` column looks.

6. **GATE 2 — ship (human).** Hand off to `/app-ship`, which summarizes readiness and hands the
   founder a signed, submission-ready build and checklist. Nothing in the studio uploads or submits:
   that action is the founder's own. `/app-ship`'s last step
   harvests the run's `LEARNING:` lines into `docs/92-learnings.md` and folds them into the House KB
   via `/app-learn` — that is where an autonomous run pays its knowledge back.

## Output

A built iOS and/or Android project matching the House KB conventions, all plan/standup docs under
`docs/`, and a final summary: what shipped, what's deferred (S3/S4), and the suggested next step.
