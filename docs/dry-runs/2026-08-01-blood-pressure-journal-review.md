# Blood Pressure Journal — end-to-end dry-run review

Date: 2026-08-01  
Scope: strategy → product definition → architecture → implementation → local build → emulator smoke check  
Plugin source modified: **No**. This is a separate fixture under `dry-runs/blood-pressure-journal`.

## Executive result

This was a materially richer workflow test than the earlier tiny app. The system produced a coherent health-product brief, requirements, acceptance criteria, backlog, architecture, safety boundary, Material 3 implementation, validation tests, APK, and emulator installation. The debug APK assembled successfully and unit tests passed.

It is not release-ready and should not be treated as a medical app or store-ready artifact yet. The most important gaps are selected-date persistence, lack of instrumented/UI coverage, JSON preference storage, missing edit/export/undo, and incomplete emulator visual verification.

## What was built

- Material 3 Compose dashboard with latest reading and 7-entry summary.
- Guided entry screen for systolic, diastolic, pulse, and notes.
- Field-level validation with bounded whole-number input and note length.
- Local history list with detail and delete.
- Trends screen with three labeled line series.
- Empty states and tracking-only health disclaimer.
- Offline JSON-backed local store; no network permission, accounts, analytics, or store publishing path.
- Founder-only release actions documented separately from engineering work.

## Evidence

Environment: JDK 21.0.12, Android SDK at `/opt/homebrew/share/android-commandlinetools`, Gradle 9.1.0, AGP 9.0.1, compileSdk 36, minSdk 26, targetSdk 35.

- `assembleDebug`: PASS, 36 actionable tasks.
- `test`: PASS, 3 unit tests.
- APK: `dry-runs/blood-pressure-journal/app/build/outputs/apk/debug/app-debug.apk`.
- SHA-256: `edd23e46a804e81609c64a27ef62c1b73ae7bb1f51e405fb3d46ed4267be6f06`.
- `adb install -r`: PASS.
- `am start -n com.mobify.bloodpressure/.MainActivity`: PASS.
- Process observed: `2620`; `topResumedActivity` was `.MainActivity`.
- The first capture showed the Android splash screen. A later capture/UI dump timed out while the emulator was using software graphics, so a clean post-splash visual pass is still open.

## Toolchain lessons captured

1. AGP 9 rejects the legacy Kotlin Android plugin unless built-in Kotlin is disabled.
2. KSP is incompatible with AGP 9 built-in Kotlin in the new DSL path.
3. Disabling built-in Kotlin and applying the Kotlin plugin then conflicts with AGP 9’s new DSL unless that DSL is also changed.
4. For this bounded fixture, a replaceable local JSON store was the safest way to continue without silently changing toolchain policy or downloading dependencies.
5. Kotlin 2.3 Compose compiler plugin is required for Compose backend generation; omitting it produced an internal compiler failure.

## What worked particularly well

- The strategy-first boundary prevented accidental medical advice and automatic publishing.
- The app had a real product shape rather than a screen-only demo: states, persistence boundary, validation, summary, history, chart, and founder handoff.
- The workflow created traceable requirements and tickets before implementation.
- Build failures became useful dependency/toolchain findings and were fixed in the fixture transparently.
- The runtime gate proved installation and launch rather than stopping at compilation.

## Findings and action priority

### P0 — release blockers

- **P0-1: Date picker is not persisted.** The selected date is UI-only; saved readings use `System.currentTimeMillis()`. Wire selected date/time into the domain command and test it.
- **P0-2: Health-data release review is absent.** Founder must approve privacy notice, deletion/export, data safety disclosure, accessibility, and medical/legal positioning.

### P1 — engineering quality blockers

- **P1-1: JSON preferences are not a production persistence strategy.** Add schema versioning, migration tests, atomic/concurrency-safe writes, and ideally Room after settling AGP/KSP configuration.
- **P1-2: No UI/instrumented tests.** Add Compose semantics tests for validation/save/history/delete/trends and a process-restart test.
- **P1-3: No clean post-splash visual verification.** Retry with a healthy emulator/GPU profile and add screenshot baselines.
- **P1-4: Edit flow is missing.** Detail currently supports delete only.

### P2 — product hardening

- Add export and explicit delete-all controls.
- Add undo/confirmation for deletion.
- Add deterministic clock injection and stable test fixtures.
- Revisit chart axes/legends with a UX and medical-safety reviewer.
- Add TalkBack traversal, font scaling, contrast, and touch-target checks.

## Overall rating

As a workflow and architecture dry run: **8/10**. As a store-submittable health app: **3/10**, intentionally, because the run stopped before legal, privacy, accessibility, persistence, and full test gates. As evidence that the development-team workflow can handle a more complex app: **strong pass with explicit follow-up work**.

## Recommended next run

Do not add more feature breadth yet. First close P0-1/P0-2 and P1-1/P1-3, then repeat the same trace/build/runtime gates. After that, add edit/export and run a founder review of the complete submission-readiness packet. Publishing remains a human-founder action.
