# Decision rights

Who proposes, who challenges, who decides, who executes, and who records the evidence — for the
decisions this studio actually makes. This document does not invent new authority. Every column
below is sourced from what `agents/*.md` already says (its `description:` frontmatter, its "Owns"
language) and from the mechanism that already records the decision (`scripts/board.mjs`'s event log,
`scripts/incident-ledger.mjs`, `ship-gate.sh`). Where a role file and
this table disagree, the role file is out of date — fix the role file, not this table.

**Why this exists.** Authority was previously scattered as one-line "Owns:" statements per agent
file — locally correct, globally implicit. A role's file can be perfectly consistent with itself and
still leave "who actually decides when two roles disagree" unanswered. This table is that answer, in
one place.

| Decision | Proposes | Challenges | Decides | Executes | Records evidence |
|---|---|---|---|---|---|
| Product opportunity | `cpo`, `product-researcher` | `product-validator`, `data-analyst` | founder (or delegated `cpo` on utility tier) | `product-manager` | `product-researcher` → `docs/16-research.md` |
| Scope lock | `cpo` (PRD) / `ceo` (utility founder pass) | `cto`, `product-validator`, `ux-architect` | **founder — human gate** | `product-manager` (backlog) | orchestrator → `docs/00-vision.md` `## Scope lock` + one `FOUNDER DECISION` line per fired gate |
| Architecture | `tech-lead`, `cto` | `security-reviewer`, `reliability-engineer`, platform ICs | `cto` (or `tech-lead` on utility tier) | delivery pod | `tech-lead` → `docs/20-architecture.md` |
| UX and design | `ux-architect`, `product-designer` | `product-validator`, design-qa gate | `cpo` / design authority | `product-designer` | `product-designer` → `docs/13-14-*.md` |
| Product ambiguity (reversible, inside the brief) | `product-manager`, any IC | `product-validator` (at Gate 1) | `product-manager` (`cpo` if it changes a P0; `ceo` on utility) | owning IC | `[TD-NNN]` line in the doc it changed (§ Team decides) |
| CPO vs CTO, scope vs architecture | `cpo`, `cto` | `tech-lead` | `ceo` | `cpo` / `cto` amend their doc | `decision` row on the channel |
| Bug validity and severity | `qa-engineer` | implementing IC | `product-manager` (`cpo` for a P0) | assigned IC | `decision` row on the channel |
| Ticket readiness | `product-manager`, `tech-lead` | `qa-engineer`, delivery owner | `tech-manager` | assigned IC | `tech-manager` → `board.mjs` event log |
| Code acceptance | implementing IC (`done_reported`) | `code-reviewer`, `verification-engineer`, `qa-engineer` | `code-reviewer` (authorized reviewer) | implementing IC (addresses changes) / `tech-manager` (merges) | `code-reviewer` → `board.mjs approved` event, bound to commit + evidence when `requireApprovalBinding` is set |
| Security / privacy exception | delivery or product owner | `security-reviewer`, `privacy-reviewer` | **explicit human authority — waiver** | designated owner | `security-reviewer` → `docs/60-releases.md` waiver record |
| Release readiness | `release-manager` | `qa-engineer`, `verification-engineer`, `security-reviewer`, `release-auditor` | **founder / release authority — human gate** | `release-manager` assembles the signed, submission-ready build and the checklist; **the founder alone executes the actual store submission at any track** — `release-manager` never runs an upload/submit command | `release-auditor` → `ship-gate.sh` output |
| Incident command | release/production signal | product, security, platform leads | `release-manager` / `tech-manager` jointly today — moves to a conditional `incident-commander` role once one is open (see `docs/HANDBOOK.md` Part 12 / roadmap) | response owner (the IC that owns the affected surface) | `incident-ledger.mjs` |
| Durable learning | any role, via a `LEARNING:` line → `/app-learn`'s reviewed `docs/kb-patch.diff` | — | plugin maintainer reviewing the PR | — | the patch |

Two rows are marked **human gate** on purpose — they are the two the studio never automates
(`docs/HANDBOOK.md` Part 7: "Two human gates, and only two: scope-lock ... and ship"). Every other
row can run unattended; these two cannot, by design, regardless of confidence score.

## Team decides, founder decides

The default for every question a brief leaves open is **the team decides and writes it down** — a
studio that asks instead is a question queue, not a team.

- **The team decides and records:** anything reversible inside the brief's scope; every store- or
  House-KB-mandated requirement (account deletion, Sign in with Apple, a privacy policy, empty and
  error states, settings); copy, states, ordering; success-metric targets. Each is one line in the
  document it changed — `[TD-NNN] <decision> — src: team-default|house-kb · reversible` — or, mid-build,
  `DECISION (auto): <decision> — <reason>` on the channel. `product-validator` reports TD lines as
  their own non-material class, listed once in the Gate 1 brief so the founder can veto any of them.
- **The founder decides:** money (a price not already in their own words, paid infrastructure),
  irreversible data actions (a destructive migration of user data), scope beyond the brief, and
  waivers. These are the `trace.mjs --only gates` triggers plus Gate 1 and Gate 2. A founder question
  never stops the loop: it is recorded as open with a default, and only the tickets it touches wait.

## Conflict resolution

When two roles in the same row disagree (a Challenger disputes the Decider's call, or two
Challengers disagree with each other):

1. Name the decision, the competing positions, and the evidence each side has.
2. Find the row above — the "Decides" column is authoritative. A challenge that isn't resolved by
   the named decider escalates one level up that role's own reporting chain (e.g. `tech-lead` →
   `cto`; `code-reviewer` deadlock → `tech-lead`, or `cto`, for one extra cycle, never the
   ticket's own owner and never the founder; `cpo` vs `cto` → `ceo`).
3. Repeated disagreement with no new evidence is process churn, not a live dispute — the anti-ping-
   pong guard (`scripts/lib/messages.mjs:426`, `guard()`) already refuses it after one round.
4. A dissent that isn't overruled by new evidence gets recorded, not silently dropped — the losing
   side's position lives in the message thread or the review notes; the decision proceeds regardless.

## The one event outside the decided vocabulary

`scripts/lib/events.mjs`'s `EVENTS` set (18 states: `created` → `closed`) is the single normative
lifecycle — see `docs/HANDBOOK.md` Part 5.2. `assigned` is the one event that sits outside it, and
it is not an oversight: the CLI needs an `assign` subcommand the decided vocabulary has no verb for,
and `events.mjs:48-53` documents this in the code itself. It does not appear in the "Decision"
table above because it is bookkeeping (who is working a ticket), not a decision anyone contests.

## Role existence

Every role in this table exists because it meets the bar in `skills/role-activation/SKILL.md`'s
"Why a role exists" section — independent authority, independent context, a distinct capability or
security boundary, or separated-duties accountability. See that file for the per-role rationale.
