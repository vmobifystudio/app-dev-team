# Phase 4: Test plan and 90-day launch plan (one document)

> Not legal advice. Internal draft.

**Verdict: 50 automated tests pass today. The 90-day plan has three gates. If a gate fails, stop and fix before spending more.**

## Part A: Test plan

### What runs now (`npm test`, 50 tests, zero dependencies)

| Area | Tests | Proves |
|---|---|---|
| License gate | 5 | Every license maps to the right tier. Unknown blocks. Exact version is read. New version flags. Withdrawn blocks. |
| Score | 5 | Same inputs give the same score (35/100 for the demo paper). Unavailable signals leave the denominator. Too new shows no fake 0. Editable or unknown signals are ignored. Payment has no input. |
| Checker | 14 | (1 of the 14 needs the paper text, see below) Wrong number caught. Wrong column caught. Wrong computed result caught. Number with no claim fails. Unsourced claim is cut. Alt text required. Investing words blocked. Safe formula evaluator. Copy check catches a copied sentence. CSV cells cannot run as formulas. |
| Pipeline | 16 | Full path with the credit block, score and AI label. No publish without a license row. No publish without approval. Red checker blocks approval. Ideas-only needs a copy check or a logged override. Withdrawn paper blocked or pulled. New version flagged. Error report gives "Under review". Takedown pulls. DMCA cannot auto-restore. Dispute flag and 48 hour due time. Duplicate refused. AI cap. Sponsored flag and label inside every card. Daily pick rotates. |
| Billing and alerts | 9 | Price and renewal date shown. Consent box required. Consent record keeps the words. Net is $8.05. One-click cancel. Annual reminder 7 days before. Delete account. EU block. Alert within 1 hour. No alert for a pulled story. |
| End to end over HTTP | 1 | Reader browses with no login. Free follow gives the Pro prompt. Pro filters return 402 for free users. Sign-up needs consent. Pro follows. Publish queues an alert. Worker sends it. CSV export. Report gives "Under review" in the status file. Cancel. Delete. Path traversal and oversize body refused. |

One checker test compares both real drafts with the real paper text for copied word runs. It runs only when `RF_SOURCE_TEXT_DIR` points at the paper texts. It was skipped by default (49 pass, 1 skipped) and passed when run with the texts (50 of 50).

Mutation check done by hand: changing one number in a draft made the checker fail with the exact claim named.

### What is not tested yet
- Live LLM drafting (no key in this build). Run 5 papers, compare checker failures per story.
- Live arXiv fetch and live paper-status probe.
- Real payments with a merchant of record.
- Screen reader and WCAG audit.
- Load: static pages are cheap, the API is small. Run a 200 request per second test before launch.
- Email delivery (outbox is a stub).

### Human test plan (before week 5)
1. **Number audit.** Pick 10 stories. A second person checks every number against the PDF. Target: 0 wrong numbers. Any miss means the checker has a hole.
2. **Plain English test.** 5 non-experts read 5 stories. Ask them to say each card's point in one sentence. Target: 4 of 5 right per card.
3. **Copy audit.** For each ideas-only story, a person reads it next to the paper. Target: no copied sentence, no copied structure.
4. **Takedown drill.** Send a fake "remove". Time it. Target: story down in under 10 minutes, same day follow-up.
5. **Billing drill.** Sign up, cancel, delete account on a phone. Target: cancel in 1 click, nothing left but hashed consent.

## Part B: 90-day launch plan

### Weeks 1 to 4: 40 stories live
- Week 1: lawyer gets the 4 documents. Register the DMCA agent ($6). Name the grievance contact. Get 2 merchant-of-record fee quotes. Get a Lens.org key and wire patents.
- Week 1: run 5 papers through the live LLM provider. Fix checker holes.
- Weeks 2 to 4: 10 stories a week. One editor. Two papers per day maximum.
- Measure: cost per story (target $0.40), checker failures per story, editor minutes per story, errors reported.
- **Gate 1 (end of week 4):** 40 live stories, 0 license-log gaps, cost per story under $0.40, no unresolved error report older than 24 hours. If not, extend by one week.

### Weeks 5 to 8: 50 free readers testing
- Invite 50 people from the target audience (founders, researchers, analysts). No Pro prompt yet.
- Track: stories started, finished (target 45%), 7-day return (target 25%), shares, follows clicked.
- Run the human tests above.
- Fix the top 3 confusions. Rewrite 5 cards that lose people.
- **Gate 2 (end of week 8):** finish rate 45% or better and 7-day return 25% or better. If not, fix the format before building anything new.

### Weeks 9 to 12: Pro prompt at "follow a field", first sponsored story pitched
- Turn on the Pro prompt only on the follow action (already the only trigger in code).
- Connect the real merchant of record. Keep a sandbox switch.
- Measure follow rate (target 8 per 100 readers) and Pro conversion (target 4% of readers).
- Alert delay p95 under 60 minutes.
- Pitch 20 labs, universities or funders. Target: 1 signed sponsored story by day 90.
- **Gate 3 (day 90):** at least 20 paying Pro users, or 2% conversion on followers, and 1 signed sponsored story. If conversion is under 1%, do not build phase 3. Revisit the Pro bundle.

### What I would not do in the 90 days
Creator onboarding. Team lists. Ads. Native apps. More than 50 stories a month with one editor.

## Phase 4 summary (5 lines)
- **Built:** 50 passing tests, a human test plan, a 3-gate 90-day plan.
- **Tested for real:** both demo drafts against the real paper text.
- **Risky:** live LLM, live payments and email are untested.
- **Gate that matters most:** week 8 finish rate and 7-day return.
- **Next:** send the 4 legal documents and the fee quotes requests this week.
