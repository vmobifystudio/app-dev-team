# PRD

| ID | Requirement | Trace |
|---|---|---|
| [F-001] | One-tap meal log | src: G-001 · ver: product-validator · rev: 2026-07-22 |
| [F-002] | Share a week to a friend | src: G-002 · ver: product-validator |
| [F-003] | Weekly summary | src: G-001 · ver: product-validator · rev: 2026-07-25 |
| [F-004] | Export history | src: G-001 · ver: product-validator · state: fine |

## Acceptance criteria

- [AC-001] Given the home screen, When I tap Log, Then the entry is saved — src: F-001 · ver: T-001
- [AC-002] Given four exports, When I open history, Then it lists them — src: F-004 · ver: nobody
- [AC-003] Given a week of entries, When I open Summary, Then totals appear — src: F-003 · ver: T-003

claim: export-format = CSV
