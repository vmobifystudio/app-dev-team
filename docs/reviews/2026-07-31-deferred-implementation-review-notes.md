# Deferred Implementation Review Notes

**Captured:** 2026-07-31  
**Status:** implementation review completed; retained as the preliminary evidence log  
**Architecture rubric:** `docs/reviews/2026-07-31-ai-development-team-strategy-architecture-review.md`  
**Reviewed revision:** `3b3d75d` plus the uncommitted working-tree changes listed below

## Purpose

These notes preserve implementation observations made before the review was correctly reframed around
strategy, organizational architecture, and foundations. The implementation phase has now reproduced
and classified them. The authoritative findings, conformance matrix, revised rating, and Wave 0 action
plan are in sections 17–24 of the architecture review linked above. This file remains the preliminary
evidence log and does not authorize fixes by itself.

## Snapshot warning

The working tree changed during the review. At the latest observation it contained modifications not
created by this review:

- `scripts/board.mjs`
- `scripts/capability-check.mjs`
- `scripts/risk-router.mjs`
- `scripts/run-ledger.mjs`
- `scripts/test.sh`

Because the snapshot was moving, line references and test outcomes must be rechecked after the work is
committed or otherwise stabilized.

## Verification evidence captured

- Plugin metadata reported version `2.0.0`.
- Team inventory resolved to 29 roles, 31 skills, and 27 commands.
- `team-doctor` reported the team definition coherent.
- Metadata and local dependency-policy checks were clear.
- Studio evaluation caught 12/12 scored planted defects with 0/3 false blocks; its own output still
  excluded stale approval because no detector was assigned to that scenario.
- The general evaluation manifest ran two cases: team-definition coherence and warm/cold manager
  state comparison.
- Control-room typecheck and build passed.
- A complete suite run against an earlier working-tree snapshot reported 803 passed and 0 failed.
- After concurrent lease-related edits appeared, the suite reported **804 passed and 3 failed**. The
  three failures were the new ticket-lease integration assertions.

## Preliminary findings (now classified in the main report)

### IMP-001 — The new ticket-lease critical section is not atomic

The run ledger performs read → check → append without a cross-process lock or transactional store.
Two concurrent starts for the same ticket both succeeded on the first adversarial attempt, producing
two records whose hash-chain ancestry conflicted. `run-doctor` then reported a broken chain.

The concurrently edited `board.mjs` defined a lease helper, but at the observed snapshot the helper
was not invoked by the claim transition. The accompanying new tests therefore failed.

**Later review:** stabilize the branch; reproduce concurrency; define transactional ownership and
idempotency semantics before choosing an implementation.

### IMP-002 — Approval binding appears optional and disconnected from normal approval creation

The approval checker expects commit, diff hash, context snapshot, and evidence hash when strict policy
is enabled. Normal board approval creation did not appear to construct this structured evidence, and
the studio evaluation still described stale approval as lacking a detector.

**Later review:** trace the full approval lifecycle from reviewer decision through changed commits,
merge, release candidate, and invalidation. Verify repository-root handling and material-change rules.

### IMP-003 — A repository-local audit sidecar is not an external trust anchor

The audit anchor records the board-log digest and tip in another repository file. This can detect a
log change when the sidecar is held fixed, but a party able to rewrite both files can establish a new
consistent history.

**Later review:** evaluate the stated threat model and choose a committed, protected, signed, or
external anchoring authority consistent with that model.

### IMP-004 — Context manifests provide provenance, not yet a full context compiler

The observed implementation records explicitly supplied source hashes, precedence metadata, Git
revision, omissions, and a byte-based token estimate. It does not itself appear to compile bounded
content, select mandatory sources, detect semantic conflicts, resolve superseded decisions, or enforce
a context budget.

**Later review:** compare the implementation with the approved context-package contract and avoid
calling provenance metadata a complete compiler unless compilation semantics are implemented.

### IMP-005 — Promoted memory retrieval loses the proposed payload

An isolated reproduction proposed a memory with content and then promoted it. Listing memory emitted
the latest review event, which contained the decision and rationale but not the original content,
class, scope, confidence, expiry, supersession, or contradiction fields.

**Later review:** define the canonical reduced memory view, expiry behavior, domain approval,
contradiction resolution, version applicability, and concurrent-write guarantees.

### IMP-006 — Empty governance registries can report success

At the observed snapshot:

- the capability manifest had no roles;
- the impact map had no rules;
- the prompt registry had no entries;
- the schedule had no tasks.

The prompt-registry verifier reported clear with zero entries, and the scheduler successfully returned
an empty ready queue. Structurally valid but uninitialized controls should not be represented as
operational governance.

**Later review:** define `UNINITIALIZED`, `NOT APPLICABLE`, `CLEAR`, and `CANNOT EVALUATE` semantics for
each control and require coverage of the active team/project.

### IMP-007 — Dispatch success does not prove that the requested ticket is dispatchable

The unified preflight invokes context, scheduler, capability, and risk checks, but the observed
interface did not accept a ticket identity or verify that the intended ticket appeared in the
scheduler's ready result. It also did not compose every architectural readiness dimension.

**Later review:** derive the dispatch contract from the approved orchestration architecture before
changing the script.

### IMP-008 — Incident lifecycle reduction accepts repeated resolution

An isolated reproduction opened and resolved one incident, then successfully resolved the same
incident a second time. The open check considered any earlier non-resolved event rather than reducing
to the incident's latest valid state.

**Later review:** define the incident state machine, reopening semantics, release-health relationship,
post-incident requirements, and state-transition authority.

### IMP-009 — Manager failover currently appears advisory

The observed failover command derives HOLD or FAILOVER from run records but did not itself verify the
ledger hash chain or record an ownership-transfer/failover event. The warm/cold harness compared a
deterministic reducer rather than exercising an actual manager runtime.

**Later review:** test cold recovery against the approved recovery contract, including pending side
effects, worktree/commit state, reviewer obligations, and authoritative ownership transfer.

### IMP-010 — Behavioral evaluation coverage is much narrower than the stated team scope

The general evaluation manifest contained two cases. The broader studio defect laboratory is useful,
but it primarily evaluates governance detectors. Role contracts, role pairs, handoffs, full workflows,
recovery, adversarial decision quality, and long-horizon behavior require separate evaluation suites.

**Later review:** derive the evaluation portfolio from Wave E of the architecture report.

### IMP-011 — Capability, impact, scheduling, and risk controls are narrower than their strategic names

The observed capability model focused on operation and path prefixes; impact used regex-to-consumer
declarations; scheduling used dependency/status/priority/capacity fields; risk routing used regexes over
file/change text. These are useful primitives, but they do not yet represent the complete strategic
contracts implied by operation-level authority, semantic propagation, portfolio scheduling, and risk
governance.

**Later review:** preserve useful primitives while renaming or extending them according to the
approved architecture. Do not infer broad enforcement from narrow checks.

### IMP-012 — Documentation state and metrics need one generated source

The handbook reported 26 commands and 48 top-level scripts while the observed inventory reported 27
commands and 50 top-level scripts. Its current-state correction and retained historical limitations
also created ambiguity about whether approval and audit findings were closed or still open.

**Later review:** distinguish target architecture, implemented capability, enabled policy, verified
behavior, runtime-proven behavior, and known limitation. Generate volatile counts instead of manually
maintaining them.

## Deferred implementation-review method

When the architecture is approved and the working tree is stable:

1. Tag the exact revision under review and capture the environment.
2. Map every role, skill, command, script, hook, workflow, schema, and document to the approved planes
   and lifecycle stages.
3. Identify missing, duplicated, contradictory, dead, optional, and fail-open paths.
4. Reproduce every provisional item above with isolated fixtures.
5. Run clean controls to measure false blocks.
6. Test concurrency, interruption, recovery, stale context, changed approvals, and duplicate side
   effects adversarially.
7. Test role, handoff, workflow, and long-horizon behavior separately from schema checks.
8. Produce a severity-ranked implementation report and only then create the coding backlog.

## Completion record

The later audit completed this method and produced the following final classifications:

- **Confirmed:** IMP-001 and reproduced at scale: 56/60 concurrent pairs double-started and 49/60
  resulting ledgers failed integrity verification.
- **Confirmed with in-flight improvement:** IMP-002 gained a `--bind` producer and manager check,
  but descendant commits still passed and the ship gate did not supply current HEAD.
- **Confirmed:** IMP-003 through IMP-012 remain valid at the captured implementation snapshot.
- **Additional critical integration finding:** strict controls were enabled for new projects without
  a complete producer/terminalization path, making the documented golden journey unsatisfiable.
- **Latest complete regression run:** 818 passed, 0 failed. This does not include adequate
  concurrency, exact-candidate, role/handoff, or long-horizon behavioral assertions.

The development response is **Wave 0 — Integration Closure**, defined in section 23 of the main
report. It precedes feature expansion and converts the existing primitives into vertical lifecycle
slices that provision, admit, enforce, record, terminalize, recover, and evaluate each control.
