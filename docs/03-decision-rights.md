# Decision rights

Who proposes, who challenges, who decides, who executes, and who records the evidence — for the
decisions this studio actually makes. This document does not invent new authority. Every column
below is sourced from what `agents/*.md` already says (its `description:` frontmatter, its "Owns"
language) and from the mechanism that already records the decision (`scripts/board.mjs`'s event log,
`scripts/memory-curator.mjs`, `scripts/incident-ledger.mjs`, `ship-gate.sh`). Where a role file and
this table disagree, the role file is out of date — fix the role file, not this table.

**Why this exists.** Authority was previously scattered as one-line "Owns:" statements per agent
file — locally correct, globally implicit. A role's file can be perfectly consistent with itself and
still leave "who actually decides when two roles disagree" unanswered. This table is that answer, in
one place.

| Decision | Proposes | Challenges | Decides | Executes | Records evidence |
|---|---|---|---|---|---|
| Product opportunity | `cpo`, `product-researcher` | `product-validator`, `data-analyst` | founder (or delegated `cpo` on utility tier) | `product-manager` | `product-researcher` → `docs/16-research.md` |
| Scope lock | `cpo` (PRD) / `ceo` (utility founder pass) | `cto`, `product-validator`, `ux-architect` | **founder — human gate** | `product-manager` (backlog) | `chief-of-staff` / Gate 1 brief |
| Architecture | `tech-lead`, `cto` | `security-reviewer`, `reliability-engineer`, platform ICs | `cto` (or `tech-lead` on utility tier) | delivery pod | `tech-lead` → `docs/20-architecture.md` |
| UX and design | `ux-architect`, `product-designer` | `product-validator`, design-qa gate | `cpo` / design authority | `product-designer` | `product-designer` → `docs/13-14-*.md` |
| Ticket readiness | `product-manager`, `tech-lead` | `qa-engineer`, delivery owner | `tech-manager` | assigned IC | `tech-manager` → `board.mjs` event log |
| Code acceptance | implementing IC (`done_reported`) | `code-reviewer`, `verification-engineer`, `qa-engineer` | `code-reviewer` (authorized reviewer) | implementing IC (addresses changes) / `tech-manager` (merges) | `code-reviewer` → `board.mjs approved` event, bound to commit + evidence when `requireApprovalBinding` is set |
| Security / privacy exception | delivery or product owner | `security-reviewer`, `privacy-reviewer` | **explicit human authority — waiver** | designated owner | `security-reviewer` → `docs/60-releases.md` waiver record |
| Release readiness | `release-manager` | `qa-engineer`, `verification-engineer`, `security-reviewer`, `release-auditor` | **founder / release authority — human gate** | `release-manager` assembles the signed, submission-ready build and the checklist; **the founder alone executes the actual store submission at any track** — `release-manager` never runs an upload/submit command | `release-auditor` → `ship-gate.sh` output |
| Incident command | release/production signal | product, security, platform leads | `release-manager` / `tech-manager` jointly today — moves to a conditional `incident-commander` role once one is open (see `docs/HANDBOOK.md` Part 12 / roadmap) | response owner (the IC that owns the affected surface) | `incident-ledger.mjs` |
| Durable learning | any role, via `memory-curator propose` | — (reviewed, not adversarially challenged) | the reviewer who runs `memory-curator review` for that memory's scope (project/platform: domain owner; studio: process owner; founder: the founder) | — (the knowledge base itself) | `memory-curator.mjs` ledger |

Two rows are marked **human gate** on purpose — they are the two the studio never automates
(`docs/HANDBOOK.md` Part 7: "Two human gates, and only two: scope-lock ... and ship"). Every other
row can run unattended; these two cannot, by design, regardless of confidence score.

## Conflict resolution

When two roles in the same row disagree (a Challenger disputes the Decider's call, or two
Challengers disagree with each other):

1. Name the decision, the competing positions, and the evidence each side has.
2. Find the row above — the "Decides" column is authoritative. A challenge that isn't resolved by
   the named decider escalates one level up that role's own reporting chain (e.g. `tech-lead` →
   `cto`; `code-reviewer` deadlock → `tech-manager` re-review or a different reviewer, never the
   ticket's own owner).
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
