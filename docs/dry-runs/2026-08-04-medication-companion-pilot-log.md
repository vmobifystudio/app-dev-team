# Medication Companion — end-to-end plugin pilot log

Date: 2026-08-04  
Status: Operational evidence complete; product expansion intentionally paused
Plugin baseline: `main` at `b3676a3`  
Project: `dry-runs/medication-companion`

## Purpose

Run the current App Dev Team plugin through a fresh, moderately complex Android product from raw idea to submission-readiness assessment. The pilot tests the studio's process, not only whether Kotlin compiles.

## Product chosen

An offline Medication Reminder & Adherence Journal, working title **Dose Journal**. It supports medication schedules, reminders, taken/skipped logging, history, adherence summaries, local export/delete, and accessible Material 3 UI. It must not diagnose, recommend treatment, or automate store publication.

## Why this product

This example exercises:

- sensitive local data and privacy decisions;
- notification permission and reminder scheduling;
- time, date, locale, reboot, and daylight-saving edge cases;
- migration-capable persistence;
- dashboard, forms, history, charts/summaries, settings, export, and deletion;
- Material 3 and accessibility;
- policy, dependency, legal, medical-copy, and store-readiness gates;
- founder blockers and human-only submission tasks;
- ticket dependencies, leases, verification, independent review, QA, and control-room projections.

## Rules of the pilot

- Do not modify plugin source.
- Keep all project mutations under `dry-runs/medication-companion`.
- Keep all pilot findings in this report and its final companion audit.
- Use JDK 21 and the supplied Android SDK.
- Use cached dependencies only; install nothing externally.
- Build and test evidence must come from commands, not agent claims.
- Store upload and submission remain human-founder-only.

## Evidence checklist

- [x] Plugin baseline diagnostics
- [x] Founder intent and scope assumptions recorded
- [x] Product, requirements, UX, architecture, and release documents
- [x] Event-sourced board and schedule
- [x] Dispatch admission and durable claim identity
- [x] Team-channel question/answer evidence
- [x] Sufficient Android implementation to test the operating model
- [x] Unit/static/build evidence
- [x] Emulator launch and semantic journey evidence
- [x] Policy/dependency/privacy/accessibility gate observations
- [x] Candidate/readiness and control-room observations
- [x] Studio-learning and global revamp proposal
- [x] Comparative final audit

## Final audit

The operational findings, prioritized remediation plan, compatibility strategy, and acceptance tests are recorded in [Medication Companion Dry Run — Operational Audit and Global Revamp Plan](2026-08-04-medication-companion-operational-audit-and-revamp-plan.md).

The pilot stopped after sufficient operational evidence was collected. Remaining sample-app polish is intentionally out of scope; the next work should improve the plugin's cross-module truth and enforcement.

## Baseline observations

- Full plugin suite: 929 passed, 0 failed.
- `dispatch-preflight.mjs` exposed a capability-manifest path contract: `root` is relative to the manifest under `docs/team`, not the project working directory. A natural `"root": "."` therefore misclassifies `app` as `../../app`; the pilot required `"root": "../.."`.
- `board.mjs --feature` is scalar. Comma-separated feature IDs render plausibly but fail traceability as one undeclared ID; the pilot regenerated its unstarted board with a single primary requirement per ticket and retained the rejected setup as evidence.
- The pilot's generated `gradlew` initially delegated to global Gradle and silently ran 9.4.0 instead of pinned 9.1.0. A real wrapper plus official distribution checksum was required to restore reproducibility.
- `verify-done.sh` proved that a JVM test suite ran but could not prove it covered APP-101's repository-recreation acceptance criterion. Specialist review found the missing Android test and refused to equate generic green with criterion coverage.
- The Android integration-test APK compiles, but the local AVD cannot boot with only 1.3 GiB free disk. Runtime evidence is therefore CANNOT EVALUATE, not FAIL or PASS.
- Approval binding hashes one commit diff (`commit^..commit`), not the cumulative ticket/branch diff. A normal two-commit ticket cannot bind all of its code with the current event schema.
- Board and scheduler state are independent. After APP-101 merged with a runtime hold, the scheduler still required a manual `pending` → `complete` edit to unblock dependents; `complete` therefore ambiguously means dependency-integrated, not board-closed or fully verified.
- The scheduler offered APP-102 and APP-103 concurrently despite the same owner and overlapping app state. It enforces capacity/dependencies but has no owner-capacity or changed-path contention model.
- `impact-map.mjs` verifies that a changed path has a rule containing consumers; it does not prove those consumers were notified, reviewed, or approved.
- F-006 had no primary implementation ticket, yet trace remained green because it validates ticket → declared requirement but not requirement → implementation ticket coverage.
- A corrupted Gradle transform cache produced a misleading flood of unresolved Compose symbols. Cache refresh did not heal it; after daemon shutdown and deletion of only the generated 6.4 MB transform cache, unchanged dependencies resolved and the app built.
- Device hierarchy inspection found that root `testTagsAsResourceId` did not cross Compose dialog-window boundaries. Adding semantics to each dialog root exposed stable IDs for all critical fields/actions; a source-only review would likely have missed this.
- Raw ADB coordinate/text input raced with keyboard and Compose animation (only the first character reached the field). Runtime workflow evidence therefore needs Compose instrumentation or a semantic driver, not timing-sensitive shell input.
- High-risk reminder dispatch required reliability/QA approvals and runtime/permission evidence in `risk-router`, but the board still accepted one code-reviewer approval; risk requirements are advisory after dispatch rather than enforced at transition/release.
- APP-104 dispatch correctly refused because the generated test-automation capability allowed `app/src/test` but omitted Android's standard `app/src/androidTest` source set. The manifest needed explicit instrumentation-test authority before work could begin.
- Team doctor: coherent, 30 roles, 31 skills, 27 commands.
- Studio evaluation: 12/12 scored defects detected, zero clean false blocks.
- Previously reported metadata, stale-evaluation, candidate-identity, journey-gate, and control-room gaps remain open at pilot start.
