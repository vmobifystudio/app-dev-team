# Consolidated enhancement plan — from 20 audits, verified against code

**Date:** 2026-08-04
**Method:** All 20 review/dry-run/research documents read in full (4 parallel readers), then every
high-value claim **re-verified against the current tree** rather than trusted. Several audit claims
are already stale; they are marked so below. Nothing in this plan is carried forward on an audit's
say-so alone.
**Base:** `main` at `b3676a3`, 929 assertions passing, team-doctor coherent.

---

## STATUS — 2026-08-04, Phase 0 + Phase 4 landed

| Item | State | Proof |
|---|---|---|
| **0.1** runtime-gate evidence-optional PASS | **FIXED** (both iOS and Android paths) | 4 assertions incl. a mirror test that restores the old behaviour and watches a PASS reappear |
| **0.3** metadata drift + checker blind spot | **FIXED** | plugin.json 29→30; checker now inspects every manifest and rejects the "to a shipped app" overclaim; both mirror-tested |
| **0.5** stale eval narratives | **FIXED** + made self-detecting | `last_verified_at` on all 16 manifests; a regression forbids the corrected claim from returning; workflow paths must resolve |
| **4.2** adversarial review institutionalized | **DONE** | `defect-hunting` §4b + required in `code-reviewer.md`, 8 assertions incl. mirror test |
| **0.2** ship-gate `--head` | **FIXED**, verification in progress | see §1.1 V-2 |
| **4.1** journey gate | Not started — deferred deliberately, see below | |

**Two findings the work itself produced, both worth more than the fixes:**

1. **The new anti-staleness check caught a second live instance on its first run** — `eval/ci-that-cannot-fail` named `.github/workflows/ci.yml`. That turned out to be the *fixture's own* planted-defect file, not a broken reference, so **the check was wrong, not the manifest**: a false positive on its very first execution. Fixed by resolving fixture-relative paths before plugin-relative ones. Recorded here because `eval/clean` exists precisely to make false positives expensive, and this one was caught by the suite rather than by a reader.
2. **The prompt registry blocked the `code-reviewer.md` edit until re-synced**, and `eval-lab`'s `team-definition-is-coherent` case failed with it. Two independent controls noticed one edit. That is the governance layer working exactly as designed, on the person editing it.

---

## 0. The one-paragraph answer

The plugin is a genuinely strong **process-integrity engine** and a weak **product-correctness
engine**. Its gates reliably catch state, sequencing, evidence and provenance defects — that part is
real and better than most things of its kind. But across six dry runs, **not one product defect was
caught by a gate**: the discarded date picker, the silent corrupt-data fallback, the 24dp touch
target, the stale TalkBack announcement, the self-stubbing device test — every one came from an
adversarial reviewer or a human audit. Meanwhile the same six or seven structural gaps recur run
after run, because **every dry run so far declared a "fixture-and-report-only" change boundary**:
findings were written down and handed off, never landed. That is the highest-leverage thing to
change, and it costs nothing to change.

---

## 1. What I verified myself (not taken on trust)

### 1.1 Confirmed REAL — live in the tree today

| # | Finding | Verified how | Severity |
|---|---|---|---|
| **V-1** | `scripts/runtime-gate.sh` **returns PASS when screenshot capture fails** — `rm -f "$SHOT"; pass "android" "...Screenshot capture failed — no evidence artifact."` | Read the code path directly | **High.** This is an evidence-optional pass, the exact class this repo's own three-state doctrine forbids. A gate that passes without its evidence is a gate that cannot fail for the reason it exists. |
| **V-2** | `approval-check.mjs:35` uses `merge-base --is-ancestor` (ancestor, not exact) **and** `ship-gate.sh:245` invokes it **with no `--head`** — so even the ancestor check never runs at release time | Read both call sites | **High.** Combined with the squash-merge incompatibility found in dry run 3, release-time approval binding is effectively unenforced. |
| **V-3** | Metadata drift: `.claude-plugin/plugin.json` says **"29 role"**, `marketplace.json` says **"30-role"**, actual count is **30** | `grep` + `ls agents/*.md \| wc -l` | Low severity, high symbolism — the plugin misreports itself, and `metadata-check.mjs` returns CLEAR because it only inspects the marketplace description. |
| **V-4** | **No workflow engine exists.** No `orchestrator.mjs`, `lib/workflow.mjs`, `project-profile.mjs`, `toolchain-doctor.mjs`, `candidate.mjs`, `journey-gate.mjs`. The sprint loop is **567 lines of prose** in `commands/app-build.md` (9 numbered steps), plus 357 lines in `tech-manager.md` | Directly listed; counted lines | **Structural.** See §3. |

### 1.2 Confirmed ALREADY FIXED — audits are stale on these

| Claim | Audit source | Actual state |
|---|---|---|
| QA `HOLD` is only a `note()`, gate still clears | app-ship audit SHIP-P0-004 | **Fixed.** Now a structured `^QA VERDICT:\s*HOLD\b` → `block()`; a plan with no verdict line is CANNOT EVALUATE, not a silent pass. |
| Waivers are global and permanent | app-ship audit SHIP-P0-005 | **Mostly fixed.** `waiver_for()` now requires a 4th field matching the canonical version. Still missing: expiry date, policy version, authenticated human. |
| `dispatch-preflight.mjs` takes no ticket | enhancement plan P0.2 | **Fixed** (PR #19). `--ticket` required and checked against the scheduler's ready set. |
| `board.mjs` discards run identity on claim | enhancement plan P0.2 | **Fixed** (PR #19). `run_id`/`attempt_id`/`lease_until` recorded on the `claimed` event. |
| Roles don't defer to better local skills | self-improvement plan Phase 1 | **Already existed.** 11 of 30 role files carry external-and-optional degrade language, with a named incident (DR4-011) and a mirror-tested regression. |

**Lesson for how we use audits:** the 2026-08-03 enhancement plan and the audit written the same day
contradict each other on four points (dispatch `--ticket`, run identity, its own "first slice" items
4–5, and the assertion count 920 vs 925). The plan was written against a tree that had already moved.
**Any audit older than the last merge must be re-verified before it drives work** — which is exactly
what this document did.

### 1.3 Unverifiable by design — flagged, not actioned

The audits contain ~20 numeric scores (7.4/10, 8.1/10, 6.8/10, 13 rescored dimensions to one decimal)
with **no rubric, no denominator, and no scoring script**. They are editorial judgments. They are
useful as direction, useless as measurement, and they should not be treated as a baseline anything
gets compared against. Note the irony the dry-run readers caught: the readiness charter explicitly
forbids averaging dimensions ("must never be calculated as an average that hides a critical blocker"),
and then several reports publish a single averaged maturity score.

Also: the four adversarial fixtures backing the audit's headline S1 findings (F-01, F-02, F-04, F-05)
were **never committed** — the audit states no source was edited. Those four proofs are not currently
re-runnable. Rebuilding them is a task, not an assumption.

---

## 2. The recurrence signal — what actually matters

Findings that appear once are opinions. Findings that recur across independent runs are structure.
Ranked by independent appearances:

| Rank | Recurring finding | Appears in | Movement across runs |
|---|---|---|---|
| **R1** | **No release-candidate aggregate.** `/app-ship` is a bag of gates, not a submission pipeline. No candidate identity, artifact hash, verdict bundle, founder-action ledger, handoff manifest. | 4 of 6 dry runs + strategy review + app-ship audit | **Scored 4/10 twice. The only dimension that never moved.** |
| **R2** | **Readiness is computed independently by three surfaces** (CLI, dashboard, control room) and can contradict the authoritative gate. | 4 of 6 dry runs | Partially improved (false `clear` fixed); root cause untouched — still three reducers. |
| **R3** | **Genuinely concurrent multi-agent execution is unproven.** | 4 of 6 dry runs | Sequential isolation **closed** by dry run 3. Parallel agents on independent tickets, retry escalation, crash recovery: **still open in every report.** |
| **R4** | Template prose containing `WAIVED:` trips the founder gate. | 2 runs | **Reproduced verbatim in the next run** because run 1 fixed the fixture, not the system. Now genuinely fixed in code. |
| **R5** | Trace grammar is undiscoverable; **the templates generate documents the validator rejects.** | 2 runs, different failure each time | Open. The generator is the defect, not the author. |
| **R6** | Planner can assign an owner the build loop cannot spawn; validation is post-hoc. | 2 runs | Open — avoided in run 2 only by manual ticket design. |
| **R7** | `verified_static` correctly blocks closure but strands the ticket with **no generated follow-up action**. | 2 runs | Open. Behavior right, operational consequence unhandled. |
| **R8** | QA verdict / evidence is unstructured prose, not bound to candidate+artifact+environment+timestamp. | 4 of 6 | Partially fixed (QA verdict line now structured and blocking). Evidence provenance still absent. |
| **R10** | AGP 9 / Kotlin / KSP toolchain incompatibility broke the build in two different fixtures. | 2 runs | Open. Argues for a validated toolchain profile. |
| **R11** | Accessibility evidence absent everywhere it isn't explicitly forced. | 4 of 6 | Open. |

---

## 3. The two structural problems underneath everything

Nearly every recurring finding reduces to one of these two.

### 3.1 The workflow is interpreted, not executed

The sprint loop lives as **567 lines of prose** in `commands/app-build.md`. Individual checks are real
scripts with real exit codes, but the **sequencing, retry behavior, ownership handoff, and recovery
contract** are inferred by whichever agent is reading the file.

The proof is not theoretical. In dry run 3, **the orchestrator itself skipped a mandated transition** —
sent a ticket straight to `code-reviewer`, bypassing `verify-done → verified → review_requested`. The
board's transition guard refused to forge the event, so nothing broke. But the person driving that run
had *written* that sequence, in the same session, and still violated it. Combined with DR4-027 — where
the operator who had spent a day hardening the isolation rule then spawned two writers into one
checkout and lost 22 files — the pattern is unambiguous:

> **Knowing a rule, having written it, and having defended it does not make you apply it.**
> A rule survives only as a mechanism that runs, not a convention someone remembers.

Everything sequencing-related recurs because sequencing has no owner in code.

### 3.2 Gates verify the process, not the product

Across six dry runs, the gates caught: version mismatch, QA hold, illegal board transitions, an
unspawnable owner, a fake test command, an incoherent board. Real defects, genuinely caught.

They caught **none** of: the date picker that discarded the user's selection and saved
`System.currentTimeMillis()` (found by three separate reviews, never by a gate); the corrupt-JSON
fallback that silently returns an empty list, indistinguishable from data loss; the async `apply()`
durability gap; the 24dp touch target where 56dp was required; the TalkBack announcement that stayed
stale; the device test that exercised its own stub instead of the app.

Every one came from an **adversarial reviewer** or a **human-style audit**. The most valuable behavior
observed in any dry run — a reviewer re-measuring on-device with `uiautomator` instead of trusting the
developer's numbers, then reintroducing the bug to prove its own regression test would catch it — was
**emergent, unprompted, and required by nothing.**

This is the honest answer to "will this help in real life": it will keep the *process* honest and it
will not, today, tell you the *product* is right.

---

## 4. The meta-finding: why the same things keep recurring

Every dry run so far declared a change boundary of **fixture-and-report-only**. Findings were
documented and handed off. Run 1 found the `WAIVED:` false positive and fixed it by deleting text from
its own fixture; run 2 hit the identical bug. The report says so plainly: *"made the graph pass, but
this is not a durable system fix."*

R4, R5, R6 and R7 all recur for exactly this reason.

**The change that costs nothing:** a dry run's deliverable is a *merged system fix with a mirror-tested
regression*, not a report. If a finding cannot be landed in the same session, it becomes a tracked
proposal with an owner — never a paragraph in a document nobody re-reads. This session already proved
the model works: dry run 3's four findings became PR #17 with mirror-tested regressions the same day.

---

## 5. The plan

Sequenced so each phase makes the next one cheaper, and so nothing large is built before the thing
that would tell us whether it worked.

### Phase 0 — Truth repair (small, immediate, unblocks honest measurement)

Everything here is verified-real and small. None of it requires a design decision.

| Item | Change | Proof it worked |
|---|---|---|
| **0.1** | **`runtime-gate.sh`: screenshot failure must be CANNOT EVALUATE, not PASS.** (V-1) | Mirror test: force screencap failure, assert exit 2 and that the reason names the missing evidence. |
| **0.2** | **Pass `--head` from `ship-gate.sh` to `approval-check.mjs`**, and decide ancestor-vs-exact deliberately rather than by omission. (V-2) | Reproduce: approve commit A, add commit B, assert release-time refusal. |
| **0.3** | **One canonical metadata source**; generate the plugin description, marketplace description, README counts and handbook inventory from it. Extend `metadata-check.mjs` to inspect **every** manifest, not just the marketplace. (V-3) | Mirror test: hand-edit one manifest count, assert the check goes red. |
| **0.4** | **Commit the four missing adversarial fixtures** (stale-green readiness, checklist-only submission, non-atomic admission, orphan run) so the audit's headline claims become re-runnable rather than asserted. | Each fixture runs in CI and fails before its fix. |
| **0.5** | **Correct the stale eval manifests** — `eval/stale-approval` still claims approval binding doesn't exist; the crash-on-launch fixture names the wrong workflow file. Add the lifecycle fields (`status`, `fixed_in`, `last_verified_at`) so an eval case can't silently contradict the code again. | `studio-eval.mjs` fails when a case's narrative contradicts its detector. |

**Why first:** every one is verified, none needs a decision, and 0.3/0.5 stop the system from lying
about itself — which is a prerequisite for trusting any later measurement.

### Phase 1 — Make the loop executable (the structural fix, done narrowly)

This is §3.1. It is the single highest-value change and also the easiest to over-build. Do it
**read-only first**, so it can be compared against the prose before anything depends on it.

| Item | Change |
|---|---|
| **1.1** | `docs/team/workflow.json` — the sprint's states, legal transitions, required inputs, owning role, and entry/exit gates, expressed as data. This is **transcription of `app-build.md`, not redesign.** |
| **1.2** | `scripts/orchestrator.mjs` with **read-only** commands: `status`, `next`, `explain <ticket>`. It answers "what is legal now, and why" from the board's own event log. It **mutates nothing.** |
| **1.3** | Run it *alongside* the prose loop for one dry run. Every place the orchestrator's `next` disagrees with what the operator actually did is a finding — about the workflow model, the prose, or the operator. |
| **1.4** | Only after 1.3 produces agreement: let `app-build.md` cite `orchestrator next` as the authority, and reduce the prose to explanation. |

**Deliberately not in scope:** mutation commands (`claim`, `advance`, `record-result`), recovery
automation, retry policy. Those are Phase 3, after the model has been proven to describe reality.

**Why this order:** a workflow engine that mutates state before its model has been validated against a
real run is a second source of truth — the exact failure the control room was carefully designed to
avoid.

### Phase 2 — The release candidate (R1: the only dimension that never moved)

R1 is the strongest recurrence in the corpus and the lowest-scoring dimension in every report.

| Item | Change |
|---|---|
| **2.1** | `release-candidate/v1` — commit, platform, variant, artifact path + SHA256, toolchain/dependency/policy fingerprints, created_at/by. One aggregate every gate reads. |
| **2.2** | `gate-result/v1` — a common envelope: gate, candidate_id, result (PASS/BLOCKED/CANNOT_EVALUATE), tool+version, environment, evidence paths, started/completed. Replaces prose verdicts and Markdown-line greps. |
| **2.3** | **Staleness by construction:** a gate result whose candidate's commit, artifact hash, lockfile, toolchain, or policy version has changed is `STALE` — visibly distinct from both pass and fail, and never counted toward readiness. |
| **2.4** | **One reducer** computes readiness. CLI, zero-dep dashboard and control room all read it (R2). The UI never owns readiness math. |

**Why after Phase 1:** the candidate is what gates *attach to*; knowing which gates run in what order
makes the attachment points obvious rather than guessed.

### Phase 3 — Close the recurring operational gaps

Small, well-understood, each with a named recurrence behind it.

| Item | Recurrence | Change |
|---|---|---|
| **3.1** | R7 | `verified_static` generates a real follow-up action with a named owner, instead of stranding the ticket. |
| **3.2** | R6 | Owner validated at ticket-creation time against the spawnable-owner set — not after the board is populated. |
| **3.3** | R5 | Fix the **generator**: the PRD/SRS templates must emit documents `trace.mjs` accepts, with one canonical declaration site. An author should never need to read the tracer's source to write a valid PRD. |
| **3.4** | R10 | `project-profile.json` + `toolchain-doctor.mjs`: pin and verify JDK/SDK/AGP/Kotlin/KSP/variant/test-commands **before** implementation is dispatched, not when the build breaks. |
| **3.5** | — | Orchestrator gains mutation commands + recovery, now that Phase 1.3 has validated the model. |

### Phase 4 — Product correctness (§3.2: the honest gap)

The gates verify process. Nothing verifies the product. Two mechanisms, both modest:

| Item | Change |
|---|---|
| **4.1** | **Journey gate.** `docs/team/journeys/*.json` declaring P0 user journeys as steps + assertions against stable selectors. A runtime PASS must prove a declared journey completed — not that a process is alive. Missing evidence → CANNOT EVALUATE. This directly closes V-1's root cause rather than patching its symptom. |
| **4.2** | **Institutionalize adversarial review.** The best behavior in any dry run (re-measure rather than trust; reintroduce the bug to prove the regression catches it) is currently a reviewer's good day. Make it a named, required step in the review contract with a stated output, so it stops being emergent. |

**Honest caveat:** 4.1 raises the floor from "it launched" to "one journey works." It does not make the
team notice that a date picker's value is discarded. That class needs either a human, or an
adversarial reviewer given the explicit instruction to verify user-visible values end-to-end — which
is what 4.2 is for.

### Phase 5 — Prove concurrency (R3: open in every single report)

Sequential isolation is closed. **Genuinely parallel agents on independent tickets have never run.**

| Item | Change |
|---|---|
| **5.1** | A dry run that spawns 2–3 writers **concurrently** on genuinely independent tickets, each in its own worktree, and observes: lease contention, ledger integrity under concurrent append, merge order, and whether `spawn-gate` actually holds. |
| **5.2** | Atomic append for every chained ledger. The strategy review measured **56/60 double-starts** and **49/60 corrupted ledgers** under concurrency; `run-ledger.mjs` now has an O_EXCL lock (added this session) — **re-measure both numbers** rather than assuming the lock generalized. |
| **5.3** | Retry escalation and crash recovery, exercised for real: kill an agent mid-ticket and prove the lease expires, the run terminalizes, and the ticket becomes reclaimable. |

---

## 6. How dry runs change (the meta-fix)

The single highest-leverage process change, and it costs nothing.

1. **A dry run's deliverable is a merged fix, not a report.** Findings that can't land in-session
   become tracked proposals with owners — never a paragraph in a document nobody re-reads.
2. **Fix the system, never the fixture.** If a run gets past a gate by editing its own fixture, the
   finding is *not closed* — R4 proved this by recurring verbatim in the next run.
3. **Commit hypotheses first, and aim at the untested.** Dry run 4 falsified zero hypotheses and
   correctly called that a warning: its hypotheses were calibrated to fixes made hours earlier. Dry
   run 5 aimed at untested ground and falsified two of six. **A hypothesis nobody has probed carries
   no information at all.**
4. **Before believing a refusal, name the layer you expected it from.** Three of six probes in dry run
   5 were answered by an earlier layer than the one under test — and *every time the wrong result
   looked like a pass.*
5. **State the population you swept.** A clearance claim without its denominator is not a clearance.
6. **The product under evaluation is the AI team, not the app.** Two of six reports optimized the
   wrong thing — they audited the test-vehicle app far more thoroughly than the system that built it.

---

## 7. Sequencing and honest cost

| Phase | Size | Risk if skipped |
|---|---|---|
| **0 — Truth repair** | Small; do now | The system misreports itself; no later measurement is trustworthy |
| **1 — Executable loop (read-only)** | Medium | Every sequencing finding keeps recurring |
| **2 — Release candidate** | Medium-large | R1 stays at 4/10 forever; readiness stays unfalsifiable |
| **3 — Recurring gaps** | Small each | Known, named, cheap defects keep costing runs |
| **4 — Product correctness** | Medium | The team stays unable to tell you the app is wrong |
| **5 — Concurrency** | Medium | The core parallelism claim stays unproven |

**Recommended immediate action:** Phase 0 in full (small, verified, no decisions pending), then Phase
1.1–1.3 paired with the next dry run — so the workflow model is validated against a real run instead
of against my reading of the prose.

**What this plan deliberately does not do:** it does not adopt the audits' numeric scores as
baselines; it does not build the full six-dimension readiness model before two dimensions have proven
useful; it does not add roles (the corpus is consistent that role proliferation is a cost, not a
feature); and it does not touch the human-owned publishing boundary, which every document agrees is
correct as-is.
