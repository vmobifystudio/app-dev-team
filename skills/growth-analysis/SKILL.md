---
name: growth-analysis
description: Use post-launch when analysing acquisition, activation, retention, referral or revenue movement — by data-analyst for the KPI report, and by product-researcher when the question is about an existing product's funnel. Same data, same tools as the analytics schema; this is the reading of it.
---

# Growth analysis

Post-launch analysis of the funnel the studio already instruments. It is a reading, not a new data
source: everything here comes from the schema in `docs/52-analytics.md`, and a metric with no event
behind it is a request to `data-analyst`, never an estimate.

## The funnel, one definition each

Define each stage **once**, in the report, and never redefine it between reports — a metric whose
definition moves is worse than no metric because the trend is fiction:

| Stage | Definition must state |
|---|---|
| Install | source, and whether re-installs count |
| Activation | the single event that means "this user got the point", and by when |
| Retention | D1 / D7 / D30, calendar or rolling — say which |
| Referral | the event, and whether the invited user is attributed |
| Revenue | gross or net of store commission, trial or paid |

## The rules that keep this honest

- **Every number carries its denominator and its date range.** "Retention improved to 42%" is not a
  finding; "D7 retention on the 2026-07-01 cohort is 42% of 1,204 installs, versus 38% of 980 on
  2026-06-01" is.
- **Cohorts, never period totals**, for anything a user does over time. Period totals move when
  install volume moves and tell you nothing about the product.
- **Correlation is labelled as correlation.** A release, a season, a store feature and a price change
  usually land in the same week. Name the confounders you cannot separate.
- **A metric that cannot go down is not a metric.** Cumulative installs, total sessions, all-time
  revenue — track them if you like, never report them as evidence of anything.
- **Small-n silence.** Below a stated threshold, report the count and no percentage. A 66% conversion
  on 3 users has misled more roadmaps than any other single number.
- **Consent-gated data is partial by construction.** State the consent rate; a funnel measured on
  consenting users only is a funnel about consenting users only.

## Output

Append to `docs/52-analytics.md` a dated `## Growth report` with: the funnel table by cohort, what
moved and by how much, the one change most likely to explain it, the confounders, and **what you
would need to instrument to answer the question you could not answer**. That last item is the one
that makes the next report better.
