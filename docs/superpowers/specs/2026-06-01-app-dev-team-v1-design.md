# app-dev-team v1.0 — Design Spec

**Date:** 2026-06-01
**Status:** Approved for planning
**Owner:** Amol (Mobify Studio)

## 1. Purpose

Upgrade the existing `app-dev-team` Claude Code plugin (v0.1.0) into a best-in-class,
dependency-free **autonomous mobile-app development team**. You give it a one-line app
idea; a structured, hierarchical team of agents takes it from scope through a shipped
iOS/Android app, working in parallel, reviewing and fixing their own work, reporting via
daily standups, and escalating to you only at two gates: **scope-lock** and **ship**.

The plugin must:
- Run "mostly autonomous" — end-to-end through a sprint, surfacing only true blockers and
  ship decisions.
- Leverage the user's already-installed skill ecosystem (~150 Axiom iOS skills, `ui-design`
  Android/Material skills, `aso-screenshots`, `admob-android-integration`, `ui-ux-pro-max`)
  as the team's hands — not re-implement that knowledge.
- Encode Mobify Studio's real house conventions, mined from 7 shipped apps, into a living
  knowledge base that every agent reads before working.
- Stay dependency-free (native Claude Code subagents + commands + skills + docs-as-memory).
  No external MCP is required to operate.

## 2. Non-goals

- No dependency on the `ruflo` swarm MCP or any external orchestration service.
- No "turn it on and walk away with zero oversight" — scope-lock and ship remain human gates.
- No localization QA agent in v1 (strings are keyed from day one; review deferred).
- No CI-enforced performance budgets in v1 (budgets are documented, not gated in CI).

## 3. Existing foundation (kept)

v0.1.0 already provides, and we keep:
- **Hierarchy + docs-as-shared-memory** operating model.
- 13 agents: `ceo`, `cpo`, `cto`, `tech-lead`, `tech-manager`, `ios-developer`,
  `android-developer`, `backend-developer`, `code-reviewer`, `qa-engineer`, `ux-designer`,
  `security-reviewer`, `release-manager`.
- 7 commands: `/app-init`, `/app-plan`, `/app-build`, `/app-review`, `/app-status`,
  `/app-ship`, `/app-team`.
- 5 skills: `requirements-intake`, `prd-builder`, `architecture-builder`, `sprint-planner`,
  `parallel-orchestrator`.
- The `/app-build` loop: parallel devs → streaming code review → 2-cycle review cap →
  merge gate → QA bug loop → daily report.

## 4. The four gaps v1.0 closes

1. **Skill leverage** — agents don't currently route through the installed Axiom/UI/ASO
   skills. v1 wires every IC agent to the right skills and audit agents.
2. **No house learnings** — nothing mines the 7 shipped apps. v1 adds a living KB.
3. **Thin autonomy** — handoffs are command-triggered and doc-based with no continuous
   loop. v1 adds an autonomous driver + standup loop.
4. **Missing go-to-market roles** — ASO, DevOps/git, monetization, analytics are not
   first-class. v1 adds four roles.

## 5. Roster (17 agents)

Existing 13, plus:

| Agent | Layer | Owns | Primary skills it wields |
|---|---|---|---|
| `aso-specialist` | Growth | Store listing, keywords, screenshots, metadata | `aso-screenshots`, `axiom-app-store-submission` |
| `devops-engineer` | Platform | Git strategy, branch model, CI, signing, fastlane, conventions | `axiom-ios-build`, fastlane patterns |
| `monetization-engineer` | Growth | AdMob + StoreKit/IAP integration, revenue config | `admob-android-integration`, `axiom-in-app-purchases` |
| `data-analyst` | Growth | Analytics events, KPI dashboards, post-launch metric review for CEO | — (reads house `analytics` pack) |

## 6. Skill wiring (the team's hands)

Each IC agent's `.md` gains a "Skills you must use" section instructing it to invoke the
relevant skills *before* writing code, and the reviewers to run audits as gates.

- `ios-developer` → `axiom-ios-ui`, `axiom-ios-concurrency`, `axiom-ios-data`,
  `axiom-ios-build`, `axiom-swiftui-26-ref`, `axiom-ios-integration` as the task demands.
- `code-reviewer` (iOS branch) → spawns relevant Axiom auditor **agents**
  (`concurrency-auditor`, `memory-auditor`, `security-privacy-scanner`, `swiftdata-auditor`,
  `accessibility-auditor`, `swiftui-performance-analyzer`) as the merge gate.
- `android-developer` → `ui-design:mobile-android-design` (Material 3 / Compose),
  plus `admob-android-integration` when ads are in scope.
- `ux-designer` → `ui-ux-pro-max`, `ui-design` skills; Figma MCP optional if present.
- `release-manager` → `axiom-shipping`, `axiom-app-store-submission`.
- `aso-specialist` → `aso-screenshots`.
- `security-reviewer` → `axiom-security-privacy-scanner`.
- `monetization-engineer` → `admob-android-integration`, `axiom-in-app-purchases`.

Wiring is written as soft routing ("if iOS and the task involves X, use skill Y"), never a
hard dependency — if a skill is absent the agent degrades to best-practice defaults.

## 7. Autonomy model — `/app-run`

New driver command `/app-run [idea]`:

1. `requirements-intake` → CEO vision → parallel CPO(PRD)/CTO(architecture) →
   parallel ux-designer/tech-lead/devops-engineer(git strategy).
2. **GATE 1 — scope-lock.** Print vision + PRD summary + architecture headline + cost/effort
   note; wait for user approval. (Skippable with `--yolo` for fully hands-off.)
3. tech-manager builds the board (`sprint-planner`).
4. Run the `/app-build` loop autonomously: parallel devs → streaming review (Axiom audit
   gate) → merge → QA → bug loop, until the board is drained.
5. After each round, tech-manager writes `docs/daily/standup-YYYY-MM-DD.md` and escalates
   **only** blockers and ship-readiness to the user.
6. When the board is clean and zero S1/S2 bugs remain: aso-specialist prepares store assets,
   security-reviewer runs MASVS, data-analyst confirms analytics wiring.
7. **GATE 2 — ship.** `/app-ship` summarizes readiness and asks for explicit confirmation
   before any store upload.

`/app-run` is wrappable in `/loop` for self-paced hands-off execution. Existing granular
commands (`/app-init`, `/app-plan`, `/app-build`, …) remain for manual control.

Escalation rule (unchanged in spirit, made explicit): the team never invents an answer when
intent is unclear — it writes the blocker to the standup and surfaces it verbatim.

## 8. House Knowledge Base (living, auto-updated)

New `knowledge/` directory in the plugin + new `house-conventions` skill + `/app-learn`
command.

- `/app-learn [paths...]` mines source apps' `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`,
  and build files into structured packs:
  - `knowledge/ios-conventions.md`
  - `knowledge/android-conventions.md`
  - `knowledge/stack-defaults.md` (default versions, libraries, min targets)
  - `knowledge/monetization.md` (AdMob + IAP patterns the studio uses)
  - `knowledge/aso.md` (screenshot/keyword/listing patterns)
  - `knowledge/git-workflow.md` (branch model, commit/PR conventions)
  - `knowledge/analytics.md` (standard events, KPIs)
- Initial mine targets the 7 apps in `~/Documents/Mobify Studio Apps` (6 have `CLAUDE.md`;
  LifeOS also has `docs/ARCHITECTURE.md`).
- `house-conventions` skill: agents invoke it to load the relevant pack(s) before working,
  so output matches the studio's established style.
- **Living/auto-updated:** at the end of `/app-ship` (or via `/app-learn --from <new app>`),
  the team folds net-new learnings from the just-shipped app back into the packs, with a diff
  summary printed for the user. Conflicting conventions are flagged, never silently
  overwritten.

## 9. Per-project bootstrap (CLAUDE.md + git + conventions)

`/app-init` (and step 1 of `/app-run`) additionally generates, in the target project,
seeded from the house KB:
- `CLAUDE.md` (project conventions, stack, build/run commands, the team's working rules)
- `.gitignore` for the chosen platform(s)
- Git branch model + commit/PR conventions doc (`docs/23-git-strategy.md`)
- A `docs/15-aso.md` stub and `docs/41-monetization.md` stub when those are in scope.

## 10. Document layout (additions to v0.1)

Adds to the existing `docs/` set the team creates in the user's project:
```
docs/
  15-aso.md
  23-git-strategy.md
  41-monetization.md
  52-analytics.md
  daily/standup-YYYY-MM-DD.md
```
Plugin-internal additions:
```
knowledge/*.md            (house KB packs)
skills/house-conventions/SKILL.md
agents/{aso-specialist,devops-engineer,monetization-engineer,data-analyst}.md
commands/{app-run,app-learn}.md
```

## 11. Quality gates

- **Per-platform Definition of Done** (in engineering-principles): builds clean, tests pass,
  no force-unwraps (iOS), lint clean (Android), strings keyed, accessibility floor met.
- **Merge gate:** code-reviewer APPROVED + relevant Axiom audits clean (or waived in writing).
- **Ship gate:** clean board, zero open S1/S2, clean security pass, ASO assets ready,
  analytics verified, explicit user confirmation.

## 12. Risks & mitigations

1. **Skill drift** — a referenced skill is renamed/removed. *Mitigation:* soft routing +
   best-practice fallback; no hard dependency.
2. **KB conflict** — two source apps disagree on a convention. *Mitigation:* `/app-learn`
   flags conflicts for human resolution; never auto-overwrites.
3. **Runaway autonomy** — loop spins on an ambiguous ticket. *Mitigation:* 2-cycle review
   cap (kept), blocker-surfacing rule, scope-lock + ship gates.
4. **Token cost of full autonomous runs** — *Mitigation:* batched parallel launches,
   standup summaries instead of raw transcripts, `/app-status` for cheap inspection.

## 13. Success criteria

- `/app-run "<idea>"` produces, with only scope-lock + ship interaction, a building
  iOS and/or Android project whose conventions visibly match the house KB.
- Every IC agent demonstrably invokes the correct installed skill for its task.
- The KB is generated from the real 7 apps and is re-mineable after each ship.
- The plugin installs and runs with zero external MCP dependencies.
