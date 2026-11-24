# Phase 0: Assumptions, risks, questions

> Not legal advice. Not financial advice. Internal planning draft.

**Verdict: the product is buildable now. The business only works if two numbers hold: 4% conversion and 8 paid sponsored stories a month. Both are untested.**

## The finding that changes the plan

The brief says: 500 Pro x $8.05 + 8 sponsored x $500 = $8,025 vs $8,000 cost.
That line leaves out reader serving cost and story cost.

| Line | $ per month |
|---|---|
| Revenue (500 Pro + 8 sponsored) | 8,025 |
| Team | 8,000 |
| Serving 12,500 readers at $0.05 (assumption) | 625 |
| Stories, 40 x $0.40 (assumption) | 16 |
| **Real result** | **-616** |

Fix, pick one:
- 591 Pro users with 8 sponsored stories, or
- 10 sponsored stories with 500 Pro users.

Cutting serving cost alone does not fix it. It would have to fall under $0.001 per reader.

Source: `finance/research-feed-financials.xlsx`, sheet Summary. Details in `04-financials.md`.

## Assumptions

Every number below is an assumption unless marked "given". Each has a test.

| # | Assumption | Value | How to test it |
|---|---|---|---|
| 1 | Free to Pro conversion | 4% | Weeks 9 to 12: Pro signups divided by readers who followed a field |
| 2 | Pro alerts arrive within about 1 hour | 1 hour | Log `sent_at - published_at`. Check p95 over the first month. |
| 3 | Story cost | $0.40 | Sum `llm_runs.cost_usd` plus editor minutes for the first 40 stories |
| 4 | Serving cost | $0.05 per reader per month | CDN plus hosting bill divided by monthly readers after week 6 |
| 5 | Sponsored story price | $500 | Ask 10 labs. Track pitches sent vs signed. |
| 6 | Merchant of record fee | 5% + $0.50 per charge | Get a written quote from Paddle or Lemon Squeezy |
| 7 | Ad revenue | $2 per 1,000 views | Only to show ads do not work. Run a 2-week trial if you doubt it. |
| 8 | Error fix SLA | 24 hours | Track `reports.due_at` vs `resolved_at` |
| 9 | Takedown on reply "remove" | same day | Same |
| 10 | Score dispute review | 48 hours | Same |
| 11 | "Too new to score" cutoff | 90 days | Plot citations vs paper age for 200 papers per field. Pick the age where 80% have at least 1. |
| 12 | Field average citations per month | 1.0 (cs.SE), 2.0 (cs.AI) | Sample 200 same-field papers aged 6 to 12 months from OpenAlex. Use the mean. |
| 13 | DMCA response | 24 hours | Same as 8 |
| 14 | Team cost | $8,000 per month (given) | Payroll |
| 15 | One-time legal review of 4 documents | $3,000 | Get two quotes |
| 16 | No grace period for AI labels | assumed | Ask the lawyer |

## The 5 biggest risks

1. **Unit economics.** See above. The path to breakeven is thin and depends on sponsored stories, which are a phase 3 feature.
2. **License and copyright reading.** Most arXiv papers are "ideas only". The line between a fact and an expression is a legal judgment. The copy check catches near-copies, not every structural echo. A lawyer must confirm the policy table in `src/license.js`.
3. **We are the publisher.** A wrong number is our error. The checker verifies every number against the paper's tables. It cannot verify meaning. Each demo draft lists the places where a human must confirm a reading (`editor_notes`).
4. **Scoring real work in public.** Signals are thin today (OpenAlex only; patents need a Lens.org key; two placeholders for field averages). A low score on a real paper invites disputes and possibly defamation claims. The "Automated opinion" label and the one-click dispute are the shield. A lawyer should read both.
5. **Rails that depend on jurisdiction.** Auto-renewal law differs by US state and country. EU AI Act labels, India's May 13, 2027 data duties, and securities rules for phase 3 creator stories all need review before launch.

## Questions (max 5, each has a default I used)

| # | Question | Default I used |
|---|---|---|
| 1 | Who approves stories in v1? | One named editor. A second reviewer for every ideas-only story is on the wish list. |
| 2 | Block EU Pro sign-ups for the first 6 months? | Yes. Switch is `RF_BLOCK_EU=1`, off in the demo. |
| 3 | Which merchant of record? | Paddle or Lemon Squeezy, decided after fee quotes. The sandbox stub has the same interface. |
| 4 | Hosting? | Static story pages on a CDN, one small Node server, Postgres. Demo uses SQLite. |
| 5 | Name? | "Research Feed" is a working title. Publisher is Vizmaya. |

## Other things I could not do honestly, and the safe alternative

| Brief asked | Why not | Safe alternative |
|---|---|---|
| "Machine-readable marking from the model provider" | The API gives no signed mark on text output | Own marking: `rf:ai-assisted` meta tag, JSON-LD `digitalSourceType`, response header. Ask the provider and the lawyer what else is required. |
| "Source: paper p#" | The PDF parser returned no page numbers | Source lines use table or section: "Source: paper, Table 13". Fix: per-page PDF parse. |
| Patent citations from Lens.org | Needs an API key I do not have | Signal shows "not counted". Never counted as zero. |
| Citations for the 5-day-old paper | Semantic Scholar rate-limited the lookup | Same. Paper is "Too new to score" anyway. |
| Live LLM drafting | No API key in this session | A recorded provider replays the two drafts. A live provider is written but has not been run. |
| Photos | No free-photo fetch available here | Photo slots, credits and the asset log work. Demo stories use no photos and say so. |
| Real payments | Sandbox only | Stub with the merchant-of-record interface. |

## Phase 0 summary (5 lines)
- **Built:** assumption list, risk list, 5 questions with defaults.
- **Found:** the brief's own break-even math omits $641 a month of costs.
- **Risky:** conversion (4%) and sponsored volume (8) are both untested.
- **Honest gaps:** page numbers, patent signal, live LLM run, photos.
- **Next:** PRD (`01-prd.md`).
