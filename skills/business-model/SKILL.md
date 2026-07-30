---
name: business-model
description: Use when deciding or revisiting how the product makes money — pricing, tiers, trial shape, ad load, unit economics — by ceo when setting the model, by cpo when a scope decision turns on revenue, and by product-researcher when investigating willingness to pay. A pricing analysis is a document, not a standing role.
---

# Business model

The output of this skill is **a decision with its arithmetic written down**, not a strategy essay.
The arithmetic is what makes it possible to be wrong on purpose and notice later.

## Pick the model before the price

| Model | Fits when | The thing that kills it |
|---|---|---|
| Paid up front | the value is obvious before use | no trial means no conversion signal at all |
| Freemium → subscription | value compounds with use | the free tier is either useless or sufficient |
| Consumable / credits | usage is bursty and costs you per unit | users cannot predict their spend and stop |
| Ads | reach is large and session length is real | ad load destroys the experience that earned the reach |
| Ads + removal IAP | both of the above | the paid tier competes with your own ad revenue |

The studio's defaults and hard rules live in `knowledge/monetization.md` (`house-conventions`) —
NO-AD zones, consent, frequency caps. Those are not negotiable by a pricing decision.

## The arithmetic, written out

State each number, and **say where it came from** — measured, comparable, or assumed:

```
Price point               <value> in <currency/tier>
Cost to serve one user    <infra + per-unit + store commission>
Conversion assumption     <%>  (source: measured | comparable | ASSUMED)
Retention assumption      <month-1 / month-12>  (source: ...)
Revenue per install       price × conversion × expected periods
Break-even installs       fixed cost ÷ revenue per install
```

**Every `ASSUMED` is a hypothesis with a falsifying test**, handed to `data-analyst` to instrument
(`growth-analysis`). An assumption that is never instrumented is a number that will be quoted for
years as if it were measured — the most expensive artifact this skill can produce.

## The trial and the paywall

Decide and record: what is free forever, what the trial includes, its length, whether a card is
required, what happens at expiry to data created during the trial (it must not disappear), and where
the paywall appears in `docs/12-flows.md`. A paywall not in the flow doc is a paywall QA never tests.

## Output

A `## Business model` section in `docs/00-vision.md` with the model, the arithmetic, and every
assumption labelled — plus the instrumentation request in `docs/52-analytics.md` for each one.
