# Test plan

Exit criteria: every P0 acceptance criterion in docs/10-prd.md has an executed row below, and every
row below names a criterion the PRD actually defines.

<!-- The second half of that sentence is not decoration. This file carried a TC-02 row reporting
     "F-002 upgrade completes and unlocks Pro | PASS", with a build number and a simulator
     timestamp — for a feature docs/10-prd.md never defines and src/ never implements. Fabricated
     evidence, in the ONE fixture whose entire job is to be genuinely defect-free.

     Two consequences, and the second is worse. First, this was not a valid clean baseline: the
     false-positive rate was being measured against a project that already contained a defect.
     Second, the moment a traceability detector checks for orphan test criteria it would correctly
     block this project, and the lab would score that correct block as a FALSE POSITIVE — teaching
     us to weaken a working detector.

     Caught in review by codex on PR #9. -->

| Case | Criterion | Result | Evidence |
|---|---|---|---|
| TC-01 | F-001 split rounds half-up to the cent | PASS | build 41, simulator run 2026-07-29T14:02Z |

QA VERDICT: GO
