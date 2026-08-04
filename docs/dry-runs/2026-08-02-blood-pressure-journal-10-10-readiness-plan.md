# Blood Pressure Journal — 10/10 readiness plan

Date: 2026-08-02  
Purpose: Define exactly what must be true before this project can be considered excellent across product, UX, architecture, implementation, safety, testing, store readiness, and AI-team execution.

## Executive definition

“10/10” does not mean the product is perfect or that the system publishes automatically. It means:

- no unresolved critical product, safety, privacy, architecture, or release risks remain;
- every requirement has an owner and verification evidence;
- every important user journey works on supported devices;
- health-data, accessibility, privacy, and legal boundaries have qualified review;
- the app is submission-ready for a human founder;
- the AI development workflow can produce that result through its own ticket, agent, review, escalation, and control-room machinery.

Publishing and store submission remain human-founder actions.

## Current baseline

The current dry run achieved:

- strategy and product brief;
- requirements, acceptance criteria, backlog, and architecture notes;
- Material 3 dashboard and reading-entry prototype;
- local persistence prototype;
- history and trend prototype;
- validation unit tests;
- successful debug build;
- successful APK installation and launch;
- successful dashboard visual inspection;
- successful dashboard-to-entry-form interaction.

The project is still a prototype. The current scores are recorded in [the expert audit](2026-08-02-blood-pressure-journal-expert-audit.md).

## 10/10 scorecard

### 1. Product strategy — target 10/10

#### Required outcomes

- Clear target users and validated problem statement.
- Explicit primary and secondary use cases.
- Complete happy paths, edge cases, failure states, and recovery flows.
- Documented non-goals: no diagnosis, treatment, medication advice, automatic publishing, or unsupported clinical interpretation.
- Product success metrics that do not incentivize unsafe behavior.
- Founder-approved scope, risk register, and release criteria.
- User research or usability evidence from representative users.

#### Required documents/evidence

- Product brief.
- PRD.
- SRS.
- Personas and user journeys.
- User stories and acceptance criteria.
- Risk register.
- Decision log/ADRs.
- Founder approval record.
- Research or usability-test summary.

#### Exit criteria

Every feature has a reason, owner, acceptance criteria, safety impact, and verification method. No ambiguous product decision is silently left to an implementation agent.

### 2. UX and Material 3 — target 10/10

#### Required outcomes

- Complete Material 3 design tokens and component rules.
- Dashboard, entry, edit, detail, history, calendar, trends, settings, privacy, export, and deletion flows defined.
- Loading, empty, error, offline, validation, success, and destructive-action states designed.
- Responsive layouts for supported screen sizes and orientations.
- Dark theme and dynamic text sizing considered.
- Minimum touch-target and focus-order checks completed.
- TalkBack/content-description/semantic-state review completed.
- Color is never the only state indicator.
- Chart has accessible text summary and understandable labels.
- Usability test completed with representative users.

#### Product-specific improvements

- Show the selected measurement date/time before saving.
- Provide standard back navigation from the entry form.
- Request numeric keyboards for numeric fields.
- Make deletion reversible where practical.
- Provide an understandable empty state for history and trends.
- Avoid chart labels that imply diagnosis or treatment.

#### Exit criteria

The UX reviewer signs off on all core states, accessibility review has no critical findings, and usability testing shows users can record, correct, review, export, and delete a reading without assistance.

### 3. Architecture — target 10/10

#### Required architecture

```text
Compose UI
  ↓ events/state
ViewModel/use cases
  ↓ domain commands
Repository interface
  ↓
Migration-capable transactional storage
  ↓
Versioned local data
```

#### Required outcomes

- Feature-based package/module structure.
- UI does not own persistence or business rules.
- Domain validation is platform-independent.
- Repository interface has a fake implementation for tests.
- Dependency injection is explicit and testable.
- Clock and dispatcher are injectable.
- Database schema is versioned.
- Migrations have automated tests.
- Corrupt-storage and write-failure behavior is defined.
- Data deletion semantics are explicit.
- No hidden network path or analytics dependency.
- Architecture decision records explain important tradeoffs.

#### Current prototype gaps to close

- Replace `SharedPreferences` JSON with migration-capable storage. Room is preferred only after an ADR confirms compatibility with the pinned AGP/Kotlin/KSP toolchain.
- Introduce `ReadingRepository`.
- Split the large activity file into screens/components/theme/chart/navigation.
- Add use cases for create, update, delete, export, and query-by-date.
- Add a test clock.
- Define failure states rather than silently returning an empty database on parse failure.

#### Exit criteria

The architecture review confirms that a new developer can add a feature without modifying unrelated screens, persistence can migrate safely, and all domain behavior can be tested without an emulator.

### 4. Implementation quality — target 10/10

#### Required behavior

- Create reading.
- Edit reading.
- Delete one reading with confirmation/undo.
- Delete all readings through an explicit privacy action.
- Export data in a documented, user-controlled format.
- Persist selected date/time correctly.
- Persist notes and context correctly.
- Restore data after process death.
- Handle empty, invalid, corrupt, and unavailable states.
- Keep all health data local unless a future founder-approved scope explicitly changes this.

#### Required engineering quality

- No placeholder behavior presented as complete.
- No misleading labels such as “now” when a user-selected date is expected.
- No silent data loss.
- No hard-coded test-only assumptions in production paths.
- Stable IDs and timestamps.
- Clear error messages and recovery actions.
- Structured logging without sensitive health-data leakage.
- Reviewable code ownership boundaries.

#### Exit criteria

All acceptance criteria pass against the production implementation, not only against isolated helper functions.

### 5. Health safety, privacy, and legal — target 10/10

This area requires qualified review. Engineering documentation alone cannot provide a legal or medical sign-off.

#### Required outcomes

- Product classification reviewed for every target market.
- Medical wording reviewed by a qualified reviewer.
- Privacy notice approved.
- Data collection and retention inventory completed.
- Local-storage and encryption decision recorded.
- Export/delete behavior documented.
- Android Data Safety answers prepared and reviewed.
- No unnecessary permissions.
- No analytics or remote health-data transfer without explicit founder approval and disclosure.
- Emergency wording reviewed.
- Store screenshots and description do not imply diagnosis or treatment.
- Health-data handling is included in incident and support procedures.

#### Safety rules

- Do not classify readings as safe/unsafe, normal/abnormal, or diagnostic without qualified product and medical review.
- Do not recommend medication, dosage, or treatment.
- Do not create alarm notifications without a reviewed clinical and legal basis.
- Do not imply that the app replaces a clinician.
- Keep the founder escalation path visible for unresolved health-safety questions.

#### Exit criteria

All legal, privacy, and medical review tickets are closed or explicitly accepted by the human founder with named owners and documented residual risk.

### 6. Testing and quality assurance — target 10/10

#### Test pyramid

1. **Unit tests** — validation, date conversion, averages, chart data, use cases.
2. **ViewModel tests** — state transitions, save failures, edit/delete, process recreation.
3. **Repository tests** — create/update/delete, ordering, corruption, migrations.
4. **Compose UI tests** — entry, validation, save, history, detail, delete, trends, empty states.
5. **Instrumented tests** — real database, process restart, rotation, back navigation.
6. **Accessibility tests** — semantics, labels, focus order, touch targets, font scaling, TalkBack.
7. **Screenshot tests** — key screens and states across themes/sizes.
8. **Performance tests** — large history, chart rendering, startup, memory.
9. **Security/privacy tests** — permissions, backup behavior, logs, exported data, sensitive content.
10. **Release tests** — signed artifact, manifest, versioning, packaging, store metadata completeness.

#### CI requirements

- Clean checkout build.
- Dependency lock/version verification.
- Static analysis and formatting.
- Unit and instrumentation tests.
- Screenshot verification.
- APK/AAB artifact generation.
- Machine-readable test reports.
- Failure links visible in the control room.
- No merge when required gates fail.

#### Exit criteria

Every acceptance criterion maps to an approved verification method and retained evidence. Automate deterministic engineering checks where practical; legal review, usability research, accessibility review, and founder approval may require qualified manual evidence. Known limitations remain visible rather than being hidden behind a passing build.

### 7. Store-submission readiness — target 10/10

#### Required founder handoff

- Reproducible release-candidate APK/AAB. Production signing uses founder-controlled credentials only and requires explicit human authorization.
- Reproducible build instructions.
- Version and changelog.
- Application ID and signing ownership record.
- App icon and adaptive icon.
- Store screenshots for supported devices.
- Short and long descriptions.
- Content rating answers.
- Privacy-policy URL.
- Data Safety answers.
- Permissions inventory.
- Health/privacy/legal review evidence.
- Accessibility statement.
- Support contact and incident path.
- Known limitations and residual-risk register.
- Human submission checklist.

#### Explicit boundary

The plugin prepares and verifies the submission-ready package. It may create unsigned or locally debug-signed verification artifacts and prepare release build configuration. Production keys remain in founder-controlled secret storage; final signing requires an explicitly authorized human/CI action. The human founder owns credentials, signing authority, final review, submission, store communication, and publication.

#### Exit criteria

The control room says “submission-ready for founder review,” not “published.” Any founder dependency appears as a separate actionable blocker.

### 8. AI development-team workflow — target 10/10

#### Required operating behavior

- Founder intent becomes a canonical project brief.
- Agents load current context before acting.
- Work is decomposed into traceable tickets.
- Tickets have owner, dependencies, acceptance criteria, status, and evidence.
- Agents claim only work allowed by role and dependency state.
- Agents communicate through durable messages.
- Conflicts are recorded and escalated using defined rules.
- Branch and commit strategy is enforced.
- PRs require appropriate reviewers.
- Review comments become tracked actions.
- Dependency/version/policy checks run before merge.
- Test and build evidence is attached to tickets.
- Blocked work is not falsely marked complete.
- Human-founder tasks are generated for legal, signing, store, and product decisions.
- Memory is compact, current, and linked to the project rather than copied blindly.
- Control room reports progress from evidence, not optimistic text.

#### Required roles

- Product owner.
- UX/accessibility specialist.
- System architect.
- Android implementer.
- QA/test engineer.
- Security/privacy reviewer.
- Dependency/toolchain reviewer.
- Code reviewer.
- Release-readiness reviewer.
- Human founder as final authority.

#### Required control-room views

- Overall progress percentage.
- Workstream progress.
- Current active ticket.
- Completed evidence.
- Open blockers.
- Human-founder actions.
- Dependency/version warnings.
- Policy/safety warnings.
- Last build/test result.
- Last reviewer decision.
- Store-readiness state.
- Explicit publish state: never automatic.

#### Exit criteria

The same project can be run from intent to founder handoff with minimal manual coordination, while every meaningful decision and blocker remains auditable.

## Master delivery gates

### Gate 0 — intent and safety

- Founder brief approved.
- Scope and non-goals approved.
- Health/privacy risk register created.
- Human-founder escalation rules active.

### Gate 1 — product and UX

- PRD/SRS/backlog complete.
- All journeys and states specified.
- Material 3 design and accessibility requirements reviewed.

### Gate 2 — architecture

- ADRs accepted.
- Persistence, security, failure, and migration strategies approved.
- Dependencies and versions verified.

### Gate 3 — implementation

- All P0/P1 feature tickets complete.
- No placeholder behavior remains in accepted scope.
- Code review approved.

### Gate 4 — verification

- Required automated tests pass.
- Emulator/device matrix passes.
- Accessibility and screenshot checks pass.
- No untriaged failures.

### Gate 5 — policy and release

- Privacy/legal/medical review complete.
- Dependency, policy, and manifest checks pass.
- Release artifact reproducible.
- Store packet complete.

### Gate 6 — founder handoff

- Control room shows submission-ready state.
- Founder blockers are separately listed.
- Signing, credentials, submission, and publishing remain human-owned.

## Master action plan for this project

| Priority | Action | Owner type | Evidence required |
|---|---|---|---|
| P0 | Persist selected date/time | Android | Unit, UI, persistence tests |
| P0 | Complete privacy/health/legal review | Founder + qualified reviewers | Signed review decisions |
| P1 | Replace JSON preferences | Android architect | Schema, repository, migration tests |
| P1 | Add edit and safe delete/undo | Android + UX | UI tests and acceptance evidence |
| P1 | Add export/delete policy | Product + privacy | Spec, UX, privacy decision |
| P1 | Add Compose/instrumented tests | QA | CI reports |
| P1 | Add accessibility verification | Accessibility + QA | Audit report and fixes |
| P1 | Improve chart semantics | UX + safety reviewer | Approved chart spec |
| P1 | Split monolithic UI code | Android | Reviewable package structure |
| P2 | Add screenshot and device matrix | QA | Baselines and device report |
| P2 | Add performance/corruption testing | QA + Android | Benchmark and recovery results |
| P0 | Run actual plugin workflow | Workflow owner | Board, messages, PRs, reviews, gates |
| P0 | Validate control-room reporting | Workflow owner | Screenshot/export of control-room state |

## Final 10/10 checklist

The project is 10/10 only when all answers are “yes”:

- Is the product purpose validated and unambiguous?
- Are all core journeys and failure states designed?
- Is the selected date/time correct and tested?
- Can users edit, export, and safely delete their data?
- Is storage migration-capable and recoverable?
- Are accessibility and privacy independently reviewed?
- Does every acceptance criterion have automated evidence?
- Does CI produce a reproducible release artifact?
- Are all health/legal decisions explicitly approved?
- Has the app passed supported-device and accessibility checks?
- Did real agents execute the workflow with durable evidence?
- Did reviewers and policy gates approve the work?
- Does the control room show blockers and founder dependencies accurately?
- Is the app submission-ready without being auto-published?

If any P0 remains open, the overall project cannot be 10/10 regardless of how polished the UI looks.

## Revised workflow-first execution order

1. Freeze and hash the current dry-run baseline.
2. Separate product, engineering, compliance/store, and AI-workflow scorecards.
3. Convert this plan into traceable tickets with dependencies, reviewers, gates, and evidence contracts.
4. Run the actual plugin workflow immediately and let agents claim approved work.
5. Let product, architecture, UX/accessibility, privacy, and safety roles produce missing specifications and founder escalations.
6. Correct date/time behavior and introduce production-grade persistence/test seams.
7. Implement edit, export, safe deletion, navigation, and recovery behavior.
8. Execute unit, integration, UI, accessibility, security, screenshot, performance, and device gates.
9. Generate an immutable release candidate with commit, artifact hash, environment, dependency state, and test evidence.
10. Require independent reviewer and policy verdicts.
11. Generate the founder submission packet.
12. Have the control room report either “submission-ready for founder review” or a precise blocker list.

Do not expand product scope until the workflow itself can execute and evidence the approved plan.

## Reviewer addendum — converting the charter into an executable plan

### Plan assessment

The document is a strong readiness charter but needs additional execution structure before agents can use it autonomously.

| Dimension | Assessment |
|---|---:|
| Readiness checklist | 8.5/10 |
| Strategic completeness | 8/10 |
| Executability | 6/10 |
| Measurability | 6/10 |
| Alignment with plugin purpose | 7/10 |

The primary correction is strategic: the Blood Pressure Journal is the test vehicle; the AI development team is the product under evaluation. The plugin workflow must therefore execute this plan rather than being tested after a single manually directed agent has completed it.

### Independent readiness verdicts

Do not reduce all dimensions to one average. The control room must maintain separate verdicts:

| Dimension | Allowed states | Meaning |
|---|---|---|
| Product | prototype / specified / validated / release-candidate | Product intent and user evidence |
| Engineering | unverified / buildable / tested / production-ready | Code, architecture, data and quality evidence |
| Compliance | not-reviewed / blocked / reviewed-with-risk / approved | Privacy, accessibility, legal and health-safety evidence |
| Store | not-ready / founder-actions-required / submission-ready | Submission-packet completeness |
| AI workflow | manual / assisted / autonomous-with-gates | How much team coordination required manual intervention |

The overall readiness verdict is constrained by the weakest mandatory gate. It must never be calculated as an average that hides a critical blocker.

### Executable ticket contract

Every action generated from this plan requires these fields:

| Field | Requirement |
|---|---|
| ID | Stable ticket identifier |
| Objective | Concrete outcome, not an activity-only description |
| Priority | P0/P1/P2 with reason |
| Owner | Role currently accountable |
| Reviewer | Independent approval role where required |
| Dependencies | Ticket IDs and external/founder dependencies |
| Gate | Delivery gate blocked or advanced by this work |
| Acceptance criteria | Traceable requirement/criterion IDs |
| Evidence contract | Exact outputs needed to claim completion |
| Evidence URI | Durable path to reports, artifacts, PRs or decisions |
| Candidate commit | Commit SHA against which evidence is valid |
| State | proposed / ready / active / review / blocked / done |
| Blocker | Specific impediment and escalation owner |
| Residual risk | Accepted limitation after completion |

An agent may claim a ticket only when its dependencies are satisfied and its evidence contract is understood.

### Health-data domain specification

Create a canonical data specification before production implementation. It must define:

- systolic and diastolic units;
- pulse unit;
- required and optional fields;
- timestamp, timezone and daylight-saving semantics;
- historical-entry behavior;
- duplicate-reading behavior;
- edit and updated-at semantics;
- supported measurement context;
- ordering and filtering rules;
- export schema and version;
- deletion, retention and recovery semantics;
- technical validation separately from clinically reviewed rules.

Technical numeric limits must not be presented as medical thresholds without qualified review.

### Privacy and security threat model

The security/privacy review must address at least:

- another person using an unlocked device;
- app content visible in recent-app snapshots;
- Android backup and restore behavior;
- rooted or compromised devices;
- database and export-file protection;
- temporary files and share-provider permissions;
- sensitive values in logs, crash reports or analytics;
- corrupt or partially written storage;
- lost devices;
- future cloud-sync implications;
- encryption-key ownership, rotation and recovery;
- accidental deletion and recovery expectations.

Encryption is an ADR decision based on the threat model, not a context-free checkbox.

### Production signing policy

- The plugin never independently creates, reads, exports or retains permanent store-signing credentials.
- Debug builds may use local debug signing.
- CI may sign a release candidate only through founder-controlled secret storage and an explicitly authorized workflow.
- The handoff records the artifact hash before and after signing, signing authority, version and provenance.
- Store upload, review responses and publication remain human-founder actions.

### Evidence provenance and freshness

Every gate result must record:

- project and ticket;
- commit SHA;
- branch or PR;
- tool and version;
- execution timestamp;
- environment/toolchain identity;
- pass/fail/block verdict;
- report location;
- artifact hash where applicable;
- expiry/staleness rule.

Evidence from an older commit becomes stale when affected files, dependencies, policy inputs or requirements change. The control room must not count stale evidence toward the current release candidate.

### Measurable quality policy

The project must approve measurable thresholds during planning. At minimum:

- zero unresolved P0 defects;
- zero unresolved P1 defects required by the release scope;
- zero unapproved critical/high security findings;
- complete requirement-to-verification traceability;
- clean build from a fresh checkout;
- migration tests from every released schema version;
- explicit supported API/device matrix;
- agreed startup, memory and large-history performance budgets;
- no critical accessibility findings;
- no dependency with unresolved license, policy or version status;
- reproducible release-candidate artifact and hash.

Thresholds must be project-specific and approved rather than invented by an implementation agent.

### Capability routing and separation of duties

The required roles describe capabilities, not necessarily ten simultaneous agents. Small work can combine compatible capabilities to reduce coordination overhead. Separation of duties remains mandatory where risk requires independence:

- the implementer cannot be the sole final reviewer;
- privacy/security approval should be independent from implementation;
- qualified medical/legal decisions cannot be simulated by an engineering agent;
- founder decisions remain human-owned;
- release verdicts must be based on retained evidence.

### Release-candidate identity

Every candidate evaluated by the control room requires:

- version and application ID;
- source commit SHA;
- dependency lock/version state;
- build environment fingerprint;
- APK/AAB hash;
- test evidence set;
- accessibility/privacy/policy verdicts;
- reviewer verdict;
- unresolved founder actions;
- residual-risk register.

### Recovery and rollback requirements

The plan must create and verify recovery procedures for:

- failed database migration;
- corrupt local data;
- interrupted write;
- accidental deletion;
- failed export;
- broken dependency update;
- bad release candidate;
- failed CI artifact generation.

Recovery behavior must be tested wherever it can affect user data.

### Locale and time requirements

Even for an English-only MVP, define and test:

- 12/24-hour formatting;
- locale-specific dates and numbers;
- timezone changes;
- daylight-saving transitions;
- right-to-left layout policy;
- unit display;
- localization review requirements for medical, privacy and safety copy.

### Control-room acceptance

The control room is accepted only when it can answer, for the current release candidate:

1. What is ready?
2. What evidence proves it?
3. What is blocked?
4. Which blockers require the founder or an external reviewer?
5. Which evidence is stale?
6. What changed since the previous candidate?
7. What is the latest reviewer verdict?
8. Is the app buildable, production-ready, or submission-ready?
9. Is any publishing action pending? The answer must always remain human-owned.

### Final reviewer verdict

This plan now describes both the quality destination and the operating controls needed to reach it. It should next be transformed into project tickets and executed through the plugin against the frozen Blood Pressure Journal baseline. The success criterion is not merely improved app code; it is a traceable, independently reviewed, evidence-backed founder handoff produced by the AI-team workflow.
