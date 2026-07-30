## Team messages (append-only — never edit or delete a line)

| Timestamp | From | To | Ticket | Kind | Summary | Body |
|---|---|---|---|---|---|---|
| 2026-07-29T14:35Z | spec-critic | tech-lead | APP-001 | question | Does an empty bill field parse to 0, or is it an error? | — |
| 2026-07-29T14:35Z | tech-lead | spec-critic | APP-001 | answer | Empty parses to 0 | Decided: strip non-digits, empty string yields 0. Updated in place. |
| 2026-07-29T14:35Z | spec-critic | tech-lead | APP-002 | question | numberPad or decimalPad, given the strip-non-digits rule? | — |
| 2026-07-29T14:35Z | tech-lead | spec-critic | APP-002 | answer | numberPad only | The separator key is unreachable under the strip rule. Folded into docs/22-impl-spec-ios.md section 9. |
| 2026-07-29T14:35Z | qa-engineer | tech-manager | APP-003 | question | Which locale does the share text use? | — |
