# Post-Enhancement End-to-End Audit

**Audit date:** 2026-08-03  
**Repository state:** `main` at `541cb70`, equal to `origin/main` at audit start  
**Audit mode:** Read-only implementation and benchmark review; no plugin code changed  
**Primary benchmarks:**

- `docs/reviews/2026-08-03-global-plugin-enhancement-plan.md`
- `docs/dry-runs/2026-08-02-blood-pressure-journal-10-10-readiness-plan.md`
- `docs/reviews/2026-07-31-ai-development-team-strategy-architecture-review.md`
- `docs/reviews/2026-08-01-app-ship-end-to-end-audit.md`
- `/Users/amolpomane/Downloads/appdevteamreview_2`
- Current handbook, code, tests, evaluations, plugin manifests, control room, and CI workflows

## 1. Executive verdict

The plugin is a strong governed AI-development-team foundation, and the earlier v2 revamp is substantially real. The append-only board, semantic gate roles, durable run ledger, context manifests, memory curation, prompt registry, risk routing, impact map, evaluation laboratory, incident ledger, founder gates, and fail-closed checks are meaningful mechanisms rather than decorative prompts.

However, the **August 3 global enhancement plan is not mostly implemented yet**.

The latest merged work delivered:

1. ticket identity as a required input to dispatch preflight;
2. scheduler-ready admission for that ticket;
3. `run_id`, `attempt_id`, and `lease_until` on a claimed board event;
4. two independent readiness values in the control-room state projection.

Those are useful improvements. They are also explicitly described in the handbook and commit history as a narrow first slice. The executable workflow engine, unified execution lifecycle, immutable candidate/evidence model, project/toolchain profile, journey-level runtime gate, dedicated Submission screen, expanded ticket contracts, mutation-boundary capabilities, dependency intelligence, policy v2, evaluation lifecycle, and generated current-state documentation have not landed.

### Bottom-line ratings

| Lens | Rating | Interpretation |
|---|---:|---|
| Governance and AI-team foundation | **8.1/10** | Strong controls and organizational design; improved materially from the original v2 review |
| End-to-end submission-ready operating system | **6.8/10** | Useful and credible, but candidate truth, journey proof, toolchain contracts, and submission visibility remain incomplete |
| August 3 P0 enhancement objectives | **0 complete, 2 partial, 4 not started** | The merged work is a first slice, not completion of the P0 architecture |
| Recommended first implementation slice | **2 of 5 complete** | Ticket-bound dispatch and claim/run identity landed; metadata/eval drift, stale-candidate fixtures, and workflow `status/next` did not |
| 10/10 status | **Not yet** | Several current green labels can outlive or exceed their evidence |

The correct product description today is:

> A mature, local-first, governed AI software-delivery framework with strong board and review controls, but not yet a fully executable or candidate-bound AI software organization.

## 2. What was audited

The audit inspected:

- current Git state and the latest 25 commits;
- all plugin scripts, commands, agents, skills, hooks, evaluations, manifests, and CI workflows relevant to the enhancement plan;
- the handbook's current-state claims and historical findings;
- the React control room and its server/state projection;
- the global enhancement plan item by item;
- the original external review's 17 improvement areas;
- the Blood Pressure Journal 10/10 dimensions;
- the full regression suite and evaluation laboratory;
- focused adversarial scenarios not covered by the current suite.

No plugin source was edited during the audit.

## 3. Verification results

### 3.1 Passing evidence

| Check | Result |
|---|---|
| `node scripts/team-doctor.mjs` | PASS — 30 roles, 31 skills, 27 commands; coherent |
| `node scripts/metadata-check.mjs` | Reported CLEAR, but has a confirmed blind spot described below |
| `node scripts/studio-eval.mjs` | PASS on scored denominator — 12/12 detected, 0/3 false positives |
| `sh scripts/test.sh` | PASS with localhost permission — **925 passed, 0 failed** |
| Control-room TypeScript | PASS — `npm run typecheck` |
| Control-room production build | PASS — `npm run build` |
| Documented two-process render smoke | PASS for all five screens |

The first sandboxed suite run returned 886 passed and 49 failed because the managed environment denied temporary localhost listeners with `EPERM`. Re-running with localhost permission produced the valid 925/925 result. This was an environment constraint, not a repository regression.

### 3.2 Benchmark caveats

The 925 assertions prove the current assertions pass. They do not prove the new enhancement plan is implemented.

The evaluation score also needs qualification:

- `eval/stale-approval/manifest.json` still says no detector or approval input exists.
- `board.mjs --bind` and `approval-check.mjs` now provide approval binding.
- The evaluation therefore understates current capability and demonstrates lifecycle drift.
- A 12/12 denominator that excludes a stale case is useful regression evidence, but not a complete current-capability score.

## 4. Highest-priority findings

### F-01 — Current readiness can remain green after the candidate changes

**Severity:** S1  
**Benchmark:** Global plan P0.3 and P0.6; app-ship audit candidate identity; 10/10 release readiness

`scripts/ship-gate.sh:147-164` records `ship-gate-verdict/v1` with result, time, blockers, unknowns, and notes. It does not record:

- candidate ID;
- source commit;
- build variant;
- artifact path or hash;
- dependency fingerprint;
- toolchain fingerprint;
- policy fingerprint;
- evidence hashes;
- gate implementation version.

`scripts/lib/project.mjs:509-525` reads that historical verdict as authoritative until another run overwrites it. `control-room/state.mjs:148-156` promotes engineering readiness to `production-ready` when any non-static verification exists and the last ship-gate verdict is CLEAR.

An adversarial audit fixture proved:

```json
{
  "before": [
    ["engineering", "production-ready"],
    ["store", "submission-ready"]
  ],
  "after_source_change": [
    ["engineering", "production-ready"],
    ["store", "submission-ready"]
  ],
  "artifact_exists": false,
  "candidate_manifest_exists": false
}
```

The source was changed after all evidence was recorded; both values stayed green.

**Impact**

The dashboard state can describe a changed project as production-ready based on evidence from an older state. This violates the core rule that evidence, not prose or historical confidence, changes readiness.

**Required fix**

Implement `release-candidate/v1`, `gate-result/v1`, fingerprints, and staleness propagation before using `production-ready` or `submission-ready` as current-state labels.

### F-02 — Store submission readiness is checkbox readiness, not candidate readiness

**Severity:** S1  
**Benchmark:** Global plan P0.3/P0.6; app-ship audit; founder submission boundary

`scripts/lib/project.mjs:470-495` parses the last Markdown submission checklist. `control-room/state.mjs:158-174` returns `submission-ready` when every checkbox is checked.

The state does not require:

- a candidate manifest;
- an AAB, APK, IPA, or archive;
- artifact hashes;
- signing evidence;
- version/build identity;
- current policy/legal/privacy evidence;
- current store metadata/assets;
- platform-specific submission validation.

The focused fixture reached `submission-ready` with no artifact and no candidate manifest.

**Impact**

The state name is stronger than its evidence. The checklist can be a useful founder-action projection, but it cannot independently prove submission readiness.

**Required fix**

Rename the present value to `submission-checklist-complete` until candidate-bound requirements exist, or make `submission-ready` require all mandatory candidate-bound dimensions.

### F-03 — The new readiness dimensions are not rendered in the React control room

**Severity:** S2  
**Benchmark:** Global plan P0.6 and Wave 6

`control-room/state.mjs:132-180` emits `readiness.dimensions`. The React UI has no readiness type or component:

- `control-room/src/types.ts` treats extra screen fields as unknown;
- `control-room/src/screens/Mission.tsx:48-65` renders the headline and `screen.sections` only;
- repository search finds no `readiness`, `production-ready`, or `submission-ready` usage under `control-room/src`.

The API contains the new data, but the founder-facing product does not display it.

**Impact**

Commit #18 is a backend-state addition, not a completed Mission Control feature. A user opening the control room cannot see the new engineering/store verdicts or the explicitly uncovered dimensions.

**Required fix**

Add an honest readiness component now, then replace it with the dedicated candidate-aware Submission screen in Wave 6. The UI must display `notCovered` and stale/unknown states, not only green states.

### F-04 — Dispatch admission is ticket-aware but still not unified or atomic

**Severity:** S2  
**Benchmark:** Global plan P0.2 and Wave 2

The latest change correctly requires `--ticket` and checks `scheduleResult.ready` in `scripts/dispatch-preflight.mjs:9-35`.

However:

- `scripts/scheduler.mjs:8-25` reads a separate `scheduler-plan/v1` file;
- preflight does not read the event-sourced board;
- preflight does not inspect the ticket's current board state;
- preflight does not inspect a live run lease;
- it does not atomically reserve or claim the ticket;
- schedule status can disagree with board and run state.

An adversarial fixture created ticket `T`, claimed it, created a live run lease, and left the independent schedule row as pending. Dispatch preflight returned:

```json
{
  "exit": 0,
  "status": "CLEAR",
  "board_already_claimed": true,
  "live_lease_exists": true
}
```

The later `board.mjs move ... claimed` gate should still refuse a duplicate claim when the documented sequence is obeyed, so this is not proof that duplicate execution currently occurs. It is proof that “dispatch admission” is not yet one authoritative transaction and still relies on correct prose sequencing.

**Required fix**

Derive scheduler readiness from board/dependency/run state and make admission plus lease acquisition one executable operation. At minimum, fail preflight when schedule, board, and lease state disagree.

### F-05 — Board transitions do not close or interrupt their run

**Severity:** S2  
**Benchmark:** Global plan P0.2 and original external review durable-execution model

`scripts/board.mjs:484-496` starts a run lease on `claimed` and now records its identity. No corresponding code maps later board events to run-ledger lifecycle events.

The adversarial fixture:

1. created a ticket;
2. claimed it;
3. moved it to `blocked`;
4. inspected the run ledger.

Result:

```json
{
  "board_state": "blocked",
  "run_events": ["start"],
  "terminal_run_event": false,
  "run_doctor": "CLEAR — 1 attempt(s), 1 active"
}
```

**Impact**

- a blocked ticket can retain a live execution lease;
- an immediate reassignment may be refused until lease expiry;
- run status disagrees with board status;
- recovery cannot know whether the attempt should resume, restart, or be abandoned;
- completion can leave an active run unless the orchestrator remembers a separate command.

**Required fix**

Connect board events to `heartbeat`, `checkpoint`, `interrupt`, `complete`, and recovery semantics, using the run identity stored on the claim.

### F-06 — The runtime gate still proves liveness, not a product journey

**Severity:** S2  
**Benchmark:** Global plan P0.4/P0.5; Blood Pressure Journal runtime findings

`scripts/runtime-gate.sh:372-386` hardcodes `assembleDebug` and searches broadly for the first output APK. `scripts/runtime-gate.sh:423-439` launches with Monkey, waits three seconds, checks process liveness, and attempts a screenshot.

Confirmed gaps:

- no project profile;
- no configured release/debug variant;
- no exact artifact identity;
- no screen-readiness assertion;
- no post-splash assertion;
- no deterministic P0 journey;
- screenshot failure still returns PASS at line 438;
- no candidate/evidence envelope.

The existing crash-on-launch mirror test is valuable. It proves the gate distinguishes a process that survives from one that immediately dies. It does not prove that the correct UI or workflow works.

**Required fix**

Introduce project runtime profiles, platform adapters, declarative journeys, stable semantic selectors, and fail-closed visual/assertion evidence.

### F-07 — Metadata validation reports CLEAR while metadata is visibly inconsistent

**Severity:** S2  
**Benchmark:** Global plan P1.6 and Wave 0

Current files say:

- `.claude-plugin/plugin.json:4` — **29 role agents**;
- `.claude-plugin/marketplace.json:11` — **30-role**;
- live inventory — **30 roles**.

`scripts/metadata-check.mjs:44-48` checks the role count in the marketplace description, but never checks the plugin manifest description. It therefore reports:

```text
METADATA: CLEAR — app-dev-team 2.0.0; 30 roles, 31 skills, 27 commands
```

while the shipped plugin manifest still says 29.

The marketplace also says the team takes an idea to a “shipped” app, which can be read as store publishing even though the actual process correctly stops at submission-ready.

**Required fix**

Check every public manifest and generate counts/descriptions from one canonical metadata source. Replace “shipped” with “submission-ready for founder upload and submission.”

### F-08 — Evaluation lifecycle drift is still open

**Severity:** S2  
**Benchmark:** Global plan P1.5 and Wave 0

`eval/stale-approval/manifest.json` says:

- `expected_detector: null`;
- no board field records the approved commit;
- no detector can exist.

That narrative contradicts `board.mjs` approval binding and `approval-check.mjs`. `studio-eval.mjs` has no case lifecycle such as `open`, `fixed`, `superseded`, or `retired`.

The crash-on-launch fixture also says its runtime job lives in `.github/workflows/checks.yml`; it now lives in `.github/workflows/runtime-gate.yml`.

**Impact**

The laboratory can pass while its explanation of present capability is stale. This undermines the goal of learning from historical defects without turning old facts into current truth.

**Required fix**

Add evaluation lifecycle metadata and make the lab reject narratives that contradict current detector behavior.

### F-09 — The React control room is not built or smoke-tested in CI

**Severity:** S2  
**Benchmark:** Control-room production readiness and global plan Wave 6

The control room passes typecheck, production build, and its documented render smoke when run correctly. However:

- `.github/workflows/checks.yml` does not run `npm ci`, typecheck, build, or render smoke;
- `scripts/test.sh` tests the server/state behavior but does not compile or render the React application;
- `npm run smoke` fails by itself because it expects a separately started server;
- the documented two-process command succeeds.

**Impact**

A broken React import, type error, or render crash can merge while the 925-assertion suite remains green.

**Required fix**

Make the smoke script start and stop its own temporary server, then run `npm ci`, typecheck, build, and smoke in CI with dependency caching.

### F-10 — Ticket and capability enhancements remain baseline-level

**Severity:** S2  
**Benchmark:** Global plan P1.1/P1.2

`scripts/board.mjs:308-322` currently records title, feature, owner, dependencies, estimate, spec, acceptance, notes, invariants, rollback, and risk.

It does not yet require:

- target gate/transition;
- independent reviewer;
- evidence contract;
- candidate impact;
- founder dependency;
- expected and forbidden changed paths;
- canonical test commands;
- privacy/security/accessibility/legal classification;
- documentation/dependency impact;
- residual risk.

`scripts/lib/capabilities.mjs` strongly enforces semantic gate roles at board append time. The only host hook currently blocks destructive Git for Bash. Direct Write/Edit path permissions and post-run changed-file reconciliation are not enforced.

**Required fix**

Expand the ticket schema, validate reviewability, add host hooks where available, and always perform post-run path/capability reconciliation.

### F-11 — Dependency and policy checks remain shallow

**Severity:** S2  
**Benchmark:** Global plan P1.3/P1.4

`scripts/dependency-check.mjs` checks package lock presence, obvious dynamic versions, and a few platform files. It does not provide:

- dependency fingerprints;
- Android/iOS toolchain compatibility rules;
- advisory status;
- license inventory;
- platform deprecation checks;
- official-source freshness;
- variant-specific compatibility.

`scripts/policy-check.mjs` checks policy parsing, required files/artifacts, owner, and reviewed date. It does not implement applicability, source authority, expiry, human attestation, evidence types, or platform/data/region rules.

**Required fix**

Implement deterministic offline compatibility/fingerprint checks and separately recorded online official-source freshness checks. Evolve to `studio-policy/v2`.

## 5. Global enhancement plan conformance

### 5.1 P0 status

| Objective | Status | Evidence |
|---|---|---|
| P0.1 Executable workflow engine | **Not started** | No `orchestrator.mjs`, workflow schema, `status/next/advance/recover` engine, or executable cross-command state machine |
| P0.2 Unified board/scheduler/dispatch/run | **Partial** | Ticket-aware schedule check and claim/run identity landed; schedule remains separate, admission is non-atomic, lifecycle is not connected |
| P0.3 Immutable candidate/evidence identity | **Not started** | No candidate manifest, fingerprints, common gate-result envelope, or staleness propagation |
| P0.4 Project/toolchain contract | **Not started** | No project profile or toolchain doctor; manual environment/variant knowledge remains necessary |
| P0.5 Journey-level runtime verification | **Not started** | Existing liveness gate remains; no declared journeys or platform adapters |
| P0.6 Candidate-aware submission control room | **Partial** | Two state values added, but no candidate, no dedicated screen, no stale state, only two dimensions, and React does not render them |

### 5.2 P1 status

| Objective | Status | Evidence |
|---|---|---|
| P1.1 Executable ticket contracts | **Not started beyond baseline** | Existing ticket fields remain unchanged |
| P1.2 Mutation-boundary capabilities | **Not started beyond baseline** | Semantic board gates are strong; direct write/path reconciliation absent |
| P1.3 Dependency/version intelligence | **Not started** | Existing checker remains lockfile/dynamic-version level |
| P1.4 Policy/privacy/legal/store model | **Not started** | Existing policy schema remains minimal |
| P1.5 Evaluation lifecycle | **Not started** | Stale approval case still carries obsolete narrative |
| P1.6 Generated metadata/current-state docs | **Not started** | Manifest role-count drift passes metadata check |

### 5.3 Wave status

| Wave | Status |
|---|---|
| Wave 0 — regression evidence and drift correction | Partial: broad tests exist, but the named metadata/evaluation drift remains |
| Wave 1 — workflow kernel | Not started |
| Wave 2 — unified execution identity | Partial |
| Wave 3 — project/toolchain | Not started |
| Wave 4 — candidate/evidence | Not started |
| Wave 5 — runtime journeys | Not started |
| Wave 6 — submission workspace | Early backend projection only |
| Wave 7 — governance/self-maintenance | Not started beyond earlier-v2 baseline mechanisms |

### 5.4 First implementation slice

The global plan recommended five first-PR items:

| First-slice item | Result |
|---|---|
| Correct metadata drift | Not done |
| Correct stale evaluation drift and add stale-candidate regression | Not done |
| Add workflow schema plus read-only `orchestrator status/next` | Not done |
| Require ticket and prove scheduler readiness | Done |
| Persist run and attempt identity from board claims | Done |

Therefore the recommended first slice is **2/5 complete**.

## 6. Comparison with the original external v2 benchmark

The original external review identified 17 major improvement areas. Many were implemented during the earlier revamp, which explains why the current foundation score is substantially stronger even though the new global plan remains open.

| Original benchmark area | Current status | Audit judgment |
|---|---|---|
| Durable execution model | Partial/strong baseline | Run ledger, attempts, leases, checkpoints, doctor exist; board lifecycle and side-effect idempotency remain incomplete |
| Explicit context architecture | Implemented | Context manifests and preflight are real and integrated |
| Memory lifecycle | Implemented baseline | Curated ledger, review, supersession, provenance; needs long-horizon quality evidence |
| Agent evaluation laboratory | Implemented with drift | Good planted-defect model and false-positive measurement; lifecycle is missing |
| Prompt and policy registry | Implemented baseline | Prompt registry and drift checks exist; richer policy applicability remains open |
| Deterministic scheduler | Partial | Ready queue/backpressure exists, but separate plan and prose orchestration remain |
| Manager/specialist separation and failover | Implemented baseline | Manager failover and harness exist |
| Approval binding and audit-chain integrity | Implemented baseline | Approval binding, event hash chain, and audit anchor exist; release candidate binding remains open |
| Product discovery and evidence | Partial | Founder intent, PRD trace, product validator exist; market hypothesis/experiment operating loop is incomplete |
| Mobile-specific quality standards | Partial | Strong skills and static gates; project profiles, device matrices, and journeys remain insufficiently executable |
| Agent observability | Partial | Run/round/incident records exist; causal navigation and unified execution projection remain incomplete |
| Risk-based model routing | Implemented baseline | Risk router and escalation modes exist; measured routing effectiveness remains limited |
| Tool access and sandboxing | Partial | Semantic gate capabilities and destructive-Git hook exist; write-path boundary remains open |
| Improved ticket structure | Partial | Better than a basic task, but not yet an executable work/evidence contract |
| Semantic change propagation | Implemented baseline | Impact map exists; candidate invalidation is absent |
| Production operations | Partial | Incident and release-health controls exist; real support/experiment feedback remains deferred |
| Avoid overengineering/agent theatre | Implemented baseline | Tier/product role activation is a genuine strength |

### Updated external-benchmark scorecard

| Area | Original review | Current audit |
|---|---:|---:|
| Engineering governance | 9.0 | **9.2** |
| False-completion prevention | 9.5 | **8.5** |
| Git/worktree isolation | 9.0 | **9.0** |
| Ticket state integrity | 9.0 | **9.2** |
| Product-intent preservation | 7.5 | **8.5** |
| Agent orchestration | 7.5 | **7.4** |
| Context management | 6.5 | **8.3** |
| Long-term memory | 5.5 | **8.0** |
| Agent evaluation | 6.5 | **7.6** |
| Mobile development quality system | 7.0 | **7.0** |
| Production observability | 5.5 | **7.0** |
| Real startup operating model | 7.0 | **8.0** |
| Autonomous recovery | 6.0 | **7.2** |

False-completion prevention is scored below the original optimistic 9.5 because the current candidate/readiness probe demonstrates a concrete stale-green path. The underlying board and review controls remain excellent; release-level truth is the weak layer.

## 7. Blood Pressure Journal 10/10 benchmark applied globally

| Dimension | Plugin support today | Global gap |
|---|---:|---|
| Product strategy and documents | 8.5/10 | Market/user evidence and executable completeness checks need depth |
| UX/design system | 7.5/10 | Good specialist skills; no universal journey/state completeness executor |
| Architecture | 8.0/10 | Strong review roles; no pre-implementation toolchain compatibility contract |
| Implementation workflow | 8.0/10 | Strong board/review loop; orchestration remains prose-driven |
| Safety/privacy/legal | 7.0/10 | Useful gates and human escalation; policy evidence model remains shallow |
| Testing/QA | 8.0/10 | Excellent self-tests; app journey/device proof remains limited |
| Accessibility | 8.0/10 | Static detector and role guidance exist; runtime semantic journey evidence is incomplete |
| Security/dependencies | 7.0/10 | Injection, risk, capability, dependency checks exist; advisories/licenses/compatibility/freshness missing |
| Release/submission readiness | 5.5/10 | No immutable candidate; checkbox and stale-verdict false-green paths |
| AI-team execution | 7.5/10 | Strong durable primitives; no executable workflow kernel or unified recovery lifecycle |
| Control-room clarity | 6.5/10 | Honest five-screen baseline; new readiness is invisible and no Submission screen exists |

## 8. What remains genuinely excellent

The audit should not lose sight of the mechanisms that are working well:

1. **Event-sourced ticket state:** illegal transitions are refused before append.
2. **Semantic separation of duties:** developers cannot self-approve; gate writers are constrained by role.
3. **Three-state truth:** PASS, BLOCKED/FAIL, and CANNOT EVALUATE are usually preserved.
4. **Lease race protection:** run-ledger locking closes concurrent ticket claim races.
5. **Approval binding:** commit/diff/evidence/context binding is a meaningful trust improvement.
6. **Founder authority:** scope and release authority are human gates.
7. **Human-only publishing:** app upload and store submission are correctly out of scope.
8. **Adversarial engineering culture:** mutation tests and planted-project evaluations are unusually mature.
9. **Role activation:** the plugin avoids running all 30 roles for every project.
10. **Local-first recoverability:** durable repository artifacts remain the system of record.
11. **Honest partial implementation notes:** the handbook explicitly says the new readiness work is partial and the workflow rewrite has not started.

These should be preserved while the next architecture is added.

## 9. Prioritized remediation plan

### PR 1 — Close truth and benchmark drift

- Fix plugin manifest role count.
- Replace “shipped app” with “submission-ready app.”
- Expand metadata checks to every manifest description.
- Update or supersede the stale-approval evaluation.
- Correct the runtime workflow path in the crash-on-launch evaluation.
- Add lifecycle fields to evaluation manifests.
- Add adversarial tests for stale green readiness and checklist-only submission readiness.

**Exit:** metadata and evaluation output no longer contradict current code.

### PR 2 — Candidate and evidence kernel

- Add `release-candidate/v1`.
- Add common `gate-result/v1`.
- Bind ship-gate, runtime-gate, checklist, approval, policy, dependency, and artifact evidence.
- Implement source/dependency/policy/toolchain staleness.
- Downgrade current labels until candidate evidence exists.

**Exit:** changing source after a green gate changes readiness to STALE.

### PR 3 — Unified execution lifecycle

- Make scheduler a board projection.
- Combine admission and lease acquisition.
- Store branch/worktree/base commit on the attempt.
- Map blocked/review/rejected/merged/closed to run events.
- Add recovery decisions: resume, restart same context, refresh context, abandon/reassign.

**Exit:** no blocked/done ticket can retain an unexplained active run.

### PR 4 — Read-only workflow kernel

- Add workflow schema.
- Add `orchestrator status`, `next`, and `recover --dry-run`.
- Compare output against existing `/app-build` behavior.
- Keep mutation commands disabled until the read model is stable.

**Exit:** every agent receives the same legal next actions from code.

### PR 5 — Project/toolchain profile

- Add Android/iOS project profiles.
- Add toolchain doctor.
- Record variants, commands, outputs, SDKs, and compatibility constraints.
- Use the same profile locally and in CI.

**Exit:** the Blood Pressure Journal JDK/SDK/KSP compatibility issue is detected before implementation.

### PR 6 — Journey gate

- Refactor runtime gate into platform adapters.
- Add deterministic P0 journey declarations.
- Require stable semantic selectors and evidence.
- Make screenshot/assertion failure CANNOT EVALUATE or FAIL.

**Exit:** PASS proves a configured user journey beyond splash/liveness.

### PR 7 — Submission workspace and React CI

- Render independent readiness dimensions honestly.
- Add the dedicated Submission screen.
- Show candidate, artifact, evidence, stale state, blockers, and founder actions.
- Add React install/typecheck/build/smoke to CI.
- Make `npm run smoke` self-contained.

**Exit:** a founder can determine exact readiness and next action from the UI, and the UI itself is gated in CI.

### PR 8 — Governance depth

- Expand ticket contracts.
- Add changed-path reconciliation.
- Add dependency fingerprints/advisories/licenses/compatibility.
- Add policy v2 and official-source freshness.
- Generate current-state handbook and metadata inventory.

**Exit:** governance claims are enforceable, current, and candidate-aware.

## 10. Release recommendation

The current main branch is suitable for continued controlled pilots and internal development-team use. It should not yet be marketed or relied upon as a fully autonomous, end-to-end, production-grade AI software organization.

Before calling the system 10/10 or “submission-ready by evidence,” complete at least:

1. candidate/evidence identity;
2. staleness propagation;
3. unified run lifecycle;
4. project/toolchain contract;
5. journey-level runtime proof;
6. candidate-aware Submission screen;
7. evaluation/metadata self-maintenance.

Publishing must remain human-founder-only throughout these changes.

## 11. Final conclusion

The recent changes are good, tested, and directionally correct. They do not represent “most of the global enhancement plan.” They represent two narrow execution-identity fixes and one early control-room state projection layered onto an already strong v2 foundation.

The next best move is not more roles or more prose. It is candidate truth first, then unified execution lifecycle, then project profiles and real user journeys. Those changes close the most serious false-green paths and provide the stable kernel on which the full control room and governance model can safely depend.
