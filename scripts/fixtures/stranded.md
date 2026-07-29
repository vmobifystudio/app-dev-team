# Sprint board — a blocked dependency strands its dependents

| ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-001 | F-001 | Foundation | android-developer | code-reviewer | blocked | 2 | — | S | prd#F-001 | GWT | cap hit |
| APP-002 | F-002 | Depends on it | android-developer | — | todo | 0 | APP-001 | M | prd#F-002 | GWT | — |
| APP-003 | F-003 | Transitive | ios-developer | — | todo | 0 | APP-002 | S | prd#F-003 | GWT | — |

## Review ledger (append-only — never edit or delete a line)

| Timestamp | Ticket | Action | Actor |
|---|---|---|---|
| 2026-07-29T09:00Z | APP-001 | requested | android-developer -> code-reviewer |
| 2026-07-29T09:30Z | APP-001 | changes | code-reviewer |
| 2026-07-29T10:00Z | APP-001 | changes | code-reviewer |
