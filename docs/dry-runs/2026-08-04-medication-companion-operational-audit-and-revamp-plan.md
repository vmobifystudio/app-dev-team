# Medication Companion Dry Run — Operational Audit and Global Revamp Plan

Date: 2026-08-04  
Audit type: adversarial end-to-end operating-model audit  
Plugin baseline at pilot start: `main` at `b3676a3`  
Pilot workspace: `dry-runs/medication-companion`  
Decision: stop product expansion; preserve the evidence and improve the team system

> **Second-pass review, 2026-08-04:** Sections 16–21 re-verify this report against the current
> `feat/phase-0-truth-repair` tree. They distinguish current structural defects from pilot symptoms
> and already-fixed findings. Where sequencing differs, the foundation program in section 19
> supersedes the broader phase order in section 9.

## 1. Executive verdict

This dry run achieved its real purpose. It exercised the plugin as an AI development team across idea clarification, product documentation, requirements, architecture, staffing, team communication, ticket planning, scheduling, dispatch, implementation, review, verification, escalation, Android runtime evidence, and release-readiness preparation.

The plugin is a strong process foundation, but it is not yet a trustworthy autonomous development organization. Individual tools often work well in isolation. The main risk is that their truths are not yet joined into one enforceable lifecycle. A ticket can be approved without satisfying its risk route; a test suite can be green without proving the acceptance criteria; a scheduler can say complete while the board is not complete; traceability can be green while a requirement has no implementation ticket; and release evidence can remain detached from the exact candidate it is supposed to prove.

Editorial operational estimate: **6.6/10**. This is a directional judgement, not a measured baseline:
the original score has no executable rubric, denominator, confidence interval, or reproducible
scoring command. Section 18 replaces it with falsifiable foundation invariants.

That score does not mean the plugin needs a rewrite. It means the next investment must target the seams between otherwise promising modules. Adding more agents, prose, dashboards, or sample-app features before repairing those seams would increase apparent sophistication without increasing trust.

## 2. Scope and boundaries

The pilot used an offline Android medication reminder and adherence journal because it creates realistic pressure on:

- product and requirements quality;
- health-adjacent privacy and copy constraints;
- notification permission and scheduling;
- persistence and migration safety;
- accessibility and runtime semantics;
- policy, legal, dependency, and store-readiness review;
- founder decisions and human blockers;
- multi-ticket coordination and independent review.

The plugin's product boundary remains:

- produce a complete, tested, policy-aware, legally reviewed, upload-ready app package and submission dossier;
- expose progress, evidence, blockers, dependencies, and founder actions clearly;
- never upload, publish, release, or submit an Android or iOS app automatically;
- leave credentials, legal attestations, final signing authority where required, pricing, declarations, and store submission to the human founder.

No plugin source was changed during this dry run. Pilot-only code and evidence remain isolated under `dry-runs/medication-companion`.

## 3. What the run actually exercised

The run went materially beyond a document-only walkthrough:

1. A fresh idea was converted into founder intent, product requirements, software requirements, UX direction, architecture, test, release, privacy, and team artifacts.
2. Roles and capabilities were declared.
3. Team questions, answers, decisions, and a founder escalation were recorded.
4. Requirements were attached to an event-sourced board and dependency schedule.
5. Dispatch preflight exercised context freshness, capability scope, scheduling, risk routes, and durable claims.
6. Multiple ticket branches, reviews, approvals, and merges exercised the lifecycle.
7. Enough Android code was produced to test whether planning and verification claims survived contact with implementation.
8. JVM tests, Android instrumentation, a separately provisioned permission-denial case, app builds, emulator launch, and live semantic hierarchy inspection were used as operational evidence.
9. Release preparation reached an unsigned AAB and correctly exposed human signing and founder-policy work instead of auto-publishing.

This was deliberately stopped once additional app work had diminishing value for evaluating the plugin.

## 4. What worked especially well

### 4.1 Durable process primitives are real

The event board, claims, run leases, messages, decision references, and founder escalation were not merely prose. They created inspectable state and made several workflow errors visible. This is the plugin's most valuable architectural direction.

### 4.2 The team could communicate across roles

The product manager and technical lead used a question-and-answer path, linked the answer to a decision artifact, and escalated an unresolved privacy/lock-screen question to the founder. `board-doctor` continued to surface that unresolved escalation. This is a genuine team behavior, not a decorative role list.

### 4.3 Traceability caught malformed work links

The trace tool rejected comma-concatenated feature IDs and undeclared references. Once the artifacts used the expected grammar, it built a coherent graph. The defect is incomplete coverage direction, not absence of useful trace validation.

### 4.4 Dispatch preflight composes important concerns

Context freshness, scheduler state, capability ownership, risk routing, and claim identity are already present. This is a good kernel. The missing part is carrying one admission decision through every later transition.

### 4.5 Static and executed evidence were not treated as identical

The board lifecycle distinguishes review from execution and can hold runtime verification separately. That distinction prevented infrastructure failure from being mislabeled as a product failure.

### 4.6 Three-state verification was valuable

PASS, FAIL, and CANNOT EVALUATE are the right semantics. Low disk, emulator availability, and corrupted generated caches were infrastructure conditions. The run did not need to falsify a PASS or FAIL to describe them.

### 4.7 Runtime evidence found defects source review missed

Compose test tags configured at the root did not propagate into dialog windows. Inspecting the live hierarchy exposed the issue. This validates the planned journey-gate direction: source review and unit tests cannot establish all user-visible behavior.

### 4.8 Human submission boundaries held

The run produced release-preparation evidence but did not publish, upload, or submit. Missing signing and founder-owned declarations remained blockers. This behavior must be preserved.

### 4.9 The baseline regression suite is substantial

The plugin suite completed with 929 passing tests and no failures. That provides a useful safety net, although the pilot proved that fixture/unit success does not yet cover cross-tool operating behavior.

## 5. Editorial scorecard — directional, not a baseline

| Capability | Score | Adversarial assessment |
|---|---:|---|
| Idea and founder-intent capture | 7.5/10 | Strong immutability, but later decisions conflict with the recorded-intent model. |
| Product, PRD, SRS, UX, and architecture docs | 8.0/10 | Useful and thorough; executable grammar is too brittle and can drift from tools. |
| Team and role model | 8.5/10 | Broad, understandable, and capable of real communication. |
| Communication and escalation | 8.0/10 | Durable Q/A and founder escalation worked; action ownership needs stronger lifecycle support. |
| Requirements traceability | 7.0/10 | Good reference validation; missing reverse coverage and many-to-many ticket links. |
| Tickets, planning, and scheduling | 6.5/10 | Real workflow state exists; board/scheduler divergence and contention are serious. |
| Dispatch, context, and capabilities | 7.0/10 | Valuable preflight; path semantics, Android templates, and decision propagation need repair. |
| Implementation workflow | 7.0/10 | Work could be claimed, reviewed, and integrated; lifecycle identity is fragmented. |
| Verification and evidence | 6.5/10 | Multiple evidence levels work; acceptance and candidate binding are incomplete. |
| Risk, privacy, security, and policy governance | 5.5/10 | Risk is detected but not reliably enforced after dispatch. Checks are still shallow. |
| Toolchain, dependency, and version governance | 5.0/10 | Pinned intent exists; actual environment and dependency intelligence can silently diverge. |
| Recovery and debuggability | 6.5/10 | Failures were recoverable, but classification and guided remediation are inconsistent. |
| Release/submission readiness | 4.5/10 | No immutable candidate dossier or candidate-bound gate set yet. |
| Control room and operational observability | 4.5/10 | Does not yet render the complete, authoritative submission-readiness truth. |
| **Overall** | **6.6/10** | **Strong foundation; not yet safe to call an autonomous, submission-ready AI team.** |

## 6. Critical findings

### P0-01 — Founder decisions use two incompatible models

Observed behavior:

- instructions encourage later decisions to be appended to founder-intent documentation;
- `founder-intent --write` protects the recorded file from modification and reports changed content as tampering;
- the pilot had to create a separate dated decision file to preserve immutability.

Risk: agents must choose between following the documented workflow and satisfying the executable guard.

Global correction:

- keep the original founder-intent snapshot immutable;
- represent later decisions as append-only decision events with IDs, author, timestamp, scope, status, supersession link, and artifact references;
- make effective founder intent a projection over the snapshot plus accepted events;
- distinguish amendment, clarification, exception, and revocation;
- add a contract test proving the instructions and CLI agree.

Likely modules: `scripts/founder-intent.mjs`, event/projection helpers, founder-intent skill and handbook sections, schemas and fixtures.

### P0-02 — Gate detection is text-sensitive and polarity-blind

Observed behavior: a statement such as “no destructive migration fallback” activated a destructive-migration gate because the detector matched terms without understanding negation.

Risk: false gates create needless approvals; worse, similarly naive matching may miss semantic risk.

Global correction:

- prefer structured decision fields over free-text inference;
- report matched evidence, polarity, confidence, and source;
- require explicit confirmation for low-confidence critical gates;
- maintain adversarial negation and exception fixtures.

Likely modules: founder gate detector, risk router, decision schema, related tests.

### P0-03 — Project-root resolution can write into the wrong repository

Observed behavior: before the nested pilot had its own Git repository, board generation resolved the outer Git common root and wrote board artifacts into the plugin repository.

Risk: one project can corrupt another project's coordination state.

Global correction:

- require or deterministically derive an explicit project root;
- print the resolved root before every mutation;
- refuse ambiguous nested/common-directory layouts;
- support `--project-root` consistently across every CLI;
- add a nested-repository canary integration test.

Likely modules: common CLI/root resolver, `scripts/board.mjs`, `board-doctor`, dispatch, schedule, trace, context and control-room loaders.

### P0-04 — Capability-manifest root semantics are unsafe

Observed behavior: `root: "."` was interpreted relative to `docs/team/capabilities.json`, causing `app` to be seen as `../../app`. The pilot required the surprising value `../..`.

Risk: valid work is refused or, more seriously, authority is evaluated against unintended paths.

Global correction:

- define all stored paths relative to one explicit project root;
- resolve and normalize paths before authorization;
- reject escape outside the root;
- generate the manifest rather than asking authors to infer relative-path semantics;
- include platform-aware defaults such as Android `src/test` and `src/androidTest`.

Likely modules: capability checker, capability manifest generator/schema, dispatch preflight, role templates and tests.

### P0-05 — Approval binds one commit, not the complete ticket change

Observed behavior: approval binding hashes `commit^..commit`. Multi-commit tickets therefore cannot bind the complete ticket delta. A later repair commit can be approved while the primary implementation remains outside that approval hash.

Risk: the system can claim an independently reviewed change without proving what was reviewed.

Global correction:

- introduce an immutable work-candidate object containing ticket ID, base SHA, head SHA, merge base, complete diff hash, changed-file manifest, evidence references, and timestamp;
- bind approvals to that candidate ID;
- invalidate approval when base, head, diff, required evidence, or risk decision changes;
- prohibit “latest commit” as a substitute for candidate identity.

Likely modules: `scripts/board.mjs`, approval checker, event schema/projections, dispatch/run records, ship gate and control-room state.

### P0-06 — Risk routing is advisory after admission

Observed behavior: high/critical reminder behavior required specialist reviewers and runtime/permission evidence, but the board accepted a single generic code-reviewer approval.

Risk: the plugin can identify a risk correctly and then ignore it at the moment that matters.

Global correction:

- persist a risk-decision ID at dispatch;
- attach required approver roles, separation-of-duty rules, and evidence classes to the work candidate;
- enforce them at review, ready-for-QA, merge, candidate creation, and ship readiness;
- invalidate downstream states when the risk route changes;
- allow waivers only as explicit founder/security events with reason and expiry.

Likely modules: `risk-router`, dispatch preflight, board transitions, approval checker, ship gate, schemas and control room.

### P0-07 — Traceability is only partially bidirectional

Observed behavior:

- tickets were checked against declared requirement IDs;
- a declared feature with no primary implementation ticket could still leave trace green;
- a comma-separated list looked valid in the board but was treated as one undeclared feature.

Risk: “trace green” does not prove that committed scope is implemented or deliberately deferred.

Global correction:

- replace scalar `feature` with a typed `features[]` relation;
- validate requirement → ticket → change → test → evidence → candidate in both directions;
- require every in-scope requirement to be implemented, deferred with approval, or explicitly out of scope;
- detect orphan tests, changes, and release claims as well as orphan requirements.

Likely modules: `scripts/trace.mjs`, board schema/CLI, PRD/SRS generators, verification registry, candidate manifest and graph fixtures.

### P0-08 — Generic green tests do not prove acceptance criteria

Observed behavior: `verify-done.sh` passed a JVM suite even though a repository-recreation criterion required device-backed evidence that did not yet exist.

Risk: completion can be declared based on unrelated passing tests.

Global correction:

- give each acceptance criterion a stable ID;
- record required evidence class and environment;
- map criterion → test ID/file/journey → execution result → artifact → candidate;
- fail completion if a required criterion has no current evidence;
- retain CANNOT EVALUATE where the environment blocks execution.

Likely modules: ticket schema, `verify-done.sh`, test/evidence registry, board transitions, trace graph and control room.

### P0-09 — There is no immutable release-candidate dossier

Observed behavior: an unsigned AAB was built, but its artifact hash, commit, toolchain, gate results, signing state, and later source changes were not represented as one durable candidate. The earlier artifact became stale as soon as build configuration changed.

Risk: release readiness can describe evidence from different source states.

Global correction:

- create a candidate manifest containing candidate ID, commit/tree SHA, clean-worktree assertion, artifact path/hash/type, application/version IDs, signing certificate fingerprint or explicit unsigned status, toolchain profile, gate verdict IDs, provenance, and creation time;
- bind all final evidence to it;
- make any relevant change mark the candidate stale;
- permit store-ready only for one coherent candidate;
- keep submission as a human-only action outside the candidate builder.

Likely modules: new candidate builder/schema, `ship-gate.sh`, `runtime-gate.sh`, dependency/policy checks, release skills, control room and CI workflows.

### P0-10 — Board, scheduler, claim, run, and merge are separate truths

Observed behavior: after a ticket merged with a runtime hold, the schedule remained pending and had to be manually changed to complete to unblock dependants. “Complete” meant dependency-integrated in one module and fully done in another.

Risk: contradictory workflow states require operator interpretation and manual repair.

Global correction:

- define one append-only workflow event model;
- derive board, scheduler, claims, runs, merge, QA, and readiness projections from it;
- use explicit states such as implemented, integrated, statically verified, runtime held, accepted, and candidate included;
- make transition commands atomic and idempotent;
- never maintain a second manually editable status ledger.

Likely modules: board/event kernel, scheduler, dispatch/run lifecycle, merge hooks, projections and migration adapters.

### P0-11 — The scheduler ignores owner and change contention

Observed behavior: two tickets were offered concurrently to the same owner while both touched overlapping application state.

Risk: nominal parallelism creates merge conflict, duplicated reasoning, and inconsistent architectural decisions.

Global correction:

- model owner capacity;
- issue resource/path/impact leases;
- check declared and predicted change overlap;
- support read-shared/write-exclusive coordination;
- show why a ticket is blocked and what can safely run in parallel.

Likely modules: scheduler, dispatch preflight, capability/impact map, claims and control-room projection.

### P0-12 — The control room is not the authoritative operational picture

Observed behavior: important readiness concepts exist in scripts and documents but are not represented as one candidate-aware dashboard state. The founder cannot reliably see exact progress, stale evidence, stage blockers, human actions, or the candidate being prepared.

Risk: a polished dashboard can communicate false confidence.

Global correction:

- make the control room a read-only projection of canonical events and gate verdicts;
- define progress denominators explicitly by stage;
- show current candidate, staleness, requirement coverage, active work, blocked work, risk approvals, evidence freshness, policy/legal/dependency status, and founder action queue;
- never infer a separate dashboard truth;
- build and smoke-test the React control room in CI.

Likely modules: `control-room/src`, control-room state builder, workflow/candidate schemas, readiness API and CI.

## 7. High-priority supporting findings

### P1-01 — A project/toolchain contract is missing

The initial `gradlew` delegated to globally installed Gradle 9.4 instead of pinned Gradle 9.1. A real wrapper and distribution checksum fixed this. The plugin should refuse meaningful work until a toolchain doctor verifies:

- JDK location and exact supported version;
- real Gradle wrapper and distribution checksum;
- AGP, Kotlin, KSP, compileSdk, minSdk, and targetSdk;
- Android SDK tools, ADB, emulator, AVD, free disk, and memory;
- dependency-cache health and offline/network mode;
- selected build variants and artifact paths.

The resulting project profile must drive build, test, runtime, dependency, policy, and candidate tools instead of each script guessing.

### P1-02 — Capability templates are not platform-complete

The Android test role allowed `app/src/test` but omitted `app/src/androidTest`, preventing legitimate instrumentation work. Capability packs need platform source-set fixtures and generated defaults.

### P1-03 — Runtime verification needs semantic journey contracts

Raw ADB coordinates and text input were timing-sensitive and unreliable. Stable runtime proof should use semantic selectors, explicit preconditions, assertions, screenshots/hierarchy artifacts, and teardown. Android permission states need a dedicated matrix because the connected-test harness may auto-grant or preserve permissions.

### P1-04 — Android accessibility has no equivalent executable gate

The current accessibility scanner is Swift-oriented. Running a source scanner against an unsupported platform must return NOT APPLICABLE or CANNOT EVALUATE, never an apparently platform-neutral CLEAR. Android requires lint, Compose semantics, touch-target/content-description checks, font scaling, contrast where measurable, and TalkBack-oriented journeys.

### P1-05 — Dependency and policy checks remain shallow

The system needs candidate-bound checks for:

- direct and transitive dependency inventory;
- outdated/deprecated dependencies against approved documentation;
- known vulnerabilities;
- license compatibility and notices;
- SDK/data-safety implications;
- Android and Apple target/API policy timelines;
- privacy declarations and legal artifact presence;
- explicit UNKNOWN/CANNOT EVALUATE when current online data is unavailable.

Automated legal checks are issue detectors, not legal approval.

### P1-06 — Impact mapping proves configuration, not coordination

A matching rule with named consumers does not prove those consumers were notified or acknowledged the change. Material impact must create required review/acknowledgement events and block the relevant transition until satisfied.

### P1-07 — Board metadata cannot be safely corrected

Early feature-link errors required regenerating an unstarted board. Once work exists, metadata needs append-only amend/supersede events that preserve history without direct log edits.

### P1-08 — CLI behavior is inconsistent

Examples observed:

- `board-doctor --project-root` interpreted the directory as a board file and emitted an `EISDIR` stack trace;
- some tools have no functional `--help`;
- shell and JavaScript command names differ, such as `spawn-gate.sh` versus expected `.mjs` discovery;
- schema failures such as `routes` versus expected `rules` are found late.

All commands need a shared parser, consistent root option, real help, schema validation, stable exit codes, and actionable structured errors without raw stack traces for operator mistakes.

### P1-09 — Environment failure classification should be first-class

The pilot encountered low disk and a corrupted generated Gradle transform cache. The latter produced hundreds of source-like errors even though unchanged dependencies were the cause. Diagnostics should classify source, toolchain, dependency resolution, cache, emulator, permission, and external-service failures before assigning work back to an implementation agent.

### P1-10 — Metadata and benchmark success can be stale

The metadata checker can report CLEAR while manifest/marketplace versions differ. The evaluation suite can report full detection while fixtures describe already-fixed or stale defects. Metadata should be generated from one source; benchmark fixtures need lifecycle states and periodic live-case validation.

## 8. Target operating architecture

The plugin should converge on a small set of canonical objects:

```text
Founder snapshot + decision events
                 |
Requirements graph ---- risk decision
         |                    |
         +---- work contract -+
                    |
             workflow events
          / board / schedule / run
                    |
              work candidate
        approvals + criterion evidence
                    |
             release candidate
       policy + legal + dependency + journey
                    |
         submission-readiness projection
                    |
             human founder action
```

Rules:

- events and immutable manifests are sources of truth;
- boards, schedules, trace graphs, reports, and dashboards are projections;
- every gate verdict includes subject ID, evaluator version, inputs, outcome, reasons, evidence, and timestamp;
- no verdict for one candidate can satisfy another;
- any unknown required condition prevents READY but is not mislabeled FAIL;
- agents prepare submission; humans submit.

## 9. Safe global revamp plan

### Phase 0 — Freeze operational regression evidence

Deliverables:

- preserve this pilot as a golden operational fixture;
- encode each P0 observation as a failing cross-tool contract test;
- preserve the 929-test baseline;
- add nested-root, multi-commit approval, advisory-risk bypass, reverse-trace, scheduler divergence, and stale-candidate adversarial cases.

Exit criteria:

- failures reproduce deterministically without requiring a full sample app;
- tests state whether a result is PASS, FAIL, CANNOT EVALUATE, or NOT APPLICABLE;
- existing valid append-only logs remain readable.

### Phase 1 — Repair truth and identity

Deliverables:

- canonical project profile and root resolver;
- append-only founder decision events;
- typed requirement/ticket relations;
- unified workflow event vocabulary;
- immutable work-candidate identity;
- immutable release-candidate manifest;
- common gate-verdict envelope.

Exit criteria:

- every mutation names its project, ticket/run where applicable, and candidate where applicable;
- approval of a multi-commit ticket binds the entire delta;
- changing any candidate input makes related readiness stale;
- old logs are dual-read without rewriting history.

### Phase 2 — Enforce the workflow

Deliverables:

- board and scheduler projections from the same events;
- risk requirements enforced at all relevant transitions;
- criterion-level evidence registry;
- owner/resource/path contention;
- capability checks using normalized project-relative paths;
- append-only correction and supersession events.

Exit criteria:

- no scheduler/board manual reconciliation;
- high-risk work cannot pass with the wrong reviewer/evidence set;
- every in-scope requirement is implemented, explicitly deferred, or rejected;
- every required acceptance criterion has current candidate-bound evidence.

### Phase 3 — Platform and environment reliability

Deliverables:

- project/toolchain doctor;
- generated Android and iOS capability profiles;
- semantic journey runner and permission-state matrix;
- platform-qualified accessibility gates;
- infrastructure failure classifier and guided recovery;
- project-profile-driven build/runtime/artifact commands.

Exit criteria:

- wrong JDK/Gradle/SDK/variant fails before implementation work;
- unsupported scanners cannot report CLEAR;
- runtime evidence uses semantic journeys rather than coordinate scripts;
- infrastructure faults remain CANNOT EVALUATE and include remediation.

### Phase 4 — Governance depth

Deliverables:

- dependency inventory, freshness, vulnerability, and license evidence;
- privacy/data-safety and store-policy evidence;
- impact acknowledgement events;
- founder action queue with owner, due date, blocking stage, and resolution evidence;
- qualified-review versus automated-check distinction.

Exit criteria:

- no legal/policy/dependency readiness claim is an unbound checkbox;
- online-unavailable checks show UNKNOWN/CANNOT EVALUATE;
- human-only actions are visible and cannot be silently bypassed.

### Phase 5 — Candidate-aware control room

Deliverables:

- one read-only readiness projection;
- explicit stage denominators and progress calculation;
- candidate identity and stale-state display;
- blockers, dependencies, active ownership, evidence freshness, risk approvals, and founder actions;
- React build and smoke test in CI.

Exit criteria:

- every displayed status links to canonical evidence;
- changing candidate inputs updates readiness deterministically;
- the dashboard cannot create or override workflow truth;
- the founder can answer “what is ready, what is blocked, who owns it, and what must I do?” from one screen.

### Phase 6 — Learning and benchmark maintenance

Deliverables:

- structured run findings and improvement proposals;
- human approval before a lesson changes team policy;
- benchmark case lifecycle: active, fixed, regression, retired;
- periodic live dry runs focused on one operational hypothesis rather than building another polished app.

Exit criteria:

- lessons are traceable to evidence;
- stale fixtures cannot inflate the score;
- no learned rule is silently promoted into production behavior.

## 10. Recommended implementation PR sequence

1. **Operational contract fixtures** — reproduce the observed failures without changing behavior.
2. **Common project root and CLI kernel** — consistent roots, options, help, schemas, errors.
3. **Founder decision event stream and polarity-safe gates**.
4. **Workflow event schema and board/scheduler dual-read projections**.
5. **Work candidate plus cumulative approval binding**.
6. **Risk and criterion-evidence enforcement**.
7. **Bidirectional traceability and many-to-many requirement links**.
8. **Project/toolchain profile and platform capability generation**.
9. **Release candidate and stale-evidence invalidation**.
10. **Semantic journey, permission matrix, and Android accessibility gates**.
11. **Dependency, policy, legal, and impact-acknowledgement depth**.
12. **Candidate-aware control room and CI smoke coverage**.
13. **Learning proposal and benchmark lifecycle**.

Each PR should be independently reversible, preserve existing logs, include migration notes, and avoid combining schema migration with large UI redesign.

## 11. Compatibility and “do not break the plugin” strategy

- Introduce versioned schemas additively.
- Dual-read legacy and new formats before enforcing new writes.
- Project old board/schedule state into the new model; do not rewrite append-only history.
- Run new gates in shadow/report-only mode against fixtures and selected pilots.
- Compare old and new verdicts and investigate every divergence.
- Move to warn mode, then enforce P0 invariants only after false-positive thresholds are met.
- Put UI/control-room changes after the state model is stable.
- Keep network-dependent intelligence isolated and cache its provenance; offline absence must not create a false pass.
- Preserve explicit human overrides as durable, scoped, expiring events—never hidden flags.
- Keep auto-publication technically impossible in default workflows.

## 12. Acceptance tests for a trustworthy team

The revamp is not complete until the following adversarial scenarios pass:

1. A nested project cannot write state to its parent repository.
2. A changed founder decision can be added without mutating the original snapshot.
3. “No destructive migration” does not activate a destructive-migration requirement without an explicit structured reason.
4. A two-commit ticket cannot be approved by binding only its last commit.
5. Critical work cannot merge with a generic reviewer when specialist approval is required.
6. A requirement with no ticket makes coverage incomplete unless explicitly deferred/out of scope.
7. A passing unrelated test suite cannot satisfy an unmapped acceptance criterion.
8. Scheduler and board cannot disagree because both derive from the same workflow events.
9. The same owner or overlapping write lease cannot be scheduled concurrently beyond policy.
10. Changing source, toolchain, artifact, signing state, or required evidence makes the release candidate stale.
11. An unsupported platform scanner cannot return CLEAR.
12. A low-disk or broken-emulator condition returns CANNOT EVALUATE with a useful remedy.
13. Permission-granted and permission-denied journeys are independently provisioned and evidenced.
14. The control room shows the exact candidate and links every readiness claim to durable evidence.
15. No command in the normal workflow can upload or submit an app to a store.

## 13. Success metrics

- 100% of in-scope requirements are implemented, deferred, or rejected with authority.
- 100% of required acceptance criteria have current candidate-bound evidence.
- 100% of approvals bind a complete immutable work candidate.
- 100% of final gates bind one immutable release candidate.
- 0 known ways to bypass required risk reviewers/evidence using ordinary board transitions.
- 0 project-root writes outside the resolved project boundary.
- 0 unsupported-platform CLEAR results.
- 0 manually reconciled board/scheduler states.
- 0 automatic store submissions.
- 100% of founder blockers have owner, reason, blocking stage, and resolution state.
- every control-room status is reproducible from durable state.

## 14. Current pilot disposition

The pilot is intentionally paused, not promoted as a finished app.

Completed for operational learning:

- idea-to-document workflow;
- roles, capability manifests, messages, decisions, and escalation;
- requirements/board/schedule/dispatch exercise;
- multiple implementation and review cycles;
- enough local and device verification to expose evidence and runtime weaknesses;
- emulator launch and semantic hierarchy inspection;
- unsigned release bundle preparation and human-blocker identification.

Intentionally not completed:

- polishing the sample into a production-quality medication product;
- formally closing every remaining pilot ticket;
- creating a signed release candidate;
- resolving founder/legal decisions;
- uploading or submitting to any store.

The nested pilot currently contains uncommitted pilot-only signing/readiness documentation changes. They should remain evidence until a later decision explicitly asks to continue or archive that pilot. They are not plugin modifications.

## 15. Final CTO recommendation

Do not start another broad sample-app build yet. First implement Phases 0–2 and prove them using this dry run as a compact operational regression fixture. Then run a focused follow-up scenario designed to attack candidate identity, risk enforcement, reverse trace coverage, and founder blocker visibility.

The plugin already contains the beginnings of an excellent AI development organization. The path to 10/10 is not more ceremony or more agents. It is making every important claim—scope, authorization, completion, approval, evidence, risk, and readiness—refer to the same immutable work and release identities, with one durable workflow truth and a control room that only projects that truth.

## 16. Second-pass foundation review

The first pass correctly identified many symptoms, but it still organized the work too much like a
feature backlog. A smarter reading asks a different question:

> What small set of missing invariants allows many apparently unrelated defects to recur?

Re-reading the current implementation produces seven root causes. The individual dry-run findings
are mostly instances of these causes.

### 16.1 There is no single authenticated subject identity

Every important event accepts a role-shaped string such as `--by code-reviewer`. The system checks
separation between role names, but it does not prove that two names represent independent actors or
that the caller is authorized to assert either role.

Consequences:

- self-approval can be avoided syntactically while the same agent supplies both identities;
- capability checks authorize a declared string, not an authenticated principal;
- founder waivers and specialist approvals have weak authorship;
- model, host, session, and delegation provenance are not durable facts.

This does not require enterprise identity infrastructure. It requires a signed or host-attested
`actor/v1` envelope with actor ID, role, session/run, model, delegator, capability grant, and
expiration. Local development may use a clearly marked insecure identity provider, but production
readiness must never confuse that with verified independence.

### 16.2 There is no canonical project/work/candidate identity

Project root is derived differently by different scripts. Ticket identity exists, run identity is
partially linked, approval identity is one commit, and release identity is absent.

Consequences:

- nested repositories can resolve to the wrong project;
- a preflight verdict can be used for a later or different mutation;
- multi-commit work is reviewed as its last commit;
- evidence and readiness can outlive the source/artifact they evaluated;
- the control room cannot answer which exact build is being prepared.

The foundation needs four immutable IDs with explicit parentage:

```text
project_id -> work_contract_id -> work_candidate_id -> release_candidate_id
                         \-> run_id / attempt_id
```

Every decision and artifact must name the narrowest applicable subject.

### 16.3 The workflow has multiple writable truths

The board is event-sourced, but the scheduler remains a separately edited JSON plan. Run state is a
second ledger. Ship status is an overwritten verdict file. Founder intent, messages, incidents, and
memory each have separate write semantics.

More subtly, `scripts/lib/project.mjs` describes itself as the common read layer but prefers generated
`docs/31-board.md` over the authoritative event log when Markdown rows exist. A stale or edited view
can therefore drive the human-facing surface even while the event log says something else.

This is the central architectural defect. The answer is not one enormous file. It is one event
envelope and one workflow reducer, with specialized ledgers allowed only when their causal relation
to the workflow is explicit. Generated Markdown and dashboards must always be projections.

### 16.4 Admission and mutation are not atomic

`dispatch-preflight.mjs` reads context, schedule, capabilities, and risk and prints CLEAR. Claiming
the ticket happens later through another command. State can change between those operations.

The run ledger now has an exclusive lock, which is good. The board's `append()` still performs
read/verify/append without equivalent serialization. Other append-only writers implement their own
locking or no locking. There is no shared idempotency key, expected prior hash, or transaction ID.

Consequences:

- two valid preflights can race;
- independent logs can record only half of a logical transition;
- retry after timeout can duplicate an effect;
- concurrent appends can fork or corrupt a hash chain;
- recovery requires human interpretation.

The workflow kernel must expose one compare-and-append operation:

```text
evaluate policy against snapshot S
append event E only if current tip == S.tip and idempotency_key is new
return the committed event and derived state
```

### 16.5 Contracts are stringly typed and schemas are decentralized

The repository contains many `.../v1` objects, but validation is distributed as local `if` statements.
Important relations remain prose or scalars: feature, acceptance criteria, required evidence,
approvers, waiver subjects, paths, and founder decisions.

Consequences:

- `feature: "F-001,F-002"` looks plausible but is one invalid ID;
- `routes` versus `rules` is detected only when a tool executes;
- schema evolution has no migration registry or compatibility test;
- each CLI invents argument and root semantics;
- documentation can generate artifacts that validators reject.

The plugin needs a small schema registry with parsers, migrations, compatibility fixtures, and
generated examples. Markdown remains the human explanation; typed JSON/event objects carry the
machine contract.

### 16.6 Evidence proves files exist, not always what happened

The current branch materially improves runtime evidence and introduces a journey gate. That closes
the earlier evidence-optional screenshot defect. The larger provenance problem remains:

- acceptance criteria are not typed and mapped to exact evidence requirements;
- approval hashes a one-commit diff;
- gate results do not share one candidate-bound envelope;
- command, environment, tool version, actor, input snapshot, and artifact digest are not uniformly
  recorded;
- a mutable path can be mistaken for durable evidence unless its digest is captured at evaluation.

Evidence must be content-addressed and subject-bound. “The file exists” is necessary, not sufficient.

### 16.7 Policy detects risk but does not own enforcement

The risk router returns model, approvals, and required evidence. Ticket creation records only a risk
tier; review admission enforces only that high-risk work names an invariant. The required specialist
approvals and evidence are not carried into the work contract and checked at each decisive
transition.

This is a general pattern: tools emit advice while other tools make decisions. A policy decision
must be a durable object consumed by the mutation it governs, not console output the caller is
expected to remember.

## 17. Truth-status correction of the original findings

| Original area | Current status | Expert disposition |
|---|---|---|
| Runtime PASS without screenshot evidence | Fixed on the current branch | Keep its mirror test; remove from active backlog. |
| Missing semantic journey gate | Core gate now exists | Build platform drivers later; do not rebuild the gate. |
| Metadata count/version blindness | Fixed on the current branch | Retain anti-drift regression. |
| Stale evaluation narratives | Substantially fixed with lifecycle metadata | Continue lifecycle enforcement; no longer P0 architecture work. |
| Founder-intent amendment conflict | Confirmed | Repair with immutable snapshot plus decision events. |
| Nested/common-root ambiguity | Confirmed | Common project resolver and explicit project identity required. |
| Capability root semantics | Confirmed | Replace manifest-relative ambiguity with normalized project paths. |
| One-commit approval binding | Confirmed in `bindApprovalEvidence()` and `approval-check.mjs` | Work-candidate identity is P0. |
| Risk route advisory after dispatch | Confirmed | Policy-decision enforcement is P0. |
| Reverse requirement coverage | Confirmed | Typed bidirectional graph is P0. |
| Acceptance-to-evidence binding | Confirmed | Criterion evidence registry is P0. |
| Board/scheduler divergence | Confirmed | One workflow reducer is P0. |
| Scheduler owner/path contention | Confirmed | Add after atomic workflow kernel, not before. |
| Release candidate aggregate | Confirmed absent | Candidate/evidence kernel is P0. |
| Control-room candidate truth | Confirmed absent | Fix reducer first; UI follows. |
| Toolchain/project profile | Confirmed absent | Required before further platform-scale pilots. |
| Android accessibility depth | Confirmed | Platform adapter work, not workflow-kernel work. |

Pilot-specific operational errors—calling a script through the wrong launcher, low emulator disk,
and brittle raw ADB text entry—remain useful usability evidence but are not architectural P0s.

## 18. The measurable baseline

Do not use 6.6/10, 8/10, or 10/10 as an engineering acceptance test. Establish the baseline by
running a compact invariant suite over synthetic projects. The foundation is currently **NOT
ESTABLISHED** until all critical invariants below pass.

| Invariant | Current truth | Required proof |
|---|---|---|
| I-01 One project boundary | Fails nested/ambient-root scenario | Every mutation carries `project_id`; no write escapes resolved root. |
| I-02 One workflow truth | Fails board/scheduler scenario | Board, schedule, runs, and UI are projections of the same committed events. |
| I-03 Atomic admission | Not implemented | Two concurrent admissions produce one winner and one deterministic refusal. |
| I-04 Authenticated authority | Not implemented | A caller cannot invent a reviewer/founder role using `--by`. |
| I-05 Complete work identity | Fails multi-commit scenario | Approval binds base, head, complete diff, context, risk decision, and evidence set. |
| I-06 Candidate-bound evidence | Not implemented | Any relevant candidate change makes every affected verdict STALE. |
| I-07 Enforced risk route | Partially implemented | Wrong/missing specialist or evidence makes transition unrepresentable. |
| I-08 Bidirectional scope coverage | Fails orphan-requirement scenario | Every in-scope requirement is implemented, deferred, or rejected with authority. |
| I-09 Criterion-level proof | Not implemented | Completion cannot occur while one required criterion lacks current evidence. |
| I-10 Durable recovery | Partially implemented for runs | Retry is idempotent; crash recovery cannot duplicate or lose a transition. |
| I-11 One readiness reducer | Fails generated-view/candidate scenario | CLI and both UIs consume identical candidate-bound state. |
| I-12 Human-only publication | Passes | No executable path can submit or publish to a store. |

Report invariant pass counts, not an averaged maturity score. One failed critical invariant blocks a
“trustworthy autonomous team” claim regardless of how many documentation capabilities pass.

## 19. Foundation-first implementation program

This program intentionally precedes the broader enhancements in section 9.

### Kernel 1 — Identity, schema, and project boundary

Build:

- `project-profile/v1` with stable project ID, root, platforms, variants, toolchain and commands;
- `actor/v1`, `work-contract/v1`, `policy-decision/v1`, `gate-result/v1` and candidate schemas;
- one schema registry/parser with explicit migrations;
- one root resolver used by every command;
- shared CLI behavior and structured errors.

Do not yet build a new dashboard or orchestrator UI.

Acceptance: I-01 and schema compatibility fixtures pass; all existing valid v1 artifacts dual-read.

### Kernel 2 — Atomic workflow journal

Build:

- one event envelope with event ID, idempotency key, project, subject, actor, causation,
  correlation/run, schema version, timestamp, prior hash and payload;
- serialized compare-and-append with stale-lock recovery;
- one reducer for ticket, scheduling, run, review, QA and blocker state;
- adapters that read legacy board and schedule files without rewriting them;
- generated board/schedule views.

Acceptance: I-02, I-03 and I-10 pass under repeated concurrent tests and forced process death.

### Kernel 3 — Work candidate, policy, and evidence

Build:

- cumulative work candidate from base/head/merge-base and complete changed-file manifest;
- policy decision attached to the work contract;
- authenticated, role-separated approvals bound to the candidate;
- criterion/evidence registry with content hashes and execution provenance;
- invalidation rules for candidate, context, policy and evidence changes.

Acceptance: I-04 through I-09 pass, including adversarial bypass and mutation tests.

### Kernel 4 — Release candidate and readiness reducer

Build:

- immutable release candidate manifest and artifact provenance;
- common candidate-bound gate results;
- one readiness reducer with PASS, BLOCKED, CANNOT_EVALUATE, NOT_APPLICABLE and STALE;
- founder action/blocker events;
- read-only control-room and CLI projections from that reducer.

Acceptance: I-11 and I-12 pass. Every displayed statement links to its subject and evidence.

### Platform layer — only after the kernel

Then add:

- toolchain doctor and dependency/policy knowledge freshness;
- Android/iOS capability packs;
- journey drivers, permission matrices and accessibility adapters;
- signing and submission-dossier preparation;
- human founder handoff.

These are important, but implementing them before the kernel merely creates more unbound verdicts.

## 20. New engineering rules

1. **No broad dry run until Kernels 1–3 pass their invariant suites.**
2. **A dry run is a targeted experiment, never an app-building project.** It gets one hypothesis,
   one defect class, a fixed time/evidence budget, and a stopping condition.
3. **No finding enters the plan without current-tree reproduction.** Stale findings are archived,
   not repeatedly estimated.
4. **No score without an executable rubric and denominator.** Use invariant state and coverage.
5. **No new writer outside the workflow journal without an architecture decision.**
6. **No new schema without registry entry, compatibility fixture, and migration policy.**
7. **No gate output without subject identity and provenance.**
8. **No policy recommendation without enforcement at the governed mutation.**
9. **No control-room calculation that differs from the canonical reducer.**
10. **No automatic app-store publication.** Human submission remains a constitutional constraint.

## 21. Next action and stop condition

The next action is not another product pilot. It is to turn I-01 through I-12 into a committed
foundation conformance suite, confirm the current red/green baseline, and implement Kernel 1.

Stop Kernel 1 and reconsider the design if:

- legacy projects cannot be dual-read without destructive migration;
- project identity requires network infrastructure for local operation;
- actor attestation cannot distinguish trusted production approval from local insecure mode;
- schema additions force agents to hand-author large JSON objects;
- the design adds a second source of workflow truth.

Resume targeted operational experiments only when the invariant under test is named in advance and
the experiment is smaller than the fixture that proves it. This changes the team's learning loop
from “build another app and inspect what happened” to “attack one foundation claim and make the
result permanently reproducible.”
