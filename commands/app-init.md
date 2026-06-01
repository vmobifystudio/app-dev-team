---
description: Start a new mobile app project — runs requirements intake, then CEO vision, then PRD + architecture in parallel
argument-hint: [one-line idea, optional]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-init — Kick off a new app project

You are starting a fresh app project. The user's one-liner (if any) is:

> $ARGUMENTS

## Steps

1. **Run the `requirements-intake` skill** to get a clean `docs/01-intake.md`. If the user's prompt is already detailed, ask only the questions still unanswered.

2. **Spawn the `ceo` agent** with the intake as input. CEO writes `docs/00-vision.md`.

3. **Spawn `cpo` and `cto` in parallel** in a single message — they both read `docs/00-vision.md` and produce their respective docs (PRD/backlog and architecture/principles).

4. **Spawn `ux-designer`, `tech-lead`, and `devops-engineer` in parallel** in a single message:
   - `ux-designer` reads PRD, writes flows + tokens + components docs.
   - `tech-lead` reads architecture + PRD, writes per-platform impl specs.
   - `devops-engineer` reads architecture, writes `docs/23-git-strategy.md`, a platform
     `.gitignore`, and the CI workflow — seeded from the House KB `git-workflow.md`.

5. **Bootstrap the project.** Generate, seeded from the House Knowledge Base (`knowledge/`) and the
   docs just produced:
   - the target project's **`CLAUDE.md`** — chosen stack, build/run commands, the team's working
     rules, the picked commit convention, and canonical names (so agents never guess);
   - stubs `docs/15-aso.md`, `docs/41-monetization.md`, `docs/52-analytics.md` when those concerns
     are in scope per the architecture.

6. **Print a summary**: list every doc produced, with one-line description each, and the suggested
   next command (`/app-run` for the mostly-autonomous flow, or `/app-plan` → `/app-build` for manual control).

## Output contract

After this command, the workspace contains:

```
CLAUDE.md                    (project conventions, seeded from the House KB)
.gitignore
docs/
  00-vision.md
  01-intake.md
  10-prd.md
  11-backlog.md
  12-flows.md
  13-design-tokens.md
  14-components.md
  15-aso.md                  (if store work in scope)
  20-architecture.md
  21-engineering-principles.md
  22-impl-spec-ios.md
  22-impl-spec-android.md
  22-impl-spec-backend.md    (if backend in scope)
  23-git-strategy.md
  41-monetization.md         (if monetized)
  52-analytics.md
```

If anything is missing, name it explicitly in the summary with a reason.
