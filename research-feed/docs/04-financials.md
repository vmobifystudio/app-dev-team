# Phase 2c: Financials

> Not financial advice. Every input is an assumption unless marked given. Change any yellow cell in `finance/research-feed-financials.xlsx` and everything recalculates. Rebuild with `npm run finance`.

**Verdict: the brief's target mix loses $616 a month. Breakeven needs 591 Pro users with 8 sponsored stories, or 10 sponsored stories with 500 Pro users. Only the bull case gets there inside 12 months.**

## The brief's math, checked

| Line | $ per month |
|---|---|
| 500 Pro x $8.05 | 4,025 |
| 8 sponsored x $500 | 4,000 |
| **Revenue** | **8,025** |
| Team | 8,000 |
| Serving 12,500 readers x $0.05 | 625 |
| Stories 40 x $0.40 | 16 |
| **Real result** | **-616** |

Pro net after fee: $9.00 - (5% x $9.00 + $0.50) = **$8.05**. A test checks this (`billing.test.js`).
Annual plan: $79 - (5% x $79 + $0.50) = $74.55, which is $6.21 a month. Annual buyers are worth less per month than monthly buyers. They churn less. We do not know by how much.

## Three scenarios (month 12)

| | Base | Bear | Bull |
|---|---|---|---|
| Free readers | 12,500 | 6,000 | 25,000 |
| Conversion (assumption) | 4% | 2% | 6% |
| Pro users | 500 | 120 | 1,500 |
| Paid sponsored stories | 8 | 3 | 12 |
| Sponsored price (assumption) | $500 | $400 | $600 |
| Revenue | $8,025 | $2,100 | $19,275 |
| Cost | $8,641 | $8,500 | $9,018 |
| **Net** | **-$616** | **-$6,400** | **+$10,257** |
| First month at or above $0 | not in 12 months | not in 12 months | month 7 |
| **Peak cash you must fund** | **$58,799** | **$93,586** | **$38,938** |

Peak cash is the most negative running total across 12 months. It includes a one-time $3,000 legal review (assumption; bear $4,500, bull $2,500).

## Breakeven (monthly, steady state)

| | Base | Bear | Bull |
|---|---|---|---|
| Profit per Pro user after serving the readers needed to find them | $6.80 | $3.50 | $7.38 |
| Pro users needed with 0 sponsored stories | 1,179 | 2,293 | 1,086 |
| Pro users needed with the scenario's sponsored volume | **591** | 1,950 | 111 |
| Free readers needed for that many Pro users | 14,775 | 97,500 | 1,850 |
| Sponsored stories needed at the month-12 Pro count | **10** | 20 | 0 |

"Profit per Pro user" = net per Pro user minus (serving cost per reader / conversion). Base: $8.05 - $0.05 / 4% = $8.05 - $1.25 = $6.80.

## What breaks it
- **Conversion.** At 12,500 readers and 8 sponsored stories, 3% conversion loses $2,116 and 4% loses $616. 5% earns $390 (sheet Sensitivity).
- **Sponsored volume.** Each sponsored story is worth $500. Zero sponsored stories at 4% loses $4,616.
- **Serving cost.** Doubling it to $0.10 adds $625 a month at 12,500 readers.
- **Annual plan share.** At 30% annual, blended net per Pro user falls from $8.05 to $7.50.
- **Fee.** The 5% + $0.50 is a guess. $0.50 on a $9 charge is already 5.6%.

## Ads do not work
$2 per 1,000 views (assumption) needs **4,000,000** views a month to cover $8,000. Versus about 591 Pro users.

## How to test each assumption
See `00-phase0-assumptions-risks-questions.md` and the "How to test it" column on the Assumptions sheet.

## Phase 2c summary (5 lines)
- **Built:** 6-sheet workbook with live formulas, 3 scenarios, 12-month cash, breakeven, sensitivity. Recalculated with LibreOffice, no formula errors.
- **Found:** brief's mix is -$616 a month, base peak funding need $58,799.
- **Risky:** conversion and sponsored volume.
- **Honest:** the bear case needs $93,586 to survive 12 months.
- **Next:** test plan and launch plan (`05`).
