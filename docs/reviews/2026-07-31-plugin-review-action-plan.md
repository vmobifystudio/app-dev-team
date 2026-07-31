# AI App Studio Plugin Review — Action Plan

**Review date:** 2026-07-31
**Scope:** plugin metadata, commands, agents, skills, scripts, hooks, control room, CI, documentation, fixtures, and evaluation laboratory
**Current working baseline:** 779 regression assertions passing; `team-doctor` coherent; control-room typecheck/build passing

## Adversarial review update — 2026-07-31

The second review found an important distinction: several detectors are fixture-tested, but most are not
yet release-enforced. The code-only execution phase therefore targets enforcement, bypass resistance,
and evidence quality. Mobile build/install/launch remains intentionally deferred to CI/runtime-gate.

### Findings converted to coding work

| ID | Finding | Code-only action | Acceptance evidence |
|---|---|---|---|
| ADV-001 | New product/security detectors are not on the ship path | Run applicable detectors from `ship-gate.sh`; preserve `CANNOT EVALUATE` for missing required artifacts | A planted defect makes `ship-gate.sh` fail; a clean fixture remains clear |
| ADV-002 | Heuristic detectors can be bypassed by comments or nearby text | Strip comments before semantic checks; use bounded, file-aware matching; add bypass tests | Comment-only bypass fixtures fail or remain clear correctly |
| ADV-003 | Accessibility scan recursively follows irrelevant/symlinked paths | Add safe traversal with excluded directories, symlink refusal, and read errors as unknown | Symlink/large-tree tests terminate with deterministic results |
| ADV-004 | Follow-up closure is count-based and over-permissive | Require same-ticket, addressed obligation, and valid delivery evidence for closure | Unrelated answers do not close handoffs/blockers/escalations |
| ADV-005 | Shared-file detection only blocks a narrow declaration format | Support explicit file lists/scopes and report collision evidence; do not claim automatic serialization | Multiple declared files and directory scopes are detected |
| ADV-006 | New detectors have no mutation catalogue entries | Add mutation cases for each release-connected detector | Mutating each detector makes the relevant fixture go red |
| ADV-007 | Action-plan status overstates completion | Mark fixture-tested controls separately from release-enforced controls | This document distinguishes implemented, gated, and runtime-proven |

### Explicit non-goals for this coding phase

- Do not run or simulate the actual iOS/Android build, install, launch, or device journey.
- Do not claim stale-approval anchoring or audit-chain truncation protection is solved without an
  immutable external anchor design.
- Do not turn heuristic scanners into substitutes for platform tooling or human review.

## Governance capability phase — 2026-07-31

The next capability audit found that workflow, review, communication, ticket, isolation, and release
roles already exist. The missing controls are now focused skills and dependency-free scripts rather
than duplicated generic agent prose:

| ID | Capability | Implementation | Status |
|---|---|---|---|
| GOV-001 | Context preflight | `context-preflight` skill, `scripts/context-preflight.mjs`, `/app-preflight` | CODED; regression coverage added |
| GOV-002 | Dependency/version policy | `dependency-policy` skill and `scripts/dependency-check.mjs` | CODED; local declaration/lock checks |
| GOV-003 | App version consistency | `scripts/version-consistency-check.mjs` | CODED; iOS manifest fixture covered |
| GOV-004 | Explicit policy contract | `policy-checker` skill and `scripts/policy-check.mjs` | CODED; missing/evidence fixtures covered |
| GOV-005 | Canonical Git/PR lifecycle | `git-pr-strategy` skill plus DevOps/reviewer/manager activation rules | CODED; live PR behavior still requires repository CI |
| GOV-006 | Context recovery/checkpoints | Existing board/message/daily/evidence model | PARTIALLY COVERED; a dedicated resume artifact remains |
| GOV-007 | Production operations/rollback | Existing reliability/release roles | PARTIALLY COVERED; telemetry/rollback runbook remains |

The new checks intentionally do not perform network vulnerability lookups or legal interpretation. An
unavailable external lookup remains `CANNOT EVALUATE`; the project must provide CI tooling and record
the source/date of any freshness claim.

## Executive assessment

The plugin has strong workflow integrity and safety engineering, but it is not yet ready to claim fully autonomous app shipping. The immediate work is to remove release metadata drift, prove the unexecuted release path, and close or explicitly govern the product-defect classes that the evaluation lab currently cannot detect.

## Action priority

| ID | Priority | Action | Owner | Done when |
|---|---|---|---|---|
| AR-001 | P0 | Align release metadata | release-manager / DevOps | All public metadata reports version 2.0.0 and 29 roles; a consistency check prevents drift — **COMPLETE** |
| AR-002 | P0 | Execute `/app-ship` end to end | release-manager / verification-engineer | A fresh project reaches the ship gate; every step has evidence and a final PASS/FAIL/CANNOT EVALUATE verdict |
| AR-003 | P0 | Finish dry-run 5 pipeline hypotheses | tech-manager | H1, H3, H4, H5, H9, H10, H11, H14 and the remaining H7 live-spawn question have recorded verdicts |
| AR-004 | P0 | Add prompt-injection handling for repository content | security-reviewer | The malicious-repository fixture is detected or explicitly blocked before an agent acts on it — **SHIP-CONNECTED; HUMAN READ-ORDER STILL REQUIRED** |
| AR-005 | P0 | Add privacy-disclosure reconciliation | privacy-reviewer / ASO | Code data collection is compared with store/privacy declarations and mismatches block release — **SHIP-CONNECTED** |
| AR-006 | P0 | Add subscription-restore verification | monetization-engineer / verification-engineer | Restore flows are executed against a fixture or test harness and missing entitlement rehydration blocks release — **SHIP-CONNECTED; STATIC TRIPWIRE** |
| AR-007 | P1 | Add accessibility gate coverage | code-reviewer / QA | The accessibility fixture is detected, and clean UI remains unblocked — **SHIP-CONNECTED; STATIC TRIPWIRE** |
| AR-008 | P1 | Add stale-approval protection | tech-manager / code-reviewer | Approvals bind to a commit or immutable evidence snapshot; later changes invalidate approval |
| AR-009 | P1 | Add requirement-conflict detection | product-validator / CTO | Conflicting PRD and architecture values produce a blocking report with precedence handling — **SHIP-CONNECTED for quota conflicts; broader precedence STILL OPEN** |
| AR-010 | P1 | Add P0 analytics coverage validation | data-analyst | Every P0 feature has required analytics coverage or an explicit waiver — **SHIP-CONNECTED for structured PRD tables** |
| AR-011 | P1 | Detect shared-file collisions before spawning | tech-manager | Board file scopes are compared and conflicting parallel tickets are serialized — **FIXTURE-TESTED for declared primary files; SERIALIZATION STILL OPEN** |
| AR-012 | P1 | Define audit-chain truncation protection | security-reviewer / CTO | The team chooses and implements an anchor strategy, or documents the limitation and trust boundary |
| AR-013 | P1 | Make message ID allocation concurrency-safe | tech-manager | Concurrent writers cannot produce duplicate message IDs — **COMPLETE** |
| AR-014 | P1 | Track all follow-up obligations | tech-manager | `handoff`, `blocker`, and `escalation` obligations are surfaced until delivered, waived, or escalated — **SHIP-READY SEMANTIC CLOSURE FOR DELIVERY EVIDENCE** |
| AR-015 | P2 | Synchronize documentation counts and claims | chief-of-staff | README, marketplace metadata, changelog, handbook, and resume agree on version, role count, and assertion count |

## Detailed work packages

## Completed locally verifiable work

- Metadata consistency is enforced by `scripts/metadata-check.mjs` and CI.
- Repository prompt-injection content is detected by `scripts/injection-scan.mjs` and scored in the lab.
- High-confidence accessibility, privacy, subscription-restore, financial-rounding, requirement-conflict, analytics-coverage, and shared-file detectors are implemented, scored, and the applicable checks are now invoked by `ship-gate.sh`.
- Regression coverage includes release-path enforcement, comment-only bypass attempts, follow-up delivery semantics, and seven new mutation catalogue entries; a two-mutation sample caught 2/2.
- Message IDs are serialized with an atomic lock directory and concurrent-writer coverage.
- Follow-up obligations are surfaced by `board-doctor`, `messages-render`, and the control-room state model.

These detectors are deliberately narrow tripwires, not substitutes for platform auditors or human review. They report high-confidence findings and preserve CANNOT EVALUATE when required artifacts are absent.

### AR-001 — Align release metadata

**Problem:** historical metadata drifted from the canonical plugin manifest. The consistency check now keeps version, role counts, and the current 779-assertion baseline aligned.

**Files:** `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`, `CHANGELOG.md`.

**Acceptance criteria:**

- One canonical version is used everywhere.
- Role count, command count, skill count, and assertion count agree everywhere they are stated.
- CI fails when the public metadata disagrees with the canonical manifest.

**Verification:**

```sh
node scripts/team-doctor.mjs
sh scripts/test.sh
```

### AR-002 — Execute `/app-ship`

**Problem:** The release command has never been exercised end to end.

**Acceptance criteria:**

- Run on a fresh fixture project with a known clean path.
- Run at least one blocked path for an open S1/S2 bug.
- Exercise missing-toolchain behavior and confirm it reports CANNOT EVALUATE.
- Capture the exact artifacts, gate outputs, and final user decision point.
- Update `docs/HANDBOOK.md`, `docs/RESUME.md`, and the dry-run findings with the result.

**Release rule:** Autonomous release remains disabled until this work package is complete.

### AR-003 — Finish dry-run 5

Run the untouched pipeline hypotheses listed in `docs/RESUME.md`: H1, H3, H4, H5, H9, H10, H11, H14, plus the live role-spawn portion of H7. Each hypothesis must have:

1. setup and exact command;
2. expected behavior;
3. observed behavior;
4. PASS, FAIL, or CANNOT EVALUATE verdict;
5. a regression test or a documented reason it cannot be automated.

### AR-004 through AR-011 — Evaluation-lab detector backlog

Each new detector must follow the same proof standard:

- The planted defect causes the detector to block.
- The clean fixture remains clear.
- The detector is mutated or deliberately disabled and the test goes red.
- The detector reports CANNOT EVALUATE when its required input is absent.
- The detector is connected to the appropriate command or release gate.

Do not count an agent instruction as a detector. Skills and agent checklists are useful operating procedures, but they do not provide mechanical release protection unless a runnable gate invokes and verifies them.

### AR-012 — Audit-chain truncation decision

Choose one explicit design:

- committed tip/length anchor;
- external or server-side append-only anchor;
- git-state verification;
- documented limitation with a narrower audit-chain claim.

The decision must state what an attacker with local repository write access can and cannot alter.

### AR-013 — Message ID concurrency

Use the existing worktree locking pattern or an equivalent atomic allocation strategy. Add a test that starts concurrent message writers against one log and verifies unique IDs and valid JSONL output.

### AR-014 — Follow-up obligations

Extend the obligation index so every obligation-producing message kind has a lifecycle:

`open → delivered | waived | escalated`.

The dashboard, board doctor, and standup must surface open obligations. An empty result is only CLEAR when the message log was successfully read and a real population was swept.

## Release checklist

The plugin should not be presented as autonomous-release ready until all of the following are true:

- [x] AR-001 complete: metadata is consistent.
- [ ] AR-002 complete: `/app-ship` has executed end to end.
- [ ] AR-003 complete: dry-run 5 has verdicts for all listed hypotheses.
- [ ] All known S1 evaluation defects are either mechanically detected or explicitly gated by a human-owned release checklist. One S1 class, stale approval, remains without a detector; crash-on-launch still requires the macOS runtime job.
- [ ] The audit-chain limitation has an approved design decision.
- [ ] The full regression suite passes.
- [ ] `team-doctor` passes.
- [ ] Control-room typecheck/build passes.
- [ ] Mutation testing completes with a green baseline and all sampled mutations caught.
- [ ] Documentation is synchronized with the actual implementation state.

## Verification commands

```sh
sh scripts/test.sh
node scripts/team-doctor.mjs
node scripts/studio-eval.mjs
sh scripts/mutate.sh --sample 4
cd control-room && npm run typecheck && npm run build
```

## Current limitations to preserve in user-facing documentation

- The plugin validates that the team followed its recorded plan; it cannot prove the plan reflects the founder's true market need.
- One planted S1 defect class, stale approval, currently has no mechanical detector; crash-on-launch requires the macOS runtime environment.
- `/app-ship` has not yet been exercised end to end.
- Local event-log integrity does not currently detect deletion of trailing log entries.
- Parallel message ID allocation is not concurrency-safe.

## Ownership and next sequence

1. Release-manager/DevOps: complete AR-001.
2. Tech-manager: prepare a fresh fixture and execute AR-002 and AR-003.
3. Security/privacy/monetization leads: implement AR-004 through AR-006.
4. Code-reviewer/data/product/tech-manager: implement AR-007 through AR-011.
5. CTO/security/tech-manager: resolve AR-012 through AR-014.
6. Chief-of-staff: close AR-015 and update the resume state.

Every completed item should add a regression assertion and update this document's checklist in the same change.
