# Android small-app plugin dry run

**Run date:** 2026-08-01  
**Fixture:** `dry-runs/android-small-app`  
**Purpose:** Exercise the local app-development and submission-readiness path without external
installations, store credentials, store APIs, uploads, submissions, or rollout actions.  
**Model policy:** GPT-5.3-Codex high/xhigh was recommended for the pilot; this report records the
tool and plugin behavior, not a model-quality benchmark.  
**Terminal boundary:** stop before `READY FOR FOUNDER SUBMISSION` until the candidate, evidence,
founder-action ledger, and complete handoff package exist.

**Change boundary:** this run changed only the dry-run fixture and this report. No plugin source,
plugin command, plugin script, or control-room implementation was edited for these findings. Two
pre-existing modified plugin files were preserved untouched: `scripts/lib/project.mjs` and
`scripts/run-ledger.mjs`.

## Scope and fixture

The fixture is a deliberately minimal Java Android app:

- one `:app` module;
- one launcher `Activity`;
- one visible message: `Dry-run app is ready`;
- no network, persistence, authentication, analytics, payments, permissions, credentials, or store
  integrations;
- declared Android compile SDK 36, target SDK 35, minimum SDK 26 and Java 21;
- release note version `1.0.0`;
- no committed production Gradle wrapper binary—the fixture wrapper delegates to the locally
  installed Gradle command and is intentionally marked as a dry-run limitation.

The fixture was created to test both positive workflow behavior and honest blocker reporting. It is
not a claim that the app is ready for a store.

## Commands executed

All commands ran from the plugin repository root:

```text
node scripts/board-doctor.mjs dry-runs/android-small-app/docs/31-board.md
node scripts/dependency-check.mjs dry-runs/android-small-app
node scripts/version-consistency-check.mjs dry-runs/android-small-app
sh scripts/ship-gate.sh dry-runs/android-small-app
sh scripts/runtime-gate.sh --platform android --project-root dry-runs/android-small-app
node control-room/server.mjs --project dry-runs/android-small-app --port 4191 --no-actions
GET http://localhost:4191/state
```

The control-room server was run read-only. No action endpoint was enabled.

## Results

| Area | Result | Evidence |
|---|---|---|
| Board doctor | PASS | One ticket checked; board coherent |
| Dependency check | CLEAR with notes | No central `libs.versions.toml`; project policy was added during the workflow pass |
| Version consistency | BLOCKED | Canonical `1.0.0`, Android `versionName` is `1.0` |
| Ship gate | BLOCKED | Version mismatch and explicit QA HOLD |
| Runtime gate, first attempt | FAIL | Host Gradle invocation used the wrong JDK/environment and could not initialize native services |
| Runtime gate, pinned environment | FAIL / diagnostic conflict | App built and installed, but the gate said launch failed; manual `am start` returned OK and `pidof` showed a live process |
| Control-room server | PASS | Read-only server started and `/state` returned JSON |
| Control-room release projection | FALSE CLEAR | Mission Control showed release `clear` while ship gate was BLOCKED |

### Ship-gate output

```text
SHIP GATE
  BLOCKED  version-consistency-check found a release defect.
  BLOCKED  QA VERDICT: HOLD — local Android SDK and adb availability must be established before runtime evidence can be claimed.
  note     no event log ... this board has no chained history, so there is nothing to verify.

RESULT: BLOCKED — do not release.
```

This is correct behavior for the fixture.

### Runtime-gate output — initial environment

```text
RUNTIME GATE
  android  FAIL  ./gradlew assembleDebug failed (exit 1).

Gradle could not start your build.
Could not initialize native services.
Failed to load native library 'libnative-platform.dylib' for Mac OS X aarch64.

RESULT: FAIL — the app does not build or does not launch.
```

This was a genuine environment/toolchain failure, not a store-readiness waiver.

### Runtime-gate output — supplied pinned environment

With JDK 21, the supplied SDK, cached Gradle 9.1.0, AGP 9.0.1 and a booted `baby_growth_test` AVD,
the gate reported:

```text
RUNTIME GATE
  android  FAIL  assembles and installs, but com.example.smallapp does not launch.

RESULT: FAIL — the app does not build or does not launch.
```

Independent emulator checks immediately afterwards reported:

```text
am start -W -n com.example.smallapp/.MainActivity: Status: ok
pidof com.example.smallapp: 3523
```

The app therefore built and installed, and the process was alive when checked manually. This is a
runtime-gate detection discrepancy that must remain a finding until reproduced and explained.

### Local environment facts

```text
Java: 21.0.12 at the supplied Homebrew path
Gradle: cached Gradle 9.1.0 starts successfully when invoked with JDK 21
ANDROID_HOME: /opt/homebrew/share/android-commandlinetools, platforms 35/36 and build-tools 36 installed
adb: installed at $ANDROID_HOME/platform-tools/adb, daemon requires local socket permission
emulator: installed at $ANDROID_HOME/emulator/emulator
```

No external installation was attempted.

## Dry-run findings

### DRY-ANDROID-P0-001 — control-room release readiness falsely clears

The authoritative ship gate returned `BLOCKED`, but the `/state` payload projected Mission Control
release readiness as `clear` because the current control-room implementation only sweeps in-flight
tickets, static-only verification and S1/S2 bugs. It does not consume the ship-gate verdict, QA
verdict, version verdict, runtime verdict, candidate identity, artifacts, or founder actions.

This violates the control-room rule that a blocking gate must always win over a displayed clear
state.

**Required fix:** add a shared submission-readiness reader/reducer. It must consume structured
candidate-bound verdicts and make `READY`, `NOT READY`, and `CANNOT EVALUATE` identical in CLI,
dashboard, and control room. A missing or contradictory ship/runtime/version/QA verdict must never
produce `clear`.

### DRY-ANDROID-P1-002 — fixture has no event log and no durable run record

The control room correctly marked several sections unavailable because the fixture has no board
event log, roster, communications ledger, or round journal. The ship gate treated the absent board
event log as a note. This is acceptable for legacy compatibility but insufficient for the target
submission-readiness model.

**Required fix:** app-init/run must create the durable run, roster, event log, message ledger and
candidate scope before release preparation. The new readiness flow should treat them as required
for a trustworthy candidate, while clearly identifying legacy degraded mode.

### DRY-ANDROID-P1-003 — no candidate or founder handoff exists

The dry run produced no immutable candidate manifest, artifact hash, policy catalogue version,
structured verdict bundle, founder action ledger, or founder checklist. This is expected from the
current implementation and confirms the main audit finding: current `/app-ship` is a collection of
gates rather than a complete submission-preparation pipeline.

**Required fix:** implement the S1–S4 candidate, verdict, human-action and handoff artifacts from
the app-ship audit before claiming submission readiness.

### DRY-ANDROID-P0-004 — runtime gate reports launch failure while the app is demonstrably running

Under the pinned environment, the runtime gate successfully assembled and installed the APK, then
reported that the app did not launch. A direct `adb shell am start -W` returned `Status: ok`, and a
three-second `pidof` check returned a live process. The gate's launch/liveness detector and the
manual runtime observation disagree.

**Required fix:** preserve the command, package, device serial, launch result, liveness probe,
settle interval, process ID and logcat evidence in structured runtime evidence. Reproduce this case
with a minimal fixture before trusting either PASS or FAIL. A false FAIL is preferable to a false
PASS for release safety, but it still prevents the team from understanding whether the app is
actually ready.

### DRY-ANDROID-P2-005 — dependency governance is incomplete but honestly reported

The dependency check passed while noting no central version catalog and no engineering-principles
policy file. For this tiny fixture, no third-party runtime dependency exists, but Android Gradle
Plugin and SDK versions still need a governed source and candidate provenance.

**Required fix:** add the dependency/version catalogue and record JDK, Gradle, Android Gradle Plugin,
compile SDK, build-tools and signing/build configuration in the candidate manifest.

### DRY-ANDROID-P2-006 — QA correctly stopped the run before runtime evidence

The fixture intentionally recorded `QA VERDICT: HOLD` because Android SDK and `adb` could not be
verified. The ship gate correctly blocked instead of treating the missing runtime as a waiver or
assuming that compilation would be enough.

This finding applies to the first run. After the pinned environment and booted AVD were available,
the QA plan remained intentionally HOLD and was not silently rewritten by the runtime result.

## Workflow-first dry run

The pilot then shifted to the primary objective: validating the AI development workflow rather than
optimizing the final build. The workflow artifacts were created in the same fixture from the
repository-local command contracts and role-activation guidance.

### Artifacts created

- immutable founder brief, constraints, decisions and `MANIFEST.sha256`;
- vision and scope lock;
- requirements intake and Android product type;
- utility-tier Android roster with every role explicitly active, conditional or off;
- PRD with user stories, P0 acceptance criteria and feature map;
- SRS with functional and non-functional requirements;
- backlog;
- user flows, screen/state inventory, design tokens and component inventory;
- Android architecture and implementation specification;
- engineering principles, Git strategy and project `CLAUDE.md`;
- store-readiness inventory with founder-only actions;
- analytics boundary declaring no SDK or telemetry in this pilot;
- event-backed board with six tickets;
- append-only team message ledger and generated Markdown view;
- studio policy file enabling durable-run, approval, audit-anchor, prompt-registry and evaluation
  controls.

### Workflow results

| Workflow capability | Result | Evidence |
|---|---|---|
| Founder intent recording | PASS | Four files recorded and hash-verified |
| Roster activation | PARTIAL | Correct Android/utility states required manual correction of copied template wording |
| Requirements trace | BLOCKED | Tracer initially did not recognize plain feature-table IDs; it requires `[F-NNN]` declarations |
| Ticket planning | PASS / finding | Event-backed tickets were created with owners, dependencies, specs and acceptance |
| Owner validation | BLOCKED | `board-doctor` rejected APP-002 because `tech-lead` is not an implementation owner spawned by `/app-build` |
| Agent communication | PASS | Tech-lead question and tech-manager answer were recorded as MSG-0001/MSG-0002; answer named artifact and transition |
| State-machine discipline | PASS | `verified_static` allowed review/merge but refused closure without executable evidence |
| Intent graph | BLOCKED | Roster template prose containing `WAIVED:` triggered a founder gate; feature criteria were initially undeclared |
| Ship readiness | BLOCKED/CANNOT EVALUATE | Missing candidate controls, invalid owner, in-flight tickets, version mismatch and QA HOLD were surfaced |

### Workflow findings

#### DRY-WORKFLOW-P0-001 — generated roster prose can trigger a founder waiver gate

The copied roster template explained waiver semantics using the literal `WAIVED:` token. The intent
tracer scans project Markdown for that token and treated instructional prose as an actual waiver
requiring founder approval. The target roster had no waiver decision.

**Required fix:** distinguish structured waiver records from documentation examples. The tracer must
parse the release/waiver schema or ignore fenced examples, templates and instructional prose. Do not
solve this by deleting governance instructions from generated project documentation.

#### DRY-WORKFLOW-P1-002 — the tracer requires a stricter requirement declaration grammar than the PRD authoring flow makes obvious

Plain `F-001` feature-table rows were not recognized as declared requirements. The tracer requires
declarations such as `[F-001]`. It then correctly moved to the next missing layer and reported that
each feature lacked a sourced `[AC-NNN]` criterion.

**Required fix:** make the canonical PRD/SRS template use the exact trace grammar and validate it at
document creation time. The author should not discover the required syntax only after planning.

#### DRY-WORKFLOW-P1-003 — the planner can create a ticket owner the build loop cannot spawn

APP-002 was created with `tech-lead` as owner because the work was a domain/specification task.
`board-doctor` then correctly rejected it: `/app-build` only spawns implementation owners and the
ticket would never be picked up.

**Required fix:** either allow explicitly declared planning/specification owners in the sprint
workflow, or make `tech-manager` assign the ticket to a spawnable implementation role while keeping
tech-lead as reviewer/authority. The planner must validate owner spawnability at ticket creation,
not after the board is populated.

#### DRY-WORKFLOW-P1-004 — static verification cannot close a ticket

APP-002 moved through claim, static verification, review, approval, merge and QA, but `closed` was
refused because `verified_static` truthfully means the executable suite never ran.

**Assessment:** this behavior is correct and valuable. The workflow must surface the resulting
“merged, verification deferred” state clearly and create a follow-up owner/action rather than leave
the ticket stranded in `qa`.

#### DRY-WORKFLOW-P1-005 — control-room readiness does not consume workflow verdicts

The control room showed release readiness `clear` even when the ship gate was blocked. It also lacks
candidate identity, structured verdicts, founder actions and workflow completion state.

**Required fix:** use one submission/workflow reducer for CLI, dashboard and control room. The UI
must show `NOT READY` or `CANNOT EVALUATE` whenever the authoritative gate, trace, board, evidence or
founder-action sources are blocked or unavailable.

#### DRY-WORKFLOW-P2-006 — this run simulated role identities, not independent model processes

The durable artifacts record tech-lead, tech-manager, verification-engineer, code-reviewer and
qa-engineer actions, but this Codex session produced them sequentially. The pilot therefore proves
the artifact contracts and state transitions, not true parallel model isolation, retry escalation,
worktree separation or agent-context recovery.

**Required follow-up:** run the same workflow through the actual agent orchestration runtime or
GitHub-backed execution path and compare its records against this manually driven baseline.

## What completed end to end

The following parts of the local plugin workflow are operational for this pilot:

1. A small Android project can be scoped in the workspace.
2. The board can be parsed and validated.
3. Dependency inspection runs without external installation.
4. Version mismatches are detected.
5. QA HOLD is mechanically enforced by the ship gate.
6. Runtime execution is attempted and compiler/toolchain output is preserved.
7. The read-only control-room server starts without its frontend dependencies.
8. The control room reports missing source ledgers as unavailable in several sections.
9. The workflow can record a founder brief, create durable tickets, route a question/answer and
   enforce static-versus-executable verification state.
10. No publishing or store mutation path was invoked.

## Plugin regression baseline

The repository-wide regression suite was run with localhost binding permitted so the control-room
and dashboard HTTP tests could execute:

```text
884 passed, 2 failed
```

The two failures were the protected-`main` context-preflight assertions. They expected the test
fixture to be running on branch `main`, but this checkout is on a different branch, so the
assertions are branch-context-sensitive. No Android fixture failure was hidden by this baseline;
the fixture-specific results above remain independently recorded.

This is a plugin test-harness issue to fix separately: the protected-branch test should create or
explicitly select its own isolated branch context, or derive the expected protected branch from the
repository policy instead of assuming `main`.

## What did not complete

The app and workflow did not reach a trustworthy submission-ready state because:

- the runtime gate has an unresolved launch/liveness discrepancy even though manual checks showed a
  live process;
- version identity was inconsistent;
- QA explicitly held the run;
- no candidate aggregate was created;
- no store packet or founder checklist was created;
- no human-action ledger or candidate aggregate was created;
- control-room release readiness was not synchronized with the ship gate.

The correct terminal result for this run is:

```text
NOT READY — workflow evidence is incomplete; ticket ownership and intent-trace findings remain;
runtime evidence has a gate/manual-observation discrepancy; version mismatch and QA HOLD remain;
control-room readiness projection cannot be trusted.
```

## Recommended next run

1. Fix the tracer grammar/template false positives and add sourced acceptance criteria.
2. Fix ticket-owner validation and define how planning/specification work is represented.
3. Add the candidate, verdict, human-action and founder-handoff aggregates.
4. Repair the control-room false-clear path before trusting its progress or release status.
5. Reproduce and resolve the runtime gate launch/liveness discrepancy.
6. Run the workflow through the actual multi-agent orchestration/CI path and compare the durable
   records with this baseline.

No store credentials, store APIs, uploads, submissions, staged releases, or production actions are
needed for the next run.

## Local build and simulator verification — follow-up

The pinned local Android environment was later used successfully:

```text
JDK: 21.0.12
Gradle: 9.1.0
AGP: 9.0.1
Android SDK: /opt/homebrew/share/android-commandlinetools
compileSdk: 36
minSdk: 26
targetSdk: 35
AVD: baby_growth_test
```

### Build

```text
./dry-runs/android-small-app/gradlew -p dry-runs/android-small-app assembleDebug --console=plain
BUILD SUCCESSFUL in 9s
```

Produced artifact:

```text
dry-runs/android-small-app/app/build/outputs/apk/debug/app-debug.apk
Size: 822 KB
SHA-256: 57111df3b7bab2a3a757ae7130e85482384999bcb540bc407e52e3d45f748da1
```

### Simulator

The exact APK was installed on `emulator-5554` and launched:

```text
Performing Streamed Install
Success
Status: ok
LaunchState: COLD
Activity: com.example.smallapp/.MainActivity
PID: 2093
topResumedActivity: com.example.smallapp/.MainActivity
```

A 1080×2400 PNG screenshot was captured and visually confirmed the visible text:

```text
Dry-run app is ready
```

This proves the local fixture can build, install and launch under the supplied pinned environment.
It does not change the workflow conclusion: the app is still not submission-ready because the
workflow candidate, evidence bundle, QA journey, legal/store packet and founder handoff are not yet
complete. The earlier runtime-gate launch discrepancy remains a separate detector finding because
the manual launch succeeded while the gate reported FAIL.
