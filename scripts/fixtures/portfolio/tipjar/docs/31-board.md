# Sprint board

<!-- GENERATED FILE — do not hand-edit.
     Rendered from docs/31-board-events.jsonl by scripts/board.mjs.
     Mutate the board with `node scripts/board.mjs move <ID> <event> --by <role>`;
     a hand edit is silently overwritten by the next render and is invisible to every rule. -->

Generated 2026-07-29T14:35:17.479Z from 3 ticket(s).

| ID | Feature | Title | Owner | Reviewer | Status | Cycles | Depends on | Estimate | Spec | Acceptance | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| APP-001 | F-001 | Split calculation model | ios-developer | — | blocked | 0 | — | S | impl-spec-ios sec 4.2 | Given a bill of 100.00, When split 3 ways, Then each share is 33.34 | Touches: TipJar/TipCalculation.swift |
| APP-002 | F-002 | Calculator screen | ios-developer | — | todo | 0 | APP-001 | M | impl-spec-ios sec 4.1 | Given a cold launch, When the calculator appears, Then the bill field is first responder | Touches: TipJar/CalculatorView.swift |
| APP-003 | F-003 | Export the split as text | ios-developer | code-reviewer | review (static only) | 0 | — | S | impl-spec-ios sec 5 | Given a computed split, When I tap share, Then a plain-text summary is offered | Touches: TipJar/ShareSheet.swift |

## Review ledger (append-only — never edit or delete a line)
Derived from the event log. Action is exactly one of: `requested` `started` `changes` `approved` `merged`

| Timestamp | Ticket | Action | Actor |
|---|---|---|---|
| 2026-07-29T14:35:17.477Z | APP-003 | requested | ios-developer -> code-reviewer |
