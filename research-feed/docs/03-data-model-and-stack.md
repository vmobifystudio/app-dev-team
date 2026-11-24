# Phase 2b: Data model and stack

> Not legal advice. Internal draft.

**Verdict: Node plus static HTML plus SQL. No dependencies. The same schema ports to Postgres.**

## Stack in 5 lines
1. **Static story pages** (plain HTML, built by `src/site.js`). Cheap to serve, good for search, shareable. Astro or Next.js would work too. I chose plain templates to keep the demo dependency-free.
2. **Node 22 server** (`node:http`) for the small API: Pro, follow, saves, reports, editor console. One process.
3. **SQL database.** SQLite here (`node:sqlite`). Production: Postgres with the same `schema.sql`. Queue: a table plus a one-minute timer now. Production: a real queue (pg-boss or SQS) for ingest and alert jobs.
4. **LLM with structured output.** The draft is a JSON object with claims that point at source spans. Provider is swappable (`recorded` or `anthropic`). Prompts, model, hashes and cost are stored in `llm_runs`.
5. **Object storage and CDN** for pages and photos in production. Not needed in the demo.

## Pipeline

```
arXiv link
  -> license gate (reads the exact version's page; writes license_log)      src/license.js
  -> draft (LLM, structured; refused without an ALLOW row)                  src/llm.js
  -> auto-cut (claims or sentences with no source are removed, logged)      src/claims.js
  -> checker (re-verifies every number against the facts index)            src/checker.js
     + copy check (no copied runs of 6+ words) + rails scan                 src/copycheck.js, src/guard.js
     + score (deterministic rules, versioned)                               src/score.js
  -> editor approval (human, named)                                         src/pipeline.js
  -> publish (re-checks license log and live paper status; logs assets)     src/pipeline.js
  -> static pages, feed, status files, alerts queued                        src/site.js, src/alerts.js
```

The LLM never decides the license or the score. The checker never reads the draft's own quotes. It reads a **facts index** (`data/facts/*.json`) built by a separate parser (`tools/extract_facts.js`). The facts index holds numbers only, keyed by table row or section, so no paper text is stored in this repo.

Known limit: in the demo the drafter and the extraction ran in the same session. The structure is independent. A production setup should use a different model or parser for extraction.

## Tables (see `schema.sql`)

| Table | Holds | Key rule |
|---|---|---|
| `paper_versions` | One row per paper version, license, tier, withdrawn flag, latest version seen | Key is (arxiv_id, version) because licenses differ by version |
| `license_log` | Append-only gate results with the evidence URL | No story publishes without an ALLOW row for its exact version |
| `asset_log` | Source of every chart, animation, photo, quote | Required by the brief |
| `stories` | Draft JSON, status, flags, checker report, score | Status: draft, checked, approved, published, under_review, pulled |
| `claims` | Every claim: display, locator, row, formula, verified | Every generated claim maps to a source span |
| `llm_runs` | Provider, model, prompt text and hash, output hash, cost | Audit and AI label |
| `ai_budget` | Calls and dollars per day | Cost cap |
| `reports` | Error, dispute, takedown, DMCA, counter-notice with due times | Routed to a human |
| `users` | Pro users: name, email, 18+ flag, token hash | Readers have no row |
| `subscriptions` | Plan, price, renewal date, merchant reference | One-click cancel |
| `consents` | Exact words shown, price, renewal date, time | Kept after deletion, with the email hashed |
| `follows`, `saves` | Field follows and named lists | Pro only |
| `alerts` | Queue with `due_by` = queue time + 1 hour | Worker sends, never for a pulled story |
| `outbox` | Email stub | Production: transactional email |
| `audit_log` | Every state change with actor | Who did what |

## Score rules v1.0.0 (`rules/score_rules_v1.json`)

| Signal | Max | Rule |
|---|---|---|
| Citations per month vs field average | 30 | 30 x min(1, ratio / 2). Full points at 2 times the field average. |
| Patent citations (Lens.org) | 15 | 0 = 0, 1 to 2 = 8, 3 or more = 15 |
| Code or data released | 15 | code = 10, data = 5, promised only = 0 |
| Industry co-authors | 15 | none = 0, at least 1 = 8, at least 25% = 15 |
| Funder type stated in paper | 10 | government or nonprofit = 10, industry = 6, none stated = not counted |
| Readiness cues from a closed list | 15 | 3 per cue with a source locator, up to 5 |

`score = round(100 x earned / available)`. Unavailable signals leave both sides. They never count as 0.
Under 90 days old: "Too new to score" with a confidence level.
Worked example (CC BY demo paper, 7 citations in 7.5 months, 4 cues, 0 industry authors, patents and funder unavailable): 26.1 of 75 available points = **35 / 100, medium confidence**.

## Phase 2b summary (5 lines)
- **Built:** schema with 16 tables, pipeline, score rules v1.0.0.
- **Independent:** checker reads a facts index, not the draft.
- **Risky:** drafter and extractor shared a session in the demo.
- **Gap:** real queue, Postgres, object storage.
- **Next:** financials (`04`).
