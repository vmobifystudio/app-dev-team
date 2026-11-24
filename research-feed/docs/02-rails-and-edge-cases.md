# Phase 2a: Edge-case and rails matrix

> Not legal advice. Internal draft for one lawyer review.

**Verdict: 9 of 21 rows are built and tested. 10 are partial. 2 are phase 3. Every partial row names the missing piece.**

Status key: **Built** = code plus a test. **Partial** = mechanism exists, a piece is missing (stated). **Phase 3** = designed, not built, behind a flag.

## A. Edge cases

| # | Case | Risk | Mitigation | Where it lives | Status |
|---|---|---|---|---|---|
| 1 | Paper license changes between versions | Reuse text that is no longer licensed for it | License is keyed by (paper, version). Gate reads the page of the exact version and blocks on mismatch. | `src/license.js` `gate()`, table `paper_versions`, test `license_score.test.js` | Built |
| 2 | Paper withdrawn or retracted | We publish a retracted result | Probe on publish blocks it. A job re-checks every 15 minutes and pulls. Every story page reads its status file on load and swaps to "taken down". | `pipeline.publish`, `pipeline.recheckPapers`, `web/assets/story.js`, `status/<slug>.json` | Partial: demo probe reads a local file. `probe.liveFetch()` exists but is not wired to the job. "Every page load" means the status file, which is as fresh as the job. |
| 3 | Paper updated to v2 | Story describes a version that changed | Story flagged "Based on v1" with a visible banner until a human reviews it. | `pipeline.onPaperUpdated`, `render.flagBanners`. The CC BY demo paper shows it today (v3 exists). | Built |
| 4 | Author objects or says "remove" | Harm, legal claim | Takedown button on every story pulls it at once. Questions after. | `pipeline.report` kind `takedown` | Partial: reply-by-email "remove" is not parsed. An editor uses the console. |
| 5 | Wrong claim reported | Wrong fact stays up | "Under review" appears at once. 24-hour fix clock. Overdue list for the editor. | `pipeline.report`, `overdueReports`, tests | Partial: the clock is tracked, no pager or email to the editor yet. |
| 6 | A claim has no source | Unsupported statement | Claim and its sentence are cut automatically and logged. | `claims.cutUnsourced`, column `cut_log_json` | Built |
| 7 | Non-English, scanned, math-heavy, figure-heavy paper | Garbled extraction, wrong numbers | Visible quality warning when the title is not mostly Latin or few numbers and tables are found. Editor can skip. | `pipeline.qualityFlags`, `render.flagBanners` | Partial: heuristic only. No language detector, no page-image analysis. |
| 8 | Someone impersonates a researcher or founder | Fake creator stories | Verify by ORCID sign-in or institutional email matched to the paper's affiliation. | Not built. Creator flow is phase 3. `guard.creatorTagsOk` holds the honesty tags. | Phase 3 |
| 9 | Takedown abuse, DMCA counter-notices | Fake takedowns, wrongful restore | Everything is logged. DMCA pulls but can never be auto-restored. A human decides. | `pipeline.report`, `resolveReport` throws on DMCA restore, test | Partial: no 10 to 14 business day counter-notice timer yet. |
| 10 | Gaming the score | Pay or edit to rank | Only outside signals. Closed list of readiness cues, each needs a source. Nothing author-editable. Sponsorship has no input. | `src/score.js`, `rules/score_rules_v1.json`, tests | Built |
| 11 | Duplicates and near-duplicates | Same paper twice | Exact same arXiv id is refused. | `pipeline.draftStory` | Partial: near-duplicates under different ids (title and author similarity) are not detected. |
| 12 | Cost spikes | Surprise bill | Daily caps on AI calls and dollars. API rate limit. | `llm.takeBudget`, `guard.limiter`, test | Built |
| 13 | Accessibility | Excluded readers, legal risk | Alt text and caption required by the checker. Audio shows captions. Reduced-motion respected. Skip link, focus rings, 16px+ text. | `checker.js`, `src/svg.js`, `web/assets/app.css` | Partial: no screen-reader or WCAG audit yet. |

## B. Regulatory rails

| # | Rail | Risk | Mitigation | Where it lives | Status |
|---|---|---|---|---|---|
| R1 | Securities: we host research, never offers | Illegal offering or promotion | Banned words scan blocks drafts and publish. Score label says "Research signal. Not investment advice." No investor matching exists. | `guard.scan`, `checker.js`, `pipeline.publish`, tests | Built for our stories. Creator terms are drafted, not enforced in code (phase 3). |
| R2 | Subscription billing | Auto-renew and cancel-rule violations | Price and renewal date above the pay button. Unticked consent box. One-click cancel in the same place. Reminder 7 days before annual renewal. Consent records with exact words. Merchant of record for tax and card rules. | `src/billing.js`, `web/assets/app.js`, tests | Built against a sandbox. Real merchant of record not connected. |
| R3 | Copyright | Takedowns and claims | For our stories the license gate is the shield. For creator stories: DMCA agent registration ($6, renew every 3 years), 24-hour takedown form, upload checkbox, India grievance officer. | Gate: built. Takedown form: built (`report` kinds). DMCA agent and grievance officer names are placeholders on `/about/`. | Partial: registration is a human task before launch. |
| R4 | AI labels | Missing disclosure | "AI-assisted" chip on every story and score. Meta tag, JSON-LD `digitalSourceType`, response header. Option to block EU sign-ups. | `render.js`, `server.js`, `billing.js` (`RF_BLOCK_EU`) | Partial: no provider-signed mark exists for text. Lawyer to say whether our own marking is enough. |
| R5 | Privacy | Data duties | No reader login. Pro stores name and email only. 18+ checkbox. Delete-my-account in app. Plain notice. Named contact (placeholder). No scraping of people who did not join. | `billing.deleteAccount`, `docs/legal/privacy-notice.md`, test | Built. India DPDP duties from May 13, 2027 are mapped in the privacy notice. Contact name is a placeholder. |
| R6 | Scores about real work | Defamation and unfairness | Public signals only. "Automated opinion" label. Formula visible. One-click dispute, 48-hour review. | `render.scorePanel`, `pipeline.report` kind `dispute` | Partial: no creator reply field yet (phase 3). |
| R7 | Creator honesty | Fake traction, offers, dangerous detail | Required tags "I am the author", "I am the founder", "I hold equity". No fake testimonials or return promises. Sensitive-topic scan. | `guard.creatorTagsOk`, `guard.scan` | Phase 3 for tags. The scan runs on all stories today. |
| R8 | Sponsored content | Undisclosed advertising | Label "Paid Advertisement" inside every card so it travels when shared. Same score rules, same gate, same credit block. Flag `RF_SPONSORED`. | `render.cardHtml`, `pipeline.draftStory`, test | Built behind a flag. No payment flow. |

## C. The four documents for one lawyer review
`docs/legal/terms.md`, `creator-terms.md`, `privacy-notice.md`, `content-rules.md` (includes the sponsored label rules). Each opens with a "Not legal advice" note and lists open questions.

## Phase 2a summary (5 lines)
- **Built:** matrix of 13 edge cases and 8 rails, each mapped to code and a test.
- **Risky:** rows marked Partial, especially live paper-status checks and email "remove".
- **Gap:** no WCAG audit, no near-duplicate detector.
- **Phase 3:** impersonation checks, creator tags enforcement, sponsor payments.
- **Next:** data model and financials.
