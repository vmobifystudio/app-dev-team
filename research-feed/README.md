# Research Feed (working title)

A free-to-read feed of deep-tech research stories in the Vizmaya format. Each story has a score built from outside signals.
Money comes from a $9 Pro layer and from labeled sponsored stories (phase 3). The research is never paywalled.

> Not legal advice. Not financial advice. Legal text in `docs/legal/` is a draft for one lawyer review.

**Verdict: the MVP path works end to end for two real papers. The business math needs work. Read `docs/04-financials.md` first.**

## Run it (Node 22.13 or newer, no installs)

```bash
cd research-feed
npm run demo      # runs both papers through the whole pipeline, builds public/
npm start         # http://localhost:8787  (editor console at /admin/, token printed)
npm test          # 50 tests
npm run finance   # rebuilds finance/research-feed-financials.xlsx (needs python3 + openpyxl; LibreOffice optional)
```

## The two demo papers

| Paper | License (read from the exact version) | Tier | Score |
|---|---|---|---|
| arXiv:2603.27130v2, AI-generated code in real repositories | CC BY 4.0 | Full reuse with credit (one short quote, credited) | 35/100, medium confidence |
| arXiv:2611.08483v1, SwarmEvolve | CC BY-NC-ND 4.0 | Ideas only | Too new to score (5 days), low confidence |

The first paper has a v3 on arXiv. Its story carries "Based on v2" until a human reads v3. The second story has a Contested box where a "median 3 to 8 minutes" headline sits next to three puzzles it never won in time.

## What is built (definition of done)

| Requirement | Where |
|---|---|
| Paper link in, then license check | `src/license.js`, `src/pipeline.js` `ingest()` |
| Cited story draft (every claim maps to a source span) | `src/llm.js`, `content/drafts/*.json` |
| Claim with no source is cut automatically | `src/claims.js` `cutUnsourced()` |
| Separate checker re-verifies every number | `src/checker.js`, facts from `tools/extract_facts.js` |
| Copy check for ideas-only papers | `src/copycheck.js`, `tools/record_copycheck.js` |
| Editor approval, then publish | `src/pipeline.js`, `web/admin/` |
| No story published without a license in the log | `license_log` plus a check in `publish()` and a test |
| Published story with score and credit block | `src/render.js` |
| Score: deterministic, versioned, full breakdown, "Automated opinion", "Too new to score" | `src/score.js`, `rules/score_rules_v1.json` |
| Reader scrolls, opens, shares with no login | `public/`, `src/server.js` |
| Free: daily pick, streak, 1 audio a day, weekly top 5, 20 saves in browser, browse by field | `src/site.js`, `web/assets/*.js` |
| Pro: follow a field, alert within 1 hour, synced saves, filters, CSV export, audio | `src/billing.js`, `src/alerts.js`, `src/server.js` |
| Pro prompt only on "follow a field" | `web/assets/app.js`, `server.js` `/api/follow` |
| Billing rails: price and renewal date above the pay button, unticked consent, 1-click cancel, 7-day reminder, consent records | `src/billing.js`, tests |
| Under review within 1 hour, takedown first, withdrawn and new-version handling | `src/pipeline.js` |
| Financial sheet with 3 scenarios, 12-month cash, breakeven | `finance/research-feed-financials.xlsx` |

Creator onboarding and sponsored stories are phase 3. The sponsored label (inside every card) and the flag `RF_SPONSORED=1` exist and are tested. There is no payment flow for sponsors.

## What is stubbed or not done (honest list)

- **LLM drafting is recorded.** The two drafts were written in a Claude Code session and are replayed by the `recorded` provider. A live `anthropic` provider is written (`src/llm.js`) but has not been run. Set `ANTHROPIC_API_KEY` to try it.
- **Source lines use tables and sections, not page numbers.** The PDF parser gave no page numbers. Fix: per-page parsing.
- **Facts index, not paper text, lives in the repo.** `data/facts/*.json` holds numbers only. Paper text is never stored, because one paper is CC BY-NC-ND.
- **The checker verifies numbers, not meaning.** `editor_notes` in each draft list readings a human must confirm.
- **Billing is a sandbox.** No real merchant of record is connected.
- **Outside signals:** citations come from OpenAlex (collected by hand for the demo). Patents (Lens.org) and Semantic Scholar were not collected. They show "not counted", never 0.
- **Paper-status probe reads a local file** (`data/live_status.json`). `probe.liveFetch()` is written, not wired to the job.
- **Audio uses the browser's voice.** Captions show. Production needs pre-rendered audio.
- **No photos in the demo.** The photo credit and asset log paths exist.
- **No WCAG audit yet.**
- **Pro sessions use a bearer token kept in the browser.** There is no "restore access by email" flow yet.
- **Email is an outbox table.** No provider is connected.

## Layout

```
src/        license, claims, checker, copycheck, score, llm, pipeline, render, svg, site, server, billing, alerts, guard, probe, cli
tools/      extract_facts.js (numbers only), record_copycheck.js
rules/      score_rules_v1.json
content/    papers (metadata), drafts (recorded structured drafts), signals (outside signals), copycheck (recorded verdicts)
data/       abs (page snapshots, abstract removed), facts (numbers index)
web/        assets, about page, editor console (copied into public/ on build)
public/     generated site (committed so you can open it)
finance/    build_model.py and the workbook
docs/       phase 0 to 4 documents, legal drafts, email templates
test/       50 tests (node:test)
schema.sql  data model
```

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8787 | Server port |
| `RF_ADMIN_TOKEN` | random, printed | Editor console token |
| `RF_SITE_URL` | http://localhost:8787 | Used in share links and canonical tags |
| `RF_BLOCK_EU` | off | Set `1` to block EU Pro sign-ups |
| `RF_SPONSORED` | off | Set `1` to allow sponsored stories (phase 3) |
| `RF_DAILY_CALL_CAP`, `RF_DAILY_USD_CAP` | 25, 10 | AI generation caps per day |
| `RF_SOURCE_TEXT_DIR` | unset | Folder with paper texts (`<id><version>.md`) to run the copy check live |
| `RF_ONLINE` | off | Set `1` to read arXiv pages live instead of the saved snapshots |
| `ANTHROPIC_API_KEY`, `RF_MODEL` | unset | Live drafting |

## Docs
`docs/00` Phase 0 (assumptions, risks, questions) · `01` PRD · `02` rails and edge-case matrix · `03` data model and stack · `04` financials · `05` test plan and 90-day plan · `06` email templates · `legal/` four drafts for one lawyer.
