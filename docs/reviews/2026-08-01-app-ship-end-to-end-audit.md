# `/app-ship` End-to-End Release-System Audit

**Audit date:** 2026-08-01  
**Scope:** command contract, submission-readiness authority, candidate identity, evidence, executable
gates, platform packaging, store handoff material, founder dependencies, control-room visibility,
waivers, tests, and documentation  
**Base revision:** `3b3d75d7f7cf62349473b070ec2a71d442411531` plus the captured uncommitted
working tree  
**Mode:** read-only implementation review; no release code changed by this audit

---

## 1. Executive verdict

`/app-ship` is strategically thoughtful, but its name, role contracts, and implementation currently
cross the product's intended authority boundary.

### Ratified authority boundary

The plugin does **not** publish or submit Android or iOS apps. It does not upload to TestFlight, App
Store Connect, Play internal testing, closed testing, production, or any other store channel. It does
not promote, halt, resume, or widen a rollout. It does not hold store publishing credentials.

Its terminal responsibility is:

> Produce an independently audited, submission-ready app package with every applicable technical,
> product, policy, dependency, privacy, security, legal/compliance, metadata, evidence, and store
> requirement complete—or give the founder one explicit, owned list of blockers and human actions.

The founder performs every store-console action and is the only submission authority.

Its strongest ideas are correct:

- release is a human authority boundary;
- inability to evaluate is not success;
- the release actor must not audit itself;
- the product must be built and launched;
- evidence, security, privacy, reliability, and store readiness must be explicit;
- the founder needs a precise submission handoff and manual checklist;
- unresolved human dependencies must be first-class work, not buried in agent prose.

The implementation does not yet compose those ideas around one immutable submission candidate. It
also instructs `release-manager` to upload and manage staged rollout, which is now explicitly outside
scope. Several machine gates fail open under realistic inputs, and the control room cannot yet show
submission readiness or founder dependencies end to end.

### Rating

| Dimension | Rating | Assessment |
|---|---:|---|
| Submission-readiness strategy | **8.2/10** | Strong separation, evidence, three-state truth, runtime, and assurance instincts |
| Command and role contract consistency | **5.8/10** | Important authority and sequencing contradictions remain |
| Executable pre-release enforcement | **5.2/10** | Strong individual checks, but confirmed fail-open paths affect authoritative state, QA, versions, and waivers |
| Candidate and artifact integrity | **3.8/10** | No canonical candidate manifest; checks run before the release artifact exists |
| Store handoff and founder boundary | **3.5/10** | Current role still uploads; no complete founder-ready handoff package or human-action queue exists |
| Control-room submission visibility | **3.8/10** | Current release panel covers tickets/static tests/bugs only; no readiness score or gate/action breakdown |
| Test confidence for `/app-ship` itself | **4.5/10** | 860 assertions pass, but no true end-to-end release rehearsal and the reproduced failures are uncovered |

**Overall realized submission-readiness maturity: 5.0/10.**

Do not activate autonomous store publishing at all; it is outside product scope. The present command
is usable only as a supervised preparation checklist until it freezes an exact candidate, validates
the upload-ready artifacts and complete store packet, and presents the founder with a trustworthy
ready/not-ready decision and action list.

---

## 2. What was reviewed

### Command and authority

- `commands/app-ship.md`
- `commands/app-run.md`, `commands/app-build.md`, and `commands/app-incident.md`
- `agents/release-manager.md`
- `agents/release-auditor.md`
- `agents/verification-engineer.md`
- security, privacy, reliability, red-team, ASO, analytics, and QA role contracts
- `docs/03-decision-rights.md`
- `docs/24-repository-controls.md`
- role activation and team-protocol rules

### Executable controls

- `scripts/ship-gate.sh`
- `scripts/runtime-gate.sh`
- `scripts/ship-inflight.mjs`
- `scripts/approval-check.mjs`
- `scripts/audit-anchor.mjs`
- `scripts/version-consistency-check.mjs`
- `scripts/dependency-check.mjs`
- `scripts/policy-check.mjs`
- product/security/privacy/analytics/subscription detectors
- `scripts/release-health.mjs`
- incident and memory ledgers
- repository-control checks
- board/event reducers and capability matrices

### Assurance and delivery infrastructure

- all release-related fixtures and evaluation cases;
- release assertions in `scripts/test.sh`;
- `checks.yml`, `mutation-full.yml`, and `runtime-gate.yml`;
- handbook, README, plugin metadata, revamp plans, and previous review findings;
- current Apple build-upload guidance and Google Play track/staged-rollout contracts.

---

## 3. Intended submission-readiness flow

The documented flow is approximately:

```text
completed implementation
  → board doctor
  → ship gate
  → runtime gate
  → parallel independent readiness reviews
  → release-preparation role creates exact submission candidate
  → release-auditor independently audits evidence
  → submission-readiness aggregator computes status and blockers
  → control room shows readiness, evidence coverage and human dependencies
  → founder receives candidate package + manual store checklist
  → PLUGIN TERMINATES AT `READY FOR FOUNDER SUBMISSION`

founder, outside plugin authority
  → signs in to the store
  → reviews declarations and final package
  → uploads/submits manually
  → owns store review, phased/staged release and production decisions
```

This is the required lifecycle. “Candidate” is currently a sentence in an agent handoff rather than
a durable object around which every check and founder action is bound.

### The missing architectural center

The flow needs one immutable `ReleaseCandidate` aggregate:

```text
ReleaseCandidate
  id
  source commit + tree
  integration base
  release version + platform build numbers
  platform/product/store-package scope
  signed artifact hashes
  build configuration and toolchain versions
  policy/context/prompt versions
  ticket and approval set
  test/evidence bundle manifest
  security/privacy/reliability/store verdicts
  waivers, N/A decisions, owners, scope, and expiry
  audit verdict
  founder-owned outstanding actions
  submission-ready verdict + audit timestamp
  manual handoff manifest and checksums
```

Every gate must read this identity, and any material mutation must create a new candidate requiring
new evidence and authorization.

---

## 4. What is already strong

### 4.1 Three-state truth is consistently understood

Both `ship-gate.sh` and `runtime-gate.sh` distinguish `CLEAR/PASS`, `BLOCKED/FAIL`, and
`CANNOT EVALUATE`. Missing toolchains and unreadable evidence are not silently promoted to success.
This should remain the constitutional behavior of the release system.

### 4.2 Independent release audit is the correct authority split

`release-manager` performs release work; `release-auditor` reads source artifacts and can block. The
auditor is read-oriented and explicitly refuses a release-manager summary as evidence. This is a
good separation-of-duties model.

### 4.3 The runtime gate tests liveness, not only compilation

The runtime gate detects build, install, launch, and immediate process death. It has explicit
timeouts, preserves useful build-log tails, handles ambiguous Xcode schemes conservatively, and has
a real macOS mirror test for crash-on-launch versus a repaired app.

### 4.4 The release gate contains several mature defect tripwires

The board parser is centralized for in-flight and bug checks. The gate catches static-only
verification, masked CI failures, missing `pipefail`, undeclared workflow installations, high-severity
bugs, audit-chain damage, and applicable product defects.

### 4.5 Server-side controls are described honestly

`repo-controls.sh` correctly recognizes that local agent policy cannot protect credentials from an
agent with Bash. Protected branches, required review, required checks, environment approval, and
secret scanning are the correct enforcement layer.

### 4.6 Founder-facing store guidance reflects current platform models

Apple supports phased App Store releases, and Google Play models staged production releases using
an `inProgress` status and `userFraction`, with explicit halt and completion states. The strategy to
start small, measure, halt quickly, and widen deliberately is sound as guidance for the founder's
manual post-submission decisions. It must not become plugin automation, a plugin-owned rollout
state machine, or a reason for the plugin to hold publishing credentials.

Official references:

- [Apple — Upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [Google Play Developer API — tracks and staged rollouts](https://developers.google.com/android-publisher/tracks)
- [Google Play API — release status and userFraction](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks)
- [fastlane — upload_to_play_store](https://docs.fastlane.tools/actions/upload_to_play_store/)

---

## 5. Confirmed P0 findings

### SHIP-P0-001 — the authoritative event log can say `todo` while the release gate returns `CLEAR`

The architecture declares the event log authoritative and Markdown a generated projection.
`ship-gate.sh` verifies the event log's hash chain, but it evaluates board state from
`docs/31-board.md` through `board-doctor` and `ship-inflight`.

An isolated reproduction created an intact event log containing one `todo` ticket, replaced only
the Markdown projection with a shippable board, and ran the gate:

```text
board.mjs show --json: LIVE-001 status = todo
board.mjs verify: AUDIT CHAIN intact
ship-gate.sh: RESULT CLEAR
```

This is a direct source-of-truth violation. A stale, edited, or incorrectly rendered Markdown board
can authorize a release while authoritative work remains unfinished.

**Required correction:** derive all release state from the event log when it exists. Verify that the
Markdown projection exactly matches a fresh render, or treat the projection as display-only. Legacy
Markdown-only mode must be explicit, degraded, and human-authorized—not an ordinary clear path.

### SHIP-P0-002 — there is no exact release candidate; gates evaluate a different thing from handoff

The ship and runtime gates run before `release-manager` chooses/confirms the version, mutates
manifests, creates release notes, builds release artifacts, and tags the commit. The independent
readiness agents also run before the optional version is resolved, although their report templates
name a versioned candidate.

The runtime gate builds:

- iOS `Debug` for the simulator;
- Android `assembleDebug` and the first matching debug APK.

The release manager later builds:

- an iOS `Release` archive/export;
- an Android release AAB.

Therefore runtime evidence is not evidence about the artifact being handed to the founder. The release auditor
requires an artifact-hash match, but no producer creates a canonical artifact/evidence manifest and
no script verifies one.

**Required correction:** prepare and freeze the release candidate first. Build release artifacts in
a controlled pipeline, record hashes and provenance, then run every applicable gate against that
candidate or a demonstrably equivalent artifact from the same signed build graph.

### SHIP-P0-003 — the release actor violates the product's no-publishing boundary

`/app-ship` asks the human to confirm an upload. The spawned `release-manager` role says “You ship,”
owns store upload, reads upload credentials, invokes App Store/Play tooling, assigns testing tracks,
and later controls rollout. All of these actions are outside the ratified plugin scope.

The local credential guidance also expands the attack surface without helping the core product. A
plugin that never submits does not need App Store Connect or Google Play publishing credentials at
all.

**Required correction:** remove deployment from the plugin mechanically:

1. Rename/re-charter the role as `release-preparer` or `submission-readiness-manager`.
2. Remove upload, submit, promote, halt, resume, staged-rollout, and store-credential commands.
3. Produce signed/upload-ready artifacts where safely possible, or a precise founder signing action
   where human-held signing material is required.
4. Produce a manual founder submission runbook and checksum manifest.
5. End in `READY FOR FOUNDER SUBMISSION` or `BLOCKED`, never `uploaded`, `submitted`, or `released`.

### SHIP-P0-004 — an explicit QA `HOLD` is only a note and the executable gate clears

`app-ship.md` says a QA hold must stop release. `ship-gate.sh` searches for `hold`, `do not ship`,
`not shippable`, or `blocked`, but calls `note()` rather than `block()`.

Reproduction:

```text
docs/50-test-plan.md: Recommendation: HOLD — composition journey failed
ship-gate.sh: note QA text mentions a hold
ship-gate.sh: RESULT CLEAR
```

The orchestrator is expected to read the note and stop, but the machine gate's exit code—the result
CI and automation consume—authorizes continuation.

**Required correction:** replace prose searching with a structured QA verdict and make `HOLD` a
blocking state. Unknown/malformed/missing verdict is `CANNOT EVALUATE`.

### SHIP-P0-005 — waivers are global, permanent, weakly attributed, and not candidate-scoped

`waiver_for()` scans all of `docs/60-releases.md` and accepts the first matching artifact with any
non-empty “who” and reason. It does not bind to:

- release version or candidate;
- date or expiry;
- platform or channel;
- policy version;
- authenticated human identity;
- founder decision record;
- the specific failed check/evidence state.

An old waiver under `v0.1.0` for a missing bug board was accepted for a new `v9.0.0` release and the
gate returned `CLEAR`. The ship gate does not invoke the trace check that `/app-ship` says enforces a
matching founder decision. A line naming `release-manager` would also satisfy the parser despite the
human-only contract.

**Required correction:** use a structured waiver artifact with immutable ID, candidate ID, exact
control, scope, human principal, reason, approval timestamp, expiry, and evidence. Release
authorization verifies it cryptographically or through the protected environment; free-text release
notes become a projection.

### SHIP-P0-006 — documented release versions bypass the version gate

The release-manager's required release-note format is:

```text
## vX.Y.Z — YYYY-MM-DD
```

`version-consistency-check.mjs` only recognizes text such as `version: X.Y.Z`. `ship-gate.sh` only
invokes the checker when that separate pattern is present. A fixture with `## v1.2.3` and an iOS
manifest at `9.9.9` returned:

```text
ship-gate.sh: CLEAR
version-consistency-check.mjs: CANNOT EVALUATE — no canonical version
```

Even with a recognized version, the checker returns clear when it discovers no platform version
values. It does not validate build numbers, tags, branch identity, artifact metadata, or the version
that will be created after the gate runs.

**Required correction:** version comes from the release-candidate manifest, not parsed prose. Require
each active platform's version/build identifier and compare it with the built artifact, source
manifest, tag, release record, and store request.

---

## 6. Confirmed P1 findings

### SHIP-P1-001 — approval binding is neither exact nor enforced at release

`approval-check.mjs` accepts the approved commit when it is an ancestor of the supplied HEAD, although
role documentation promises exact-commit binding. `ship-gate.sh` does not pass `--head` at all.
Evidence and context paths are not recorded, so only field presence—not current content—is checked.
The studio evaluation still reports stale approval as having no detector.

The release gate must require approvals for the exact candidate tree and evidence manifest.

### SHIP-P1-002 — release health trusts unproven caller-supplied metrics

`release-health.mjs` is a useful three-state primitive, but the values carry no source, timestamp,
window, sample size, platform, version, candidate, ramp step, or telemetry query. Any caller can type
the desired numbers.

Policy overrides are not schema-validated. This policy:

```json
{"releaseHealth":{"minCrashFreeRate":"not-a-number","maxP0Count":"not-a-number"}}
```

made `0` crash-free rate and `99` P0 incidents return `RELEASE HEALTH: CLEAR` because JavaScript
comparisons against non-numeric thresholds are false.

The gate also does not check the product funnel target described by the release-manager role.

### SHIP-P1-003 — rollout logic is out of scope and obscures the true terminal state

The default ramp and release-health logic belong to the founder's post-submission operating runbook,
not the plugin's autonomous authority. Keeping them in the release-manager charter implies the agent
may control store rollout and makes “complete” ambiguous: submission-ready, uploaded, internally
available, or fully released.

Move rollout advice into a founder-facing, non-executable playbook generated with the handoff. If a
future product explicitly adds human-operated post-submission tracking, it must remain a read-only
projection of founder-recorded store state and must never mutate store state.

### SHIP-P1-004 — runtime evidence is mutable and can be absent on a pass

Evidence uses `runtime-<date>-<platform>.png`, so repeated runs on one day overwrite the prior
artifact. The name contains no candidate, commit, artifact hash, device, OS, scheme/flavor, or run
identity. The runtime gate still returns `PASS` when screenshot capture fails.

The screenshot proves a process rendered one frame, not the P0 journey. The skill recommends journey
automation when available, but `/app-ship` does not require structured journey evidence.

### SHIP-P1-005 — platform/product/package scope is inconsistent

The command reads role activation and supports N/A, but its final confirmation always asks for
“TestFlight + Play internal track.” It can therefore ask for an inactive platform and violates the
no-submission boundary. ASO may be waived because no store submission is happening while the same
command later asks for store upload.

Candidate scope must explicitly name active products, platforms, applications, target stores,
regions, package types, and required metadata. Every check and founder action derives applicability
from that scope.

### SHIP-P1-006 — readiness verdicts are prose outputs, not one validated schema

Security, privacy, reliability, red-team, verification, ASO, analytics, QA, and release audit use
slightly different output vocabularies. Some roles return `PASS/FAIL`, ASO returns
`READY/BLOCKED`, data analyst has no explicit release verdict, and N/A/CANNOT-EVALUATE behavior is
partly invented by `/app-ship` rather than owned by the role contract.

No executable aggregator validates that every applicable role produced a fresh verdict for the
candidate. A stale report file can look current unless the auditor notices manually.

### SHIP-P1-007 — the independent auditor has no machine-verifiable evidence bundle

The release-auditor checklist is good, but the auditor must manually infer candidate identity,
artifact hashes, version, tag, evidence freshness, and waiver validity. Its one-line result is parsed
conceptually by the orchestrator; no command enforces report schema or candidate binding.

`PASS WITH NOTES` is accepted without a rule distinguishing acceptable notes from unresolved
critical uncertainty.

### SHIP-P1-008 — repository controls are not prerequisites of submission readiness

Security-reviewer checks repository controls later, but the ship gate does not require them. The
configured required contexts include `checks` and `mutation`, but not necessarily the lab, full
mutation catalogue, or macOS runtime-gate job.

Protected source and required independent checks are still relevant before declaring a package
submission-ready. Production environments and publishing secrets are not: the plugin must not hold
or use them.

### SHIP-P1-009 — the founder handoff package is undefined

There is no canonical, founder-consumable package defining exactly what is ready, where it is, how it
was built, which checks apply, which declarations are complete, and which actions remain human-owned.

The handoff should include candidate manifest, artifact checksums, version/build numbers, signing
status, validation evidence, screenshots, listing metadata, privacy/data-safety answers, legal and
compliance declarations, known issues, waivers, support/review information, exact manual steps, and
founder acknowledgements. Build-number uniqueness and collision recovery must be settled before the
ready verdict.

### SHIP-P1-010 — rollback, migration safety, and compatibility are not candidate gates

The release-manager correctly notes that mobile versions generally cannot be un-shipped. However,
`/app-ship` does not require:

- a rollback/forward-fix runbook tied to the candidate;
- database expand/contract compatibility;
- old-client/new-server and new-client/old-server compatibility;
- feature-flag or kill-switch validation;
- backup/restore rehearsal for destructive migrations;
- rollback ownership and communication criteria.

These should be risk-triggered candidate requirements, not universal prose.

### SHIP-P1-011 — post-submission incident command should be separated from readiness

The new conditional incident-commander is directionally useful for projects that bring production
signals back to the studio. It is not part of the core submission-readiness terminal path. The
decision-rights document also says incident command belongs jointly to release-manager/tech-manager
“today,” while the new role says it is already authoritative.

If retained as an optional aftercare feature, one canonical incident aggregate should own state and
the founder should explicitly report the production signal. The plugin must not imply it controls
store rollout or production response.

### SHIP-P1-012 — full passing tests do not certify the release journey

The captured suite passed **860 assertions with 0 failures**. The studio laboratory caught 12/12
scored defects with 0/3 false blocks. Those are meaningful strengths.

However:

- `/app-ship` command tests primarily assert that required sentences remain in Markdown;
- no test executes the complete command/role/founder-handoff lifecycle;
- no test covered event-log/Markdown disagreement;
- no test covered an executable QA HOLD;
- no test covered historical waiver reuse;
- no test covered the release-note version format;
- no test covered malformed release-health thresholds;
- stale approval remains explicitly outside the evaluation denominator;
- no golden fixture proves a complete iOS/Android submission-ready package and founder action list.

The green suite is a strong component regression signal, not a release-system certification.

---

## 7. P2 quality and maintainability findings

1. `ship-gate.sh` suppresses detector output and replaces it with a generic message, requiring a
   second manual run to recover evidence.
2. Several optional detectors run only when a triggering document exists, so a missing document can
   suppress the check rather than produce an applicability decision.
3. The event-log absence path is a note even though a legacy Markdown board can contain inferred,
   unattributed approvals.
4. Release version extraction is layout-specific and misses common generated/project configurations.
5. The release-manager hardcodes common repository layouts that do not cover many modern iOS,
   Android, monorepo, flavor, and multi-app structures.
6. `xcodegen` is installed unpinned in runtime CI; release-tool versions and supported-platform
   requirements are not captured in candidate provenance.
7. Runtime timeouts kill only the direct child; Gradle/Xcode subprocesses can survive.
8. `runtime-gate.sh` makes the Gradle wrapper executable, mutating the project during verification.
9. Store metadata constraints and regional/compliance requirements are not versioned as policy.
10. The handbook says `/app-ship` has never run end to end while other sections describe individual
    release gaps as closed; capability status needs one generated source.
11. Studio-eval says the macOS runtime job lives in `checks.yml`; it is actually in
    `runtime-gate.yml`.
12. The externally installed release-management skill is generic and contains examples with weak
    evidence claims such as an 89% integration success rate described as release-ready. The plugin's
    stricter local release philosophy must take precedence.

---

## 8. Control-room audit for submission readiness

### 8.1 Current control-room strengths

The control room has a sound projection philosophy:

- it stays optional and does not become a second workflow authority;
- state readers are shared with the zero-dependency dashboard;
- `attention`, `clear`, `info`, and `unavailable` remain distinct;
- source availability and log integrity are always visible;
- Founder Inbox recommendations must be quoted from durable state rather than invented by the UI;
- actions use one validated CLI whitelist and print refusals verbatim;
- stale SSE state is surfaced rather than silently showing yesterday's clear result.

These principles should be preserved.

### 8.2 Current release visibility is insufficient

Mission Control's “Release readiness” currently sweeps only:

- in-flight board tickets;
- static-only verification;
- open S1/S2 bugs.

It does not read or display candidate identity, platform artifacts, store package contents, policy,
dependencies, versions, legal/compliance declarations, reviewer verdicts, evidence freshness,
waivers, signing state, metadata, screenshots, or founder dependencies. The phase always ends at
“sprint closed — release not yet gated” because no release-readiness state exists.

Founder Inbox currently derives blocked tickets, founder-directed questions, and escalations. It has
no canonical human action model for submission preparation. A missing App Store agreement, privacy
URL, tax decision, content-rights declaration, or signing action therefore appears only if an agent
happens to phrase it as a message.

### 8.3 Add a sixth screen: Submission Readiness

Do not overload the Board or Mission screens. Add a dedicated screen between Board and Founder
Inbox:

```text
Mission · Communications · Board · Team · Submission · Founder Inbox
```

The Submission screen should contain:

1. **Candidate identity** — candidate ID, source commit/tree, version/build numbers, product,
   platforms, target stores, created time, freshness and invalidation status.
2. **Submission readiness status** — `READY FOR FOUNDER SUBMISSION`, `NOT READY`, or
   `CANNOT EVALUATE`. Never use “released” or “shipped.”
3. **Readiness progress** — deterministic coverage of applicable controls, with numerator and
   denominator visible.
4. **Blocking findings** — severity, control, owner, exact remediation, evidence, dependency and
   age.
5. **Founder dependencies** — actions only a human can perform or decide.
6. **App-team work** — remediations assigned to activated roles, linked to board tickets.
7. **Platform package inventory** — IPA/archive/AAB or signing-ready output, checksums, version,
   build number, validation and location.
8. **Store packet inventory** — listing copy, screenshots, icons, privacy/data-safety answers,
   legal/compliance answers, URLs, review notes, release notes and localization coverage.
9. **Evidence and freshness** — gate verdicts, artifact refs, evaluated time, expiry, candidate
   match, waived/N/A status.
10. **Founder handoff** — generated checklist, package location, checksums, known issues, waivers,
    and exact manual store steps.

### 8.4 Progress-bar semantics

A progress bar is useful only if it cannot manufacture confidence.

Use two explicit measures:

```text
completion = (PASS + valid founder-approved WAIVED) / applicable controls
evidence coverage = controls with fresh candidate-bound evidence / applicable controls
```

Rules:

- `NOT_APPLICABLE` is excluded from the denominator and shown separately with its reason.
- `CANNOT_EVALUATE`, missing, stale, blocked, or pending-human counts as incomplete.
- a waiver may advance completion but is colored amber and never displayed as a pass.
- one critical blocker keeps the headline `NOT READY` even if progress is 99%.
- if applicability cannot be computed, show no percentage; show `CANNOT EVALUATE`.
- show raw counts beside every bar, for example `31/38 complete · 29/38 evidence-backed`.
- the percentage measures checklist coverage, not product quality, confidence, time remaining, or
  probability of store approval.

Suggested sections:

```text
Overall submission readiness       82%  31/38
Technical and artifact             90%   9/10
QA and runtime                     75%   6/8
Security and privacy              100%   7/7
Store metadata and assets          67%   4/6
Legal/compliance                   60%   3/5
Founder-owned actions              50%   2/4
```

The category totals must derive from policy and product/platform applicability, not a hardcoded UI
list.

### 8.5 Canonical human-action model

Founder dependencies need their own append-only state rather than ad hoc messages. Suggested shape:

```json
{
  "schema": "human-action/v1",
  "id": "HUM-001",
  "candidate_id": "RC-...",
  "title": "Accept updated Apple agreement",
  "owner": "founder",
  "status": "open|acknowledged|complete|waived",
  "reason_human_required": "requires Account Holder authority",
  "blocks": ["apple-submission-packet"],
  "instructions": "Sign in to App Store Connect → Agreements...",
  "evidence_required": "founder confirmation and date; never credentials",
  "source_control": "legal.apple.agreements",
  "created_at": "...",
  "due_at": null
}
```

The UI may let the founder acknowledge or mark an action complete through a validated CLI, but must
never request, store, display, or transmit store passwords, API keys, private signing keys, tax data,
banking data, or identity documents. Evidence is a confirmation/reference, not the sensitive value.

### 8.6 Founder action categories

Applicability varies, but the system should be able to generate tasks for:

- Apple/Google developer-account existence and role authority;
- account agreements, tax, banking, trader/business and regional compliance status;
- app record, bundle ID/package name, SKU and store ownership decisions;
- signing/provisioning action when founder-held credentials are required;
- privacy policy, terms, support and marketing URLs;
- App Privacy and Play Data Safety declarations;
- encryption/export-compliance, content-rights, age-rating and advertising declarations;
- pricing, availability, countries/regions and in-app purchase configuration decisions;
- final screenshots/localizations that require founder approval;
- explicit waiver or risk-acceptance decisions;
- final manual upload, submission-for-review and release-option choices.

The last category remains open even when the plugin says ready. It is not a blocker to
`READY FOR FOUNDER SUBMISSION`; it is the founder's next action after handoff.

### 8.7 Control-room data sources

Add durable sources such as:

```text
docs/release/candidates/RC-<id>.json
docs/release/verdicts/<control>-RC-<id>.json
docs/release/human-actions.jsonl
docs/release/handoff/RC-<id>/manifest.json
docs/release/handoff/RC-<id>/FOUNDER-CHECKLIST.md
```

`control-room/state.mjs` should only project these through a shared zero-dependency reader. The same
reader must power a CLI command such as `submission-status.mjs`; the UI cannot own readiness math.

### 8.8 Screen-by-screen control-room design

| Screen | Preserve | Add or change for submission readiness |
|---|---|---|
| Global header | Source pills, generated time, read path, chain integrity, stale-stream warning | Active candidate pill, candidate freshness, overall READY/NOT READY/CANNOT EVALUATE; log tamper must suppress READY everywhere |
| Mission Control | Cause-first ordering, budget honesty, latest verification | Current phase from explicit candidate state; submission summary; top blocker; next team action; next founder action; link to Submission screen |
| Communications | Durable ticket threads, obligations, open assumptions and escalations | Candidate filter; readiness-control discussions; human-action references; no readiness verdict derived from chat |
| Board | Event-derived work, owner load, stranded/static-only visibility | Show which tickets block the active candidate; keep founder actions out of the engineering board |
| Team | Activated/off/conditional role visibility and current work | Per-role readiness responsibility, outstanding verdict, stale deliverable, and next required role action |
| Submission — new | — | Candidate identity, truthful progress, control matrix, blockers, platform packages, store packet, evidence freshness, waivers/N/A, handoff manifest |
| Founder Inbox | Quoted context/recommendation and validated actions | Founder-only submission tasks grouped by candidate, ordered by dependency and severity; acknowledge/complete/waive with safe evidence reference |

### 8.9 Submission screen information hierarchy

The founder should understand the state in under thirty seconds. Recommended order:

```text
1. Headline
   NOT READY · RC-123 · iOS + Android · 31/38 complete

2. The one thing stopping handoff
   "Apple privacy URL missing" · owner founder · blocks App Privacy packet

3. Progress and coverage
   completion, evidence coverage, category bars, stale count, waiver count

4. Founder actions
   ordered list with exact instructions and what each action unblocks

5. Team blockers
   ticket, role, severity, dependency and expected evidence

6. Candidate packages
   platform, file, checksum, signing status, validation and freshness

7. Readiness matrix
   every applicable control with status, owner, artifact and evaluated time

8. Store packet
   metadata/assets/declarations/localizations by platform

9. Handoff
   manifest/checklist paths and READY verdict when all conditions are satisfied
```

Do not lead with a large percentage. Lead with terminal status and the highest-priority blocker; the
percentage explains coverage but must never visually overpower a critical finding.

### 8.10 State and refresh process

```text
candidate preparation or verdict append
  → append/replace immutable candidate-bound artifact
  → shared submission reader validates schema + hashes + freshness
  → submission-status reducer calculates applicable controls and founder/team dependencies
  → `/state` includes the Submission screen and Founder Inbox items
  → SSE refreshes the browser
```

If any required source is missing, malformed, stale, hash-mismatched, or for another candidate, the
affected section is `unavailable` and the headline cannot be READY. A new source commit invalidates
the candidate and drops readiness immediately; the UI must not retain the previous green projection.

### 8.11 Control-room action safety

Allowed submission-related UI actions should be limited to local, auditable state transitions:

- acknowledge a founder action;
- mark a founder action complete with a non-secret evidence reference;
- record a founder waiver through the structured waiver CLI;
- open the local handoff path/checklist;
- request re-evaluation after a dependency changes.

Explicitly forbidden:

- upload/submit/promote/release buttons;
- store-login forms;
- API key, password, signing-key, tax or banking inputs;
- controls that call App Store Connect or Google Play mutation APIs;
- “mark ready” as a manual override—the reducer alone determines readiness.

---

## 9. Required target architecture

### 9.1 Separate preparation, verification, human dependencies and handoff

```text
SCOPE
  product + platform + target store
  version/build identifiers
  applicable policy/control set

PREPARE
  freeze source tree
  build candidate artifacts
  assemble metadata/assets/declarations
  create candidate manifest

VERIFY
  board/event state + exact approvals
  QA/runtime/journeys/accessibility
  dependency/version/policy/security/privacy/legal
  reliability/migration/rollback readiness
  store package validation
  independent submission audit

RESOLVE
  app-team blockers become board tickets
  human-only blockers become founder actions
  every resolution is candidate-bound and re-verified

HANDOFF
  READY FOR FOUNDER SUBMISSION
  candidate artifacts + checksums
  complete store packet
  known issues + scoped waivers
  manual founder checklist

STOP
  no upload
  no store API mutation
  no submission
  no rollout action
```

### 9.2 One structured verdict schema

Every readiness check should emit:

```json
{
  "schema": "submission-verdict/v1",
  "control": "qa",
  "category": "qa_runtime",
  "candidate_id": "RC-...",
  "status": "pass|fail|cannot_evaluate|not_applicable|waived|pending_human",
  "artifact_refs": [],
  "evidence_hashes": [],
  "owner": "qa-engineer",
  "evaluated_at": "...",
  "expires_at": null,
  "findings": [],
  "human_action_ids": []
}
```

The readiness aggregator validates coverage, freshness, authority, applicability and candidate
identity. Markdown reports and control-room panels are generated projections.

### 9.3 Submission-ready package

For each active platform, the founder handoff should contain:

**Common**

- candidate manifest and checksums;
- source commit/tree and reproducible build instructions;
- exact version/build identifiers;
- QA, runtime, accessibility, security, privacy, dependency, policy and audit evidence;
- known issues, waivers, N/A decisions and expiry;
- support/privacy/terms URLs and release notes;
- founder action checklist.

**Apple**

- archive/IPA or explicit founder-signing step;
- bundle ID, version/build, entitlements and signing validation;
- icons, screenshots/previews and localized listing copy;
- App Privacy, encryption/export, age rating, content rights, review contact and review notes;
- subscriptions/IAP metadata where applicable;
- manual App Store Connect submission instructions.

**Google Play**

- release AAB or explicit founder-signing step;
- package name, versionName/versionCode and signing validation;
- icons, feature graphic, screenshots and localized listing copy;
- Data Safety, app access, ads, content rating, target audience, permissions and policy declarations;
- subscriptions/IAP metadata where applicable;
- manual Play Console submission instructions.

---

## 10. Action plan

### Wave S0 — freeze, rename and enforce scope

| ID | Action | Acceptance |
|---|---|---|
| SHIP-000 | Commit or isolate the moving working tree | One immutable revision is named for remediation |
| SHIP-001 | Rename `/app-ship` or redefine its visible contract | Name and description mean submission-ready, never publish |
| SHIP-002 | Re-charter `release-manager` | No upload, credentials, store mutation, submission or rollout instruction remains |
| SHIP-003 | Add a no-publishing policy test | Any upload/store-mutation command in agents, commands or actions fails CI |
| SHIP-004 | Add the six reproduced false clears as tests | Every current P0 path goes red before fixes |

### Wave S1 — create canonical candidate identity

| ID | Action | Acceptance |
|---|---|---|
| SHIP-010 | Implement `submission-candidate prepare` | Candidate manifest exists before readiness checks |
| SHIP-011 | Resolve product/platform/store/version first | Every reviewer evaluates the same scope and candidate |
| SHIP-012 | Build and hash candidate artifacts | Exact IPA/archive/AAB or founder-signing dependency is recorded |
| SHIP-013 | Bind approvals and evidence exactly | Material change invalidates readiness and the handoff |

### Wave S2 — make readiness gates authoritative

| ID | Action | Acceptance |
|---|---|---|
| SHIP-020 | Read workflow state from the event log | Markdown disagreement cannot clear readiness |
| SHIP-021 | Add structured QA verdict | HOLD blocks; malformed/missing is cannot-evaluate |
| SHIP-022 | Validate candidate versions/builds/artifacts | Release-note formatting cannot bypass checks |
| SHIP-023 | Add candidate-scoped human waivers | Historical, expired, agent-authored and wrong-scope waivers fail |
| SHIP-024 | Aggregate all applicable verdicts | Missing/stale/unknown/N/A coverage is explicit |
| SHIP-025 | Add dependency, legal and store-policy control catalogues | Applicability, owner, evidence and remediation are versioned |

### Wave S3 — create founder dependency management

| ID | Action | Acceptance |
|---|---|---|
| SHIP-030 | Implement append-only human-action ledger | Every human blocker has owner, reason, instructions and blocked control |
| SHIP-031 | Route findings by authority | Team-fixable work becomes tickets; human-only work becomes founder actions |
| SHIP-032 | Add safe completion/acknowledgement CLI | Founder records completion without entering secrets or sensitive data |
| SHIP-033 | Generate one prioritized founder list | Duplicate blockers are consolidated and dependencies ordered |

### Wave S4 — build the submission handoff

| ID | Action | Acceptance |
|---|---|---|
| SHIP-040 | Implement platform handoff manifests | Every required artifact/metadata/declaration is present or blocked |
| SHIP-041 | Generate `FOUNDER-CHECKLIST.md` | Exact manual store steps are candidate/platform-specific |
| SHIP-042 | Add independent submission auditor | Audit is candidate-bound and cannot be self-satisfied |
| SHIP-043 | Emit terminal verdict | Only READY, NOT READY or CANNOT EVALUATE is possible |
| SHIP-044 | Package checksums and freshness | Founder can verify files did not change after audit |

### Wave S5 — extend the control room

| ID | Action | Acceptance |
|---|---|---|
| SHIP-050 | Add Submission screen and shared reader | UI and CLI calculate identical readiness state |
| SHIP-051 | Add truthful progress and evidence bars | Raw numerator/denominator and applicability are visible |
| SHIP-052 | Add blocker/dependency sections | Team and founder work are separated and ordered |
| SHIP-053 | Extend Founder Inbox with human actions | Founder sees context, quoted recommendation, exact action and evidence needed |
| SHIP-054 | Add package and store-packet inventory | Missing, stale and ready artifacts are individually visible |
| SHIP-055 | Add handoff download/location panel | Checksums and founder checklist are one click/path away; no publishing action exists |

### Wave S6 — certify submission readiness

| ID | Action | Acceptance |
|---|---|---|
| SHIP-060 | Add golden iOS, Android and cross-platform fixtures | Complete handoff packages reach READY without hidden files |
| SHIP-061 | Add brownfield and non-store fixtures | Applicability and N/A remain honest |
| SHIP-062 | Add stale/mutated candidate tests | Any post-audit change removes READY |
| SHIP-063 | Add founder-dependency lifecycle tests | Open, complete, stale and waived human actions project correctly |
| SHIP-064 | Add control-room render/degrade tests | READY never appears with unavailable or contradictory source state |
| SHIP-065 | Mutation-test every readiness transition | Each critical rule demonstrably catches its originating defect |

---

## 11. Exit criteria for `READY FOR FOUNDER SUBMISSION`

The plugin may emit that terminal verdict only when:

- one immutable candidate identity exists;
- product, platform, target store, version and build numbers are explicit;
- exact artifacts or an explicit founder-signing action are present and checksummed;
- event-log state is authoritative and all implementation work is terminal;
- QA HOLD and every negative verdict mechanically block;
- runtime and critical journeys were executed against candidate-equivalent artifacts;
- dependencies, licenses, policy, security, privacy and applicable legal/compliance checks are clear;
- store metadata, assets, declarations, URLs and review information are complete;
- every verdict is fresh, evidence-backed and candidate-bound;
- every waiver is human, scoped, expiring and audited;
- every founder dependency required before handoff is complete;
- the independent auditor passes the exact candidate;
- the founder checklist and checksum manifest are generated;
- no publishing credential or store mutation is requested or performed;
- every reproduced P0/P1 failure has a regression and mutation test.

The final manual upload/submission action is shown as the founder's next action, not performed by the
plugin and not counted as incomplete readiness.

---

## 12. Final assessment

`/app-ship` is not missing readiness thinking; it is missing synchronization and a clean terminal
boundary. The documents contain many practices a mature submission team should want, and the code
contains useful gates. What is absent is an immutable submission candidate moving through
authoritative checks into one founder-ready package.

The highest-value move is to remove publishing authority, build the candidate and verdict
aggregates, create a governed founder-action queue, and expose all of it in a dedicated control-room
screen. Once that spine exists, the existing QA, runtime, security, privacy, dependency, audit and
store-readiness work can become a coherent preparation system instead of a collection of mutable
files and agent instructions.
