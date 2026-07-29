# Sprint board — SplitEven sprint 11

| ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-100 | F-001 | Rounding mode for the split | ios-developer | code-reviewer | done | 0 | — | M | docs/22-impl-spec-ios.md | Stated in docs/10-prd.md with a measurable outcome | branch feat/APP-100-rounding; last commit 2026-07-29T11:44Z |

## Review ledger (append-only — never edit or delete a line)

| Timestamp | Ticket | Action | Actor |
|---|---|---|---|
| 2026-07-29T08:40Z | APP-100 | requested | ios-developer |
| 2026-07-29T08:41Z | APP-100 | started | code-reviewer |
| 2026-07-29T09:00Z | APP-100 | approved | code-reviewer |

## Branch log (not read by any gate — recorded here so the defect is visible to a human)

| Commit | When | Message |
|---|---|---|
| a1b2c3d | 2026-07-29T08:30Z | Split rounds half-up to the cent |
| e4f5a6b | 2026-07-29T11:20Z | Switch rounding to .bankers for consistency |
| 9c8d7e6 | 2026-07-29T11:44Z | Update fixtures for the new rounding |
