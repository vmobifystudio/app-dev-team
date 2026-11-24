# Phase 1: Product requirements

> Not legal advice. Internal draft.

**Verdict: v1 is a free feed with trust signals. Pro sells habit and discovery, never the research. Creators and sponsors wait for phase 3.**

## One line
A scrollable feed of deep-tech research stories. Each has a score built from outside signals. Free to read.

## Why this version
- Papers are free on arXiv ($0). A paper marketplace has nothing to sell.
- Chat with an AI costs $20 a month. Answers alone cannot be the product.
- Book-summary apps charge $6.67 to $12 a month for time saved, a vetted pick, and a daily habit. We copy that logic.
- We never touch money, contracts or investment offers.

## Personas

| Persona | Needs | In v1? |
|---|---|---|
| Reader | Open a story, no login, understand it in 3 minutes | Yes |
| Pro reader | Alerts for fields, synced saves, filters, CSV, audio | Yes (sandbox billing) |
| Vizmaya editor | Approve stories fast and safely | Yes (console at `/admin/`) |
| Creator (researcher or founder) | Tell the story of their own work | No. Phase 3, behind a flag |
| Sponsor (lab, university, funder) | Pay for a labeled story | No. Phase 3, behind a flag |

## User stories (v1)

Reader
- I open a story link and read it with no account.
- I see the score, the full breakdown and the formula.
- I see a "Source" line under every number.
- I share the link. It works with no paywall.
- I see a daily pick and my streak.
- I listen to 1 story a day, with captions.
- I save up to 20 stories in my browser.
- I browse by field.
- I see a "Contested" box when a headline and the paper's tables disagree.
- I report an error, dispute a score, or (as an author) ask for removal.

Pro reader
- I follow a field and get an alert within about 1 hour of publishing.
- I see the price and renewal date above the pay button.
- The auto-renew box starts unticked.
- I cancel in one click, in the same place I signed up.
- I get a reminder 7 days before an annual renewal.
- I sync unlimited saves into named lists and export them as CSV with source links.
- I filter by score range, license, date and institution.
- I listen to every story.
- I delete my account inside the app.

Editor
- I paste an arXiv link. The license gate runs first.
- I see a cited draft, the checker result, the copy-check result, the auto-cut log and the score.
- I approve or reject. I publish.
- I see reports, due dates and overdue items.
- I can pull any story at once.

## Scope (built, see README for the map)
License gate. Cited drafts with source spans. Auto-cut of unsourced claims. A separate checker that re-verifies every number. Copy check. Deterministic versioned score. Editor approval. Static story pages. Feed, daily pick, streak, weekly top 5, saves. Pro: follow, alerts, synced saves, filters, CSV, audio. Sandbox billing. Under-review and takedown flows. Withdrawn and new-version handling.

## Out of scope for v1
- Creator onboarding, ORCID or institutional-email verification, creator stories (phase 3, flag exists).
- Sponsored stories as a sales flow (phase 3). The label and the flag exist; there is no payment flow.
- Team lists.
- Investor matching, anything that looks like an offer. Never.
- Ads. Never (see financials).
- Native apps.
- Comments and profiles.

## Rules that never bend
- Never paywall the research.
- Show the Pro prompt only when a reader follows a field.
- No pay-to-score. No pay-for-placement. Sponsored stories use the same rules.
- Score the work, never the person.
- The model drafts. Rules decide the score and the license.

## Success metrics (all targets are assumptions)

| Metric | Target | When | Why it matters |
|---|---|---|---|
| Stories live | 40 | Week 4 | Launch plan |
| Test readers | 50 | Week 8 | Habit signal |
| Share of readers who finish a story | 45% | Week 8 | Format works |
| 7-day return rate | 25% | Week 8 | Habit |
| Follow rate (follows per 100 readers) | 8 | Week 12 | Gate to Pro |
| Follow to Pro conversion | 40% of followers, giving 4% of readers | Week 12 | Revenue |
| Errors reported per 100 stories | under 5 | Always | Trust |
| Median time to fix a confirmed error | under 24 hours | Always | Promise |
| Alert p95 delay | under 60 minutes | Month 1 | Pro promise |
| Cost per story | under $0.40 | Week 4 | Unit economics |
| Sponsored story pitches sent | 20 | Week 12 | Revenue path |

## Phase 1 summary (5 lines)
- **Built:** personas, stories, scope, out of scope, metrics.
- **Held:** creators and sponsors stay behind a flag.
- **Risky:** 45% finish rate and 4% conversion are guesses.
- **Cut:** team lists, ads, native apps.
- **Next:** rails matrix, data model, financials (`02`, `03`, `04`).
