# Sprint board — a ticket that spent its whole review budget and then merged

Cycles = 3 against a cap of 2, on a ticket that is `done` with an approved-and-merged ledger. That
is a finished ticket, not an anomaly: the cap governs what should happen NEXT, and nothing happens
next on a merged ticket. Firing here turned the pre-spawn gate permanently red on any sprint that
had ever used its review budget.

| ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-001 | F-001 | Login | android-developer | code-reviewer | done | 3 | — | M | prd#F-001 | GWT | budget fully spent |

## Review ledger (append-only — never edit or delete a line)

| Timestamp | Ticket | Action | Actor |
|---|---|---|---|
| 2026-07-29T09:00Z | APP-001 | requested | android-developer -> code-reviewer |
| 2026-07-29T09:10Z | APP-001 | started | code-reviewer |
| 2026-07-29T09:20Z | APP-001 | changes | code-reviewer |
| 2026-07-29T09:40Z | APP-001 | changes | code-reviewer |
| 2026-07-29T10:00Z | APP-001 | changes | code-reviewer |
| 2026-07-29T10:20Z | APP-001 | approved | code-reviewer |
| 2026-07-29T10:30Z | APP-001 | merged | tech-manager |
