# Global Plugin Enhancement Plan

**Date:** 2026-08-03  
**Status:** Proposed implementation plan  
**Scope:** App Dev Team plugin architecture, orchestration, governance, evidence, release readiness, and control-room behavior  
**Evidence source:** End-to-end Blood Pressure Journal dry run, earlier small-app dry runs, current plugin implementation, handbook, test suite, and adversarial architecture review

## 1. Executive summary

The plugin has a strong governance foundation and is materially beyond a prompt collection. It already provides explicit roles, event-sourced ticket state, semantic review gates, durable run support, approval binding, founder escalation, worktree guidance, fail-closed release checks, and broad regression coverage.

The dry run exposed the next architectural threshold: the plugin can describe and inspect a professional software-delivery process, but several critical transitions still depend on an agent correctly interpreting Markdown instructions. The path to a production-grade AI development team is therefore not adding more roles or more prose. It is turning the existing process into an executable, observable, candidate-bound workflow.

The highest-value changes are:

1. Introduce an executable workflow engine that owns state transitions and recovery.
2. Unify ticket scheduling, dispatch, run identity, leases, and completion.
3. Bind every gate and evidence item to an immutable release candidate.
4. Add a machine-readable project and toolchain profile.
5. Replace app-liveness runtime checks with declarative user-journey verification.
6. Add a dedicated submission-readiness view to the control room.
7. Expand tickets into complete work contracts with evidence and reviewer requirements.
8. Enforce capabilities and changed-file boundaries at execution time.
9. Deepen dependency, policy, legal, privacy, and compatibility verification.
10. Make evaluations, metadata, and handbook current-state claims self-checking.

The plugin must continue to stop at **submission ready**. Android and iOS publishing, store upload, final declarations, pricing, phased rollout, and submission remain human-founder actions.

## 2. Product boundary

### 2.1 Core responsibility

The plugin should take a product from founder intent to a complete, reviewable, tested, policy-checked, upload-ready application package. It should produce:

- product strategy and scoped requirements;
- PRD, SRS, architecture, UX specifications, user stories, and acceptance criteria;
- planned and assigned work with dependencies;
- reviewed implementation;
- reproducible test and quality evidence;
- privacy, security, accessibility, legal, dependency, and store-policy evidence;
- signed or signing-ready release artifacts, according to founder-controlled credential policy;
- store metadata and submission assets;
- a precise list of unresolved founder actions and blockers;
- a control-room view of readiness, uncertainty, stale evidence, and ownership.

### 2.2 Explicit non-responsibility

The plugin must never automatically:

- upload an AAB or APK to Google Play Console;
- upload an IPA or archive to App Store Connect;
- submit an app for review;
- accept legal agreements for the founder;
- provide final privacy, export-compliance, content-rights, or age-rating declarations as the founder;
- choose pricing, production rollout, release timing, or regional availability without founder approval;
- publish or promote a production release.

This boundary is already correctly expressed in `commands/app-ship.md` and must remain invariant.

## 3. Current-state assessment

### 3.1 What is already strong

- The board is event-sourced and preserves history instead of silently mutating a task list.
- Review gates use semantic roles, reducing self-review and role confusion.
- Approval binding protects against using an approval for changed content.
- Run-ledger locking provides a credible basis for durable execution.
- Gates distinguish pass, block, and cannot-evaluate states.
- Founder intent and escalation are first-class concepts.
- Shared-tree destructive Git operations are guarded.
- The core scripts use Node standard-library and shell tooling, keeping installation friction low.
- `app-init` does not enable controls before their prerequisites exist.
- The release workflow explicitly stops before store submission.
- The regression suite is broad: the latest sandbox-independent run passed 920 tests with no failures.

### 3.2 Central architectural weakness

The principal workflow is still interpreted from long Markdown command files, especially `commands/app-build.md`. Individual checks are executable, but the sequencing, retry behavior, ownership handoff, and recovery contract are not governed by one authoritative state machine.

This creates predictable real-world risks:

- agents may skip or reorder steps;
- two agents may treat the same ticket as ready;
- an interrupted run may leave ticket and run state inconsistent;
- evidence may describe an older commit or variant;
- the dashboard may show a green historical result for a changed candidate;
- runtime checks may prove only that a process exists, not that the intended product works.

## 4. Target operating model

The desired architecture is:

```text
Founder intent
      |
      v
Executable workflow engine
      |
      +--> Project/toolchain profile
      +--> Board + dependency graph
      +--> Scheduler + dispatch admission
      +--> Run ledger + lease lifecycle
      +--> Role/capability enforcement
      +--> Candidate-bound gates and evidence
      +--> Human approval and escalation queue
      |
      v
Control-room projection
      |
      v
Submission-ready package
      |
      v
Human founder uploads and submits
```

Markdown commands remain valuable as operator interfaces and explanations, but scripts become the authority for transitions, admissibility, evidence validity, and readiness.

## 5. P0 enhancements

P0 items close correctness gaps that can produce false progress or false readiness.

### P0.1 Executable workflow engine

**Problem**

`commands/app-build.md` contains the sprint-control logic as prose. Agents are expected to infer which action is legal, what is complete, and how to recover.

**Implementation**

Add:

- `scripts/orchestrator.mjs`
- `scripts/lib/workflow.mjs`
- `scripts/lib/workflow-schema.mjs`
- `docs/team/workflow.json`

Provide commands such as:

```text
orchestrator status
orchestrator next
orchestrator claim --ticket <id> --agent <role>
orchestrator record-result --ticket <id> --gate <gate> --result <result>
orchestrator advance --ticket <id>
orchestrator recover
```

The workflow definition should identify:

- states and legal transitions;
- required inputs and artifacts;
- allowed role capabilities;
- required reviewers;
- entry and exit gates;
- retry limits and retryable failure classes;
- escalation conditions;
- founder-owned pauses;
- candidate-invalidating events;
- recovery behavior for expired or interrupted work.

`commands/app-build.md`, `commands/app-review.md`, and `commands/app-ship.md` should invoke and explain the engine rather than independently encode transition logic.

**Acceptance criteria**

- An illegal transition is rejected by code.
- The same workflow state produces the same next legal actions regardless of which agent asks.
- Recovery identifies abandoned runs and reconciles ticket state.
- Human-owned states cannot be advanced by an agent.
- Existing dry-run scenarios are represented as executable regression fixtures.

### P0.2 Unify board, scheduler, dispatch, and run lifecycle

**Problem**

`scripts/dispatch-preflight.mjs` does not require a ticket identifier. It runs scheduler, context, capability, and risk checks, but cannot prove that the requested ticket is in the scheduler's ready set. `scripts/scheduler.mjs` calculates readiness from a separate schedule projection. `scripts/board.mjs` starts a run when claiming a lease but discards the returned run identity.

**Implementation**

Change `scripts/dispatch-preflight.mjs` to require:

```text
--ticket <ticket-id>
--agent <role-or-agent-id>
--run-mode <implementation|review|verification>
```

Before admitting dispatch, verify atomically:

- the ticket exists and is in a dispatchable state;
- all dependencies are satisfied;
- the requested agent/role is allowed;
- reviewer independence is preserved;
- no valid competing lease exists;
- the scheduler currently marks the ticket ready;
- required project/toolchain prerequisites pass;
- risk policy permits autonomous execution;
- the worktree and branch match the ticket assignment.

Update `scripts/board.mjs` so a claim event stores:

- `run_id`;
- `attempt_id`;
- lease owner;
- lease creation and expiry;
- worktree/branch identity;
- candidate base commit.

Board transitions should automatically map to run-ledger actions:

| Board event | Run-ledger action |
|---|---|
| claimed | start |
| checkpoint/progress | heartbeat/checkpoint |
| blocked | interrupt with blocker |
| review requested | complete implementation attempt |
| rejected | close review and create new attempt |
| done | complete final attempt |
| lease expired | interrupt and recover |

Prefer deriving the schedule from board events and declared dependencies. If `docs/team/schedule.json` remains, treat it as a generated projection rather than an independent source of truth.

**Acceptance criteria**

- A ticket not in the ready set cannot pass dispatch preflight.
- Only one active lease exists per ticket and mode.
- Every claim can be traced to an attempt and run.
- Ticket completion cannot leave an active run.
- Interrupted work can be resumed without inventing identity.

### P0.3 Immutable candidate and evidence identity

**Problem**

`scripts/ship-gate.sh` records a verdict with result, timestamp, blockers, unknowns, and notes. `scripts/lib/project.mjs` can then display that verdict as the latest result. It is not bound to a commit, artifact, variant, dependency graph, policy set, or evidence fingerprint. A later code change can leave an old green verdict looking current.

**Implementation**

Add:

- `scripts/candidate.mjs`
- `scripts/lib/evidence.mjs`
- `docs/team/release-candidate.json`
- `docs/team/evidence/` for structured evidence records

Define a candidate with at least:

```json
{
  "schema": "release-candidate/v1",
  "candidate_id": "rc-...",
  "commit": "<git-sha>",
  "platform": "android",
  "variant": "prodRelease",
  "artifact_path": "...",
  "artifact_sha256": "...",
  "toolchain_fingerprint": "...",
  "dependency_fingerprint": "...",
  "policy_fingerprint": "...",
  "created_at": "...",
  "created_by": "..."
}
```

All gate outputs should share a common envelope:

```json
{
  "schema": "gate-result/v1",
  "gate": "runtime",
  "candidate_id": "rc-...",
  "result": "PASS|BLOCKED|CANNOT_EVALUATE",
  "tool": { "name": "...", "version": "..." },
  "environment": {},
  "evidence": [],
  "blockers": [],
  "unknowns": [],
  "started_at": "...",
  "completed_at": "..."
}
```

Invalidate or mark evidence stale when any material input changes:

- source commit;
- release artifact;
- build variant;
- dependencies or lockfiles;
- toolchain;
- policy version;
- privacy manifest or permissions;
- store metadata;
- signing configuration;
- gate implementation version.

**Acceptance criteria**

- The control room never presents evidence from another candidate as current.
- Every green readiness claim links to immutable evidence.
- A source or dependency change immediately marks affected gates stale.
- Final ship-gate output identifies the exact artifact evaluated.

### P0.4 Project and toolchain contract

**Problem**

The dry run required manually supplied JDK, Android SDK, Gradle, AGP, Kotlin/KSP, SDK-level, variant, and test-command knowledge. The first architecture choice also encountered a real AGP 9, built-in Kotlin, and KSP compatibility issue. These facts should be discovered before implementation begins.

**Implementation**

Add:

- `scripts/project-profile.mjs`
- `scripts/toolchain-doctor.mjs`
- `docs/team/project-profile.json`

The profile should define:

- platforms and application identifiers;
- required JDK/Xcode/Node/Ruby versions where applicable;
- Android SDK location and required packages;
- Gradle wrapper, AGP, Kotlin, KSP, Compose, and SDK versions;
- build variants and their purpose;
- canonical debug and release build commands;
- unit, integration, UI, screenshot, lint, and static-analysis commands;
- emulator/simulator requirements;
- output artifact paths;
- signing mode and credential ownership;
- dependency and version-bump policy;
- network-required versus offline-capable checks.

`toolchain-doctor` should verify the profile before architecture or implementation work is dispatched.

**Acceptance criteria**

- Unsupported Java or SDK versions fail before a build starts.
- A missing variant or malformed command is reported as a project-profile blocker.
- Dependency compatibility constraints are visible to the architect and implementer.
- CI and local runs consume the same profile.

### P0.5 Journey-level runtime verification

**Problem**

`scripts/runtime-gate.sh` currently assumes an Android `assembleDebug` path, selects a broadly matching APK, launches it with Monkey, waits briefly, checks process liveness, and attempts a screenshot. This can pass when the wrong variant was built, when only a splash screen appeared, or even when visual evidence could not be captured.

**Implementation**

Refactor into:

- `scripts/runtime-gate.mjs` as the platform-neutral coordinator;
- `scripts/lib/runtime/android.mjs`;
- `scripts/lib/runtime/ios.mjs`;
- `scripts/journey-gate.mjs`;
- journey declarations under `docs/team/journeys/`.

Project-specific build, artifact, package, activity, simulator, and readiness settings must come from `project-profile.json`.

A journey should declare deterministic steps and assertions, for example:

```json
{
  "schema": "journey/v1",
  "id": "primary-record-flow",
  "priority": "P0",
  "steps": [
    { "action": "launch" },
    { "assert": "screen", "id": "dashboard" },
    { "action": "tap", "id": "add-entry" },
    { "assert": "screen", "id": "entry-form" },
    { "action": "enter", "id": "systolic", "value": "120" },
    { "action": "enter", "id": "diastolic", "value": "80" },
    { "action": "tap", "id": "save" },
    { "assert": "record-visible", "value": "120/80" }
  ]
}
```

Support accessibility identifiers or stable semantic selectors. Screenshots, hierarchy dumps, logs, and recordings should be attached to the candidate evidence.

If required evidence cannot be captured, return `CANNOT_EVALUATE`, never `PASS`.

**Acceptance criteria**

- Runtime verification proves at least one declared P0 journey.
- It confirms the intended variant and package.
- Splash-only success is impossible.
- Screenshot or assertion failure cannot produce PASS.
- Android and iOS use the same result schema.

### P0.6 Candidate-aware submission control room

**Problem**

The control room currently provides mission, communications, board, team, and inbox views. Release readiness is presented as a non-authoritative summary, and there is no dedicated submission workspace that cleanly separates product readiness, engineering evidence, policy/legal checks, store assets, and founder actions.

**Implementation**

Add a sixth **Submission** screen. It should show:

- active candidate and commit;
- platform, variant, version name/code, and artifact hash;
- overall readiness percentage and calculation method;
- product, engineering, runtime, accessibility, privacy, security, legal, dependency, store-policy, and store-asset status;
- PASS, BLOCKED, CANNOT_EVALUATE, STALE, and NOT_RUN states;
- evidence links and timestamps;
- open blockers with severity and owner;
- founder action queue;
- signing state without exposing secrets;
- upload-ready artifact location;
- explicit statement: **Publishing is human-owned and has not been performed.**

Readiness should not be a naive average. Any mandatory blocked, stale, or cannot-evaluate gate should prevent a submission-ready result.

The release checklist should move from Markdown parsing toward structured records, while retaining a generated human-readable checklist.

**Acceptance criteria**

- The dashboard cannot display submission ready without a current candidate.
- Stale evidence is visually distinct from failure and not counted as complete.
- Every blocker has an owner and next action.
- Founder-only actions are separated from agent-remediable blockers.
- No control-room action can trigger store upload or submission.

## 6. P1 enhancements

### P1.1 Upgrade tickets into executable work contracts

Extend the current board ticket fields with:

- required gate and target transition;
- implementer and independent reviewer roles;
- evidence contract and evidence URI;
- candidate impact classification;
- founder dependency;
- expected changed paths;
- forbidden changed paths;
- canonical test commands;
- privacy, security, accessibility, legal, and data classifications;
- rollout and rollback implications;
- residual-risk statement;
- documentation impact;
- dependency/version impact.

Validation should reject tickets that cannot be objectively reviewed. Small low-risk tasks may use a reduced contract, but the reduction must be policy-driven rather than omitted ad hoc.

### P1.2 Enforce capabilities at the mutation boundary

`scripts/lib/capabilities.mjs` already provides useful role-based rules, but enforcement largely occurs when agents voluntarily run preflight or when board gate events are recorded.

Add two enforcement layers:

1. Host hooks, where supported, to inspect Write/Edit operations against ticket path declarations and role permissions.
2. A mandatory post-run reconciliation that compares actual changed files with the ticket contract and capability policy.

Unexpected changes should block review until explicitly accepted or reverted. This catches honest mistakes without assuming every host can provide perfect pre-write hooks.

### P1.3 Dependency and version intelligence

The current dependency checker primarily detects lockfiles and obviously non-reproducible version declarations. Expand it into two layers:

**Offline deterministic layer**

- lockfile consistency;
- wrapper and plugin compatibility;
- minimum/target SDK constraints;
- prohibited repositories;
- dynamic or snapshot versions;
- dependency fingerprinting;
- license inventory from locally available metadata;
- known project compatibility rules.

**Online freshness layer**

- official security advisories;
- platform deprecations;
- current store SDK requirements;
- dependency release/support status;
- current official policy documentation.

Online results must include source URL, retrieval time, applicable version, and freshness expiry. If the network is unavailable, the result should state what could not be evaluated.

### P1.4 Policy, privacy, legal, and store-readiness model

Evolve the current policy format to `studio-policy/v2` with:

- policy identifier and version;
- applicability rules by platform, data type, audience, region, and feature;
- authoritative source and last verification date;
- required evidence;
- responsible agent role;
- mandatory human attestation where applicable;
- expiry or review interval;
- remediation guidance;
- severity and release-blocking behavior.

The plugin should assist with checks and evidence but must route founder declarations and legal judgment to the founder. It should never claim to replace legal counsel.

### P1.5 Evaluation-case lifecycle

The stale-approval evaluation manifest still describes approval binding as unavailable even though binding is implemented. Add lifecycle metadata to every evaluation:

```json
{
  "status": "open|detected|fixed|superseded|retired",
  "introduced_in": "...",
  "fixed_in": "...",
  "detector": "...",
  "last_verified_at": "...",
  "replacement_case": "..."
}
```

`studio-eval.mjs` should fail when a case's narrative contradicts current detector behavior or when a supposedly fixed case is no longer caught.

### P1.6 Generated metadata and current-state documentation

There is a metadata consistency blind spot: the plugin manifest describes 29 roles, the marketplace describes 30, and the live doctor reports 30. The metadata checker does not inspect all manifest descriptions.

Create one canonical metadata source and generate:

- plugin manifest description;
- marketplace description;
- README counts;
- handbook current-state inventory.

Keep historical review material clearly labeled as historical. Generate a current-state appendix showing:

- roles, skills, commands, scripts, gates, and schemas;
- currently enforced controls;
- configured but disabled controls;
- known limitations;
- last successful verification results.

## 7. P2 enhancements

### P2.1 Guided pilot command

Add `/app-pilot` after the workflow engine is stable. It should run a transparent end-to-end rehearsal with checkpoints, show each state transition, and generate a review package. It must use the same engine as production flows, not a separate demo implementation.

### P2.2 Additional host packaging

If Codex or other agent hosts become supported targets, generate host-specific packaging from the same canonical role, skill, command, and capability definitions. Do not fork process semantics per host.

### P2.3 Scalable projections only after measurement

The JSON/JSONL approach is appropriate at the current scale. Consider SQLite or another indexed projection only after measured board/run/evidence size causes material latency or integrity problems. Event files should remain exportable and auditable.

## 8. Implementation sequence

### Wave 0 — Freeze regression evidence

- Convert completed dry runs into machine-readable fixtures.
- Capture current behavior for scheduling, approval binding, lease recovery, runtime liveness, ship-gate verdicts, and control-room projections.
- Correct stale evaluation descriptions.
- Add metadata consistency coverage for every manifest.

**Exit:** Current behavior and known defects are reproducibly demonstrated.

### Wave 1 — Workflow kernel

- Implement workflow schema and orchestrator.
- Define legal ticket and release transitions.
- Connect existing commands to the engine.
- Add restart and recovery behavior.

**Exit:** Workflow transitions are code-owned, deterministic, and restartable.

### Wave 2 — Unified execution identity

- Require ticket identity during dispatch.
- Derive schedule readiness from board state.
- Persist run and attempt identity on claim.
- Connect board transitions to run lifecycle.
- Reconcile expired leases.

**Exit:** Every active task has one traceable ticket, lease, attempt, run, branch, and owner.

### Wave 3 — Project and toolchain contract

- Implement project-profile schema and initializer.
- Implement toolchain doctor.
- Add Android and iOS adapters.
- Teach architecture/research phases to consume compatibility findings.

**Exit:** Environment and compatibility blockers appear before implementation begins.

### Wave 4 — Candidate and evidence model

- Implement candidate creation and fingerprinting.
- Standardize gate-result envelopes.
- Bind ship, runtime, policy, dependency, security, privacy, and review evidence.
- Implement staleness rules.

**Exit:** Every readiness claim is candidate-bound and reproducible.

### Wave 5 — Runtime journeys

- Refactor runtime gate around platform adapters.
- Add journey schema and executor.
- Capture screenshots, logs, hierarchy, and assertions.
- Make evidence failure fail closed.

**Exit:** A runtime PASS proves the configured P0 journey, not process liveness.

### Wave 6 — Control-room submission workspace

- Add Submission screen and readiness projection.
- Add blocker and founder-action views.
- Display candidate identity and stale evidence.
- Preserve strict human-only publishing controls.

**Exit:** A founder can determine readiness, uncertainty, ownership, and next action from one screen.

### Wave 7 — Governance depth and self-maintenance

- Expand ticket contracts and capability reconciliation.
- Add dependency, policy, legal, privacy, and store-readiness schemas.
- Add evaluation lifecycle management.
- Generate metadata and current-state handbook sections.

**Exit:** Governance controls are enforceable, current, and self-checking.

## 9. Validation strategy

Each wave should include:

- unit tests for schemas and state transitions;
- mutation or adversarial tests that prove defects are detected;
- fixtures for interruption, duplicate dispatch, stale evidence, wrong variant, missing screenshot, and changed approval content;
- backward-compatibility tests for existing project files;
- one small Android pilot;
- one complex Android pilot using the Blood Pressure Journal fixture;
- an iOS fixture before claiming cross-platform completeness;
- control-room snapshot or component tests;
- full `scripts/test.sh` regression execution.

Critical adversarial cases include:

1. Agent tries to claim a blocked ticket.
2. Two agents claim the same ticket concurrently.
3. Agent edits paths outside its work contract.
4. Approval content changes after approval.
5. Candidate source changes after a green gate.
6. Runtime launches only a splash screen.
7. Screenshot capture fails.
8. Wrong build variant is selected.
9. A dependency or policy source becomes stale.
10. An agent attempts a founder-owned publishing transition.

## 10. Definition of 10/10

The system should be considered 10/10 only when all of the following are true:

- Workflow state is executable and deterministic, not dependent on prose interpretation.
- Every task has durable ownership, identity, lease, and recovery.
- Every review and gate result is bound to an immutable candidate.
- Runtime verification proves real P0 journeys.
- Toolchain and dependency compatibility are checked before implementation.
- Capability and changed-path policies are structurally enforced.
- Privacy, security, accessibility, dependency, legal, and store-policy claims carry current evidence.
- The control room distinguishes current, stale, blocked, unknown, and human-owned work.
- A founder can see exactly what is ready, what is missing, and who owns each action.
- Store upload and submission remain impossible for autonomous agents.
- Evaluation cases, documentation, manifests, and implementation cannot silently drift apart.
- Repeated dry runs show materially consistent results across agents and restarts.

Until then, the plugin can be highly capable and useful, but should not describe itself as a fully autonomous or fully deterministic development organization.

## 11. Risks and safeguards

### Risk: Building too much orchestration at once

Safeguard: introduce the workflow engine incrementally around existing scripts. Keep compatibility adapters until each command is migrated and tested.

### Risk: Dashboard becomes the source of truth

Safeguard: keep the control room a projection. Board events, runs, candidates, evidence, and approvals remain authoritative records.

### Risk: False precision in readiness percentage

Safeguard: use mandatory-gate semantics and expose the calculation. A blocked mandatory gate overrides percentage completion.

### Risk: Online checks create nondeterministic builds

Safeguard: separate deterministic offline verification from freshness checks, cache source metadata, and record retrieval time and expiry.

### Risk: More schemas increase operator burden

Safeguard: generate defaults, derive fields where safe, provide doctor commands, and keep human-authored fields limited to actual decisions.

### Risk: Legal checks are mistaken for legal approval

Safeguard: label checks as evidence and issue detection. Require human attestation for legal declarations and store agreements.

## 12. Files most likely to change

Existing files:

- `commands/app-init.md`
- `commands/app-build.md`
- `commands/app-review.md`
- `commands/app-ship.md`
- `scripts/board.mjs`
- `scripts/scheduler.mjs`
- `scripts/dispatch-preflight.mjs`
- `scripts/run-ledger.mjs`
- `scripts/runtime-gate.sh`
- `scripts/ship-gate.sh`
- `scripts/dependency-check.mjs`
- `scripts/policy-check.mjs`
- `scripts/metadata-check.mjs`
- `scripts/studio-eval.mjs`
- `scripts/lib/project.mjs`
- `scripts/lib/capabilities.mjs`
- `control-room/state.mjs`
- `control-room/src/` components and tests
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `docs/HANDBOOK.md`
- `eval/*/manifest.json`

Likely new files:

- `scripts/orchestrator.mjs`
- `scripts/lib/workflow.mjs`
- `scripts/lib/workflow-schema.mjs`
- `scripts/project-profile.mjs`
- `scripts/toolchain-doctor.mjs`
- `scripts/candidate.mjs`
- `scripts/lib/evidence.mjs`
- `scripts/runtime-gate.mjs`
- `scripts/journey-gate.mjs`
- `scripts/lib/runtime/android.mjs`
- `scripts/lib/runtime/ios.mjs`
- `docs/team/workflow.json`
- `docs/team/project-profile.json`
- `docs/team/release-candidate.json`
- `docs/team/journeys/*.json`
- `docs/team/evidence/*.json`

## 13. Decisions to preserve

The enhancement program must not accidentally remove the best parts of the present design:

- preserve three-state gate truth rather than converting unknown into pass;
- preserve event-sourced board history;
- preserve semantic role and reviewer independence;
- preserve approval-content binding;
- preserve founder intent and explicit escalation;
- preserve worktree isolation and safe Git behavior;
- preserve zero-dependency core scripts where practical;
- preserve mutation and adversarial evaluation;
- preserve conditional enablement of controls in `app-init`;
- preserve the hard boundary between submission readiness and human publishing.

## 14. Recommended first implementation slice

The first implementation PR should be deliberately narrow:

1. Correct metadata and stale evaluation drift.
2. Add regression fixtures for duplicate dispatch and stale candidate evidence.
3. Introduce `workflow-schema.mjs` and a read-only `orchestrator status/next` command.
4. Require `--ticket` in dispatch preflight and prove scheduler readiness.
5. Persist run and attempt identity from board claims.

This slice creates immediate correctness value without requiring the control room, runtime gate, and release model to be rewritten simultaneously. Subsequent PRs can build candidate identity, project profiles, journeys, and submission readiness on top of that stable execution kernel.

## 15. Related evidence and reviews

- `docs/dry-runs/2026-08-01-blood-pressure-journal-review.md`
- `docs/dry-runs/2026-08-02-blood-pressure-journal-expert-audit.md`
- `docs/dry-runs/2026-08-02-blood-pressure-journal-10-10-readiness-plan.md`
- `docs/reviews/2026-07-31-ai-development-team-strategy-architecture-review.md`
- `docs/reviews/2026-07-31-deferred-implementation-review-notes.md`
- `docs/reviews/2026-07-31-plugin-review-action-plan.md`
- `docs/reviews/2026-08-01-app-ship-end-to-end-audit.md`
- `docs/HANDBOOK.md`

This document is the global plugin plan. App-specific defects and design observations should remain in their dry-run reports; only reusable process and platform improvements should be promoted here.
