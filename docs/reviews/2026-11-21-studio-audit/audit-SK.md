SK-1 [High] `product-researcher` has no spawn point before the PRD, and the PRD author never reads its output
**Where:** skills/role-activation/SKILL.md:72,110 (charter: evidence that must not inherit the CPO's framing); commands/app-init.md:41-66 (no init step names the role); commands/app-build.md:169,224 (its only spawn point is as the owner of a sprint ticket); agents/cpo.md, skills/prd-builder/SKILL.md (no mention of `16-research`); agents/product-manager.md:24 (the only reader).
**What happens:** I walked app-init steps 0–7. The order is intake, roster, ceo, cpo‖cto, ceo again, ux‖tech-lead‖devops, designer, validator, Gate 1. No step spawns the researcher, even when its roster row is `active`. The only path that runs it is a ticket owned by it, which can exist only after `/app-plan` and so after scope-lock. Then `docs/16-research.md` is read only by product-manager, never by cpo or prd-builder.
**Why it matters:** the one role whose job is to test the PRD's market assumptions runs after the PRD is locked, or never. Greenfield flagship work is exactly where its trigger fires. Today it is ~80 lines of role file plus a skill tree that cannot change the outcome.
**Fix:** either (a) add an app-init step 2b that spawns `product-researcher` when it is active, between ceo and cpo, and add `docs/16-research.md` to cpo.md and prd-builder inputs, or (b) delete the role and leave the evidence check to `product-validator` and Gate 1. I recommend (a) for flagship only.

SK-2 [Medium] `conditional` roles never become active at ship time, and nothing reports them as skipped
**Where:** commands/app-init.md:41 ("Every fan-out below spawns only `active` roles"); commands/app-ship.md:277-283 (spawns `active` roles; prints `N/A` only for `off`); skills/role-activation/SKILL.md:129-130 and references/variants-and-staffing.md:82 ("flips to active the moment its trigger is met" — no command does the flip).
**What happens:** the roster is written at init step 1a, before architecture and PRD exist. Triggers that depend on later facts stay `conditional`: reliability-engineer ("syncs, works offline, holds user-created data"), red-team-agent, test-automation-engineer. `/app-build:175` flips only ticket-owned roles. `/app-ship` step 2 neither spawns a `conditional` row nor prints it. I grepped all commands: none re-evaluates triggers.
**Why it matters:** a flagship sync app can ship without the reliability review, and the release record does not show that the review was missing. The skill's own headline rule is "A deactivated role is recorded, never silently absent" (role-activation:21), and this breaks it.
**Fix:** add app-ship step 1b: for every `conditional` row, evaluate its trigger against the PRD and architecture, amend the row to `active` or `off(<reason>)`, then fan out. Five lines.

SK-3 [Medium] The stated reason for `release-auditor` is false, so utility pays for a third ship-time verifier
**Where:** skills/role-activation/SKILL.md:94-95,132,186; agents/release-auditor.md:11-13; agents/release-manager.md (description: "You never upload or submit to a store"); commands/app-ship.md:338-357.
**What happens:** role-activation:95 tags release-manager as `authority` because it "executes the one irreversible action (the actual upload)". app-ship:357 says "nobody here uploads or submits anything". The founder performs the irreversible action. release-auditor runs on opus after `orchestrator.mjs ship` has already exited 0 (app-ship:333). It also runs after verification-engineer, whose charter (certify claims nobody executed) covers the auditor's "unverified claim" rule.
**Why it matters:** the separation-of-duties rationale that makes it "never tier-gated" does not hold. That leaves one opus pass per release on every utility app, re-reading artifacts that a script and the verification engineer already checked.
**Fix:** correct role-activation:95 (release-manager assembles; the founder uploads). Make release-auditor flagship-only, with utility `off(merged-into: verification-engineer ship pass)`, and add its "release-manager is only witness → unverified" rule to VE's ship checklist.

SK-4 [Medium] The utility roster still staffs about 16 roles, and two of its tier deltas never change anything
**Where:** skills/role-activation/SKILL.md:104-135, 158-186; agents/ceo.md:38 (the vision always sets numeric `[O-NNN]` targets); commands/app-init.md:16 (step 0 always writes `docs/00-founder-intent/`).
**What happens:** for a utility `ios-app`, these are active: ceo, tech-lead, tech-manager, ux-architect, product-designer, ios-developer, aso, devops, product-validator, data-analyst, qa, code-reviewer, security, verification-engineer, release-auditor, release-manager. Product-designer is conditional on "more than one non-trivial screen", which is almost always true. Delta 5 (data-analyst on a KPI target) is always met because ceo.md:38 requires numeric targets. Delta 6 (product-validator on a founder-intent record) is always met because step 0 always writes one. So both "conditional" deltas behave as `on`.
**Why it matters:** each extra role costs a spawn, a role file, mandatory skills and KB packs. spawn-prompt.mjs:94-99 measures about 4–8k words before any work. On a 3-screen app most of these are handoffs that do not change the outcome.
**Fix:** use the leaner rosters below. Make the two no-op deltas honest: data-analyst on "telemetry SDK in architecture"; product-validator stays on and its delta is deleted.

SK-5 [Medium] `growth-analysis` and `support-mining` are dead skills
**Where:** skills/growth-analysis/SKILL.md:3 and skills/support-mining/SKILL.md:3 ("use post-launch"); invoked only from agents/data-analyst.md:14,17 and agents/product-researcher.md:17-18; commands/app-learn.md mines conventions only, with no data-analyst.
**What happens:** I grepped all 27 commands for post-launch. The only hit is commands/app-team.md:49, which is a listing. No command spawns data-analyst after launch. Their other caller is the researcher, which is never spawned (SK-1).
**Why it matters:** about 100 lines of guidance with no path to execution. They also make the agent descriptions claim post-launch KPI reporting the studio cannot do.
**Fix:** delete both, and remove "post-launch" from the data-analyst description and app-team.md:49. Re-add them when a post-launch command exists.

SK-6 [Medium] 8 of 27 commands are thin wrappers that no flow invokes
**Where:** commands/app-eval.md, app-impact.md, app-manager-failover.md, app-manager-harness.md (scripts called by no command or agent: eval-lab, impact-map, manager-failover, manager-harness); app-capabilities.md, app-context.md, app-risk.md, app-schedule.md (all already run by `dispatch-preflight.mjs`, commands/app-build.md:22-32); app-run-status.md (repeats app-recover.md:23-37).
**What happens:** each is 18–36 lines and is referenced only in README.md:497-507 and docs/HANDBOOK.md. app-manager-harness and app-eval test the plugin itself, not a user app.
**Why it matters:** 9 extra slash commands (8 wrappers plus app-run-status) and skill-list entries for something meant to run autonomously. A founder sees `/app-manager-harness` next to `/app-ship`.
**Fix:** delete all 9 command files and keep the scripts. Add one README line for script-level diagnostics (`node scripts/<x>.mjs --help`).

SK-7 [Medium] `database-migration` is not routed to the ICs or to the reviewer of on-device schema
**Where:** skills/database-migration/SKILL.md:3 ("Used by backend-developer, web-developer and reliability-engineer"); agents/ios-developer.md:26 (external optional `axiom:axiom-ios-data` only); agents/android-developer.md:21 (one line of KB text); agents/code-reviewer.md:52-59 (skill not in its trigger list).
**What happens:** the skill's opening line says a migration "cannot be rolled back by reverting the commit", and its body already points at the axiom SwiftData and GRDB skills. But no mobile IC and no reviewer is told to load it. If axiom is not installed, Room/SwiftData schema changes go to code review with no migration procedure at all.
**Why it matters:** an on-device schema migration is the most expensive data-loss class for a mobile app.
**Fix:** add a line to ios-developer.md, android-developer.md and code-reviewer.md: "`database-migration` — any persisted model/schema change". Widen the skill description to match.

SK-8 [Low] `chief-of-staff` has no realistic way to become active, and the CEO already does its job
**Where:** skills/role-activation/SKILL.md:70,108; commands/app-status.md:117-140 (its only spawn); agents/chief-of-staff.md:3 ("only worth running if it removes more decisions than it creates").
**What happens:** the trigger is "flagship and more than one project or more than five open decisions". At init there are none, and nothing re-evaluates it (SK-2). If it ever does become active, it writes `docs/17-founder-inbox.md`, which only `/app-status` reads.
**Fix:** delete the agent, its matrix rows, app-status step 5b, and the inbox. `/app-portfolio` and Gate 1 are the founder interface.

SK-9 [Low] On utility, tech-lead is told to write the architecture without the skill that defines its shape
**Where:** agents/tech-lead.md:66-73 versus agents/ceo.md:50-58.
**What happens:** the utility ceo is told to use `prd-builder`. The utility tech-lead is told to write `20-architecture.md` "to cto's spec (see agents/cto.md)". That means reading a 121-line role file and skipping `architecture-builder`, which team-doctor.mjs:581 registers as the writer of that doc.
**Fix:** replace "see agents/cto.md" with "invoke `architecture-builder`".

SK-10 [Low] Four small skills overlap others and should merge
**Where:** skills/policy-checker (25 lines, one caller: code-reviewer.md:58); skills/interaction-motion (one caller: product-designer.md:17, and motion values are tokens in design-system); skills/process-tiering (its own §"Guidance, not a gate"; code-reviewer.md:12-20 keeps a copy of the table "kept in step" by hand); skills/git-pr-strategy (opens with "Read knowledge/git-workflow.md and agent-isolation first" and then restates both).
**Fix:**
- policy-checker: fold into code-reviewer as one line ("run `policy-check.mjs`; BLOCKED / CANNOT EVALUATE / WAIVED").
- interaction-motion: merge into design-system as a §Motion section.
- process-tiering: move the table into sprint-planner and tech-lead, and drop it from tech-lead's mandatory load (spawn-prompt.mjs:137).
- git-pr-strategy: move its §6 conflict rule into knowledge/git-workflow.md and delete the skill. Update the callers in wave-integrate.mjs:46,333 and app-build.md:387.

SK-11 [Low] The installed plugin is stale against the repo
**Where:** the agent types available in this session, compared with agents/*.md frontmatter.
**What happens:** the installed `app-dev-team:tech-manager` description still says "Spawns parallel dev agents and the code-reviewer", while the repo's agents/tech-manager.md:3 says "Does not spawn agents". The installed ceo, cpo and cto have the Task tool; the repo versions do not.
**Fix:** reinstall before the real run (already on the RESUME next-step list). Note it in this audit's preconditions.

### Verdict table

**Roles (30)**

| Role | Spawned by | Output consumed by | Verdict |
|---|---|---|---|
| ceo | app-init:45,53 | cpo, cto, validator, aso | keep |
| cpo / cto | app-init:49 | everyone downstream | keep (flagship) |
| chief-of-staff | app-status:117 only | app-status only | **delete** (SK-8) |
| product-manager | ticket owner (app-build:169) | sprint tickets | keep (flagship) |
| product-researcher | ticket owner only | product-manager only | **fix placement or delete** (SK-1) |
| product-validator | app-init:216 | Gate 1 | keep (independence) |
| tech-lead | app-init:59, app-plan, build Q&A | ICs | keep |
| tech-manager | app-plan, app-audit:85 | board, ICs | keep (flagship); **merge into tech-lead on utility** |
| ux-architect | app-init:59 | designer, ICs, QA | keep |
| product-designer | app-init:60 | ICs (13/14 docs) | keep (flagship); **merge into ux-architect on utility unless custom components** |
| ios / android / backend / web developer | ticket owner | review | keep |
| monetization-engineer | ticket owner | privacy, review | keep (conditional) |
| aso-specialist | app-ship:278 | release-manager, privacy scan | keep |
| data-analyst | app-plan:117, app-ship:279 | backend, privacy | keep; fix trigger (SK-4) |
| devops-engineer | app-init:59 | board, worktree, ci scripts (23-git-strategy) | keep; **utility: candidate to fold into tech-lead plus team-bootstrap** (largest role load, ~2.9k words; verify the bootstrap covers CI) |
| qa / code-reviewer / security / verification-engineer | app-build, app-ship | gates | keep |
| privacy-reviewer | app-ship:277 | gate | keep (already a mode on utility) |
| test-automation-engineer | ticket owner | QA | keep (flagship, conditional) |
| reliability-engineer / red-team-agent | app-ship:278, if active | gate | keep; fix the flip (SK-2) |
| release-manager | app-ship | founder checklist | keep; fix rationale (SK-3) |
| release-auditor | app-ship:338 | gate | **flagship only** (SK-3) |
| incident-commander | app-incident:22 | incident ledger | keep (off between incidents, cheap) |

**Skills (32)**

| Skill | Used by | Verdict |
|---|---|---|
| house-conventions, team-protocol, agent-isolation, ic-workflow, board-doctor, defect-hunting | 7–29 agents, mandatory in spawn-prompt | keep |
| context-preflight, runtime-gate, mutation-testing, accessibility-gate | mandatory for their roles (spawn-prompt:131-141) | keep |
| role-activation, requirements-intake, brownfield-onboarding, parallel-orchestrator, sprint-planner | commands | keep |
| prd-builder, intent-trace, spec-critic, design-system, content-design, localisation, performance-review, dependency-policy, business-model | 2–4 roles each | keep |
| architecture-builder | cto | keep; add to utility tech-lead (SK-9) |
| database-migration | backend, web, reliability | keep; widen to mobile ICs and reviewer (SK-7) |
| interaction-motion | product-designer | **merge → design-system** |
| policy-checker | code-reviewer | **merge → code-reviewer** |
| process-tiering | tech-lead (mandatory), sprint-planner | **merge → sprint-planner and tech-lead** |
| git-pr-strategy | devops, tech-manager, code-reviewer, wave-integrate | **merge → knowledge/git-workflow.md** |
| growth-analysis, support-mining | no command path | **delete** (SK-5) |

**Commands (27):** keep 18. Delete the 9 wrappers in SK-6: app-eval, app-impact, app-manager-failover, app-manager-harness, app-capabilities, app-context, app-risk, app-schedule, app-run-status.

### Leaner default teams

- **Utility, about 10 roles:**
  - ceo (founder pass)
  - tech-lead (architecture, specs and sprint plan via `sprint-planner`)
  - ux-architect (flows and tokens; designer only for custom components)
  - platform IC(s)
  - code-reviewer (with design-QA mode)
  - qa-engineer
  - security-reviewer (with privacy mode)
  - verification-engineer (also covers the release audit)
  - release-manager
  - aso-specialist
  - product-validator
  - Add only on trigger: monetization-engineer, backend-developer, data-analyst.
- **Flagship:** the current matrix, minus chief-of-staff. The researcher moves before cpo (SK-1). Conditional triggers are re-evaluated at ship (SK-2).

### Top 3 blockers to an autonomous end-to-end ship
1. SK-2: conditional reliability and red-team reviews are silently skipped at ship.
2. SK-1: research runs after scope-lock, or never.
3. SK-4/SK-3: the utility roster is about 60% larger than it needs to be.

### Checked and genuinely fine
- Frontmatter: all 30 agents and 32 skills have valid frontmatter. Names match their files and directories, every agent sets a model and tools, and descriptions run 141–493 characters.
- Every `/app-*` command named in README, docs, agents and skills exists. The near-misses (`app-release`, `app-debug`) are Android build artifact filenames.
- No references point at missing skill or agent files; the hits are historical plan docs and optional external skills.
- Nested spawning by reviewer roles is already settled (docs/reviews/2026-11-18-expert-review.md:11).
- Every role has a written reason in role-activation:64-96, and the merged charters on utility (ceo+cpo, tech-lead+cto, security+privacy) are wired in both the role files and app-init.
