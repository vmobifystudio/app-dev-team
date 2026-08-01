---
name: role-activation
description: Use at project start — /app-init, /app-onboard, or /app-run's first step — to decide which of the roles this product actually needs, and to write the durable roster the rest of the flow reads. Triggers whenever a command is about to fan out to a team, or a gate is about to run for a role that may not be on this project.
---

# Role activation

The roster is not fixed. A three-screen utility does not need a CEO *and* a CPO, and a backend
service does not need an ASO specialist, a store-readiness gate, or a runtime gate hunting for an
`.xcodeproj`. Activation has **two axes**, and both are decided once, up front, and written down.

- **Tier** — `flagship` | `utility`. How much process the work deserves (House KB §Tiers).
- **Product type** — `ios-app` | `android-app` | `mobile-app` | `backend-service` | `web-app` |
  `cli` | `library`. Which specialists exist at all.

**A deactivated role is recorded, never silently absent.** Everything below exists to serve that
one rule: an absent role and a skipped role must stay distinguishable six months later.

## Determining the two axes

**Greenfield** — from `docs/01-intake.md`, which `requirements-intake` has already written:

- *Product type* ← its `## Product type` answer (intake question 3). One answer, verbatim.
- *Tier* ← an explicit `--utility` / `--flagship` flag if the user passed one; otherwise derive:
  **utility** when the intake describes a single-purpose tool with one core action and no
  subscription, content library, or AI system; **flagship** otherwise. State the derived tier and
  its evidence in the Gate 1 brief — it is a scope decision, and Gate 1 is where scope is approved.

**Brownfield** — from `brownfield-onboarding` Step 1 detection, never from a README:

| Detected | Product type |
|---|---|
| `*.xcodeproj` / `*.xcworkspace` only | `ios-app` |
| `settings.gradle*` + `app/` only | `android-app` |
| both of the above | `mobile-app` |
| `package.json` with a web framework, or any `public/`+`index.html` | `web-app` |
| server framework or `Dockerfile`/`Procfile`, no UI surface | `backend-service` |
| a binary entry point (`bin`, `cmd/`, `main.go`, `[[bin]]`) and no UI | `cli` |
| a package manifest that publishes, with no entry point | `library` |

Tier for brownfield: derive from the app's size and shape (module count, subscription/ads SDKs
present), and say which signal decided it. **When detection is ambiguous, ask the user one
question — do not guess.** A wrong product type turns off the wrong specialists.

## Why a role exists

The matrix below decides *when* a role activates. It does not decide whether the role should exist
at all — that is a separate, cheaper question, and skipping it is how a role catalogue grows past
what any product actually needs. Once a role clears this bar, `docs/03-decision-rights.md` is where
its actual authority — propose, challenge, decide, execute, record evidence — is written down; this
table only answers whether the role should exist, not what it may do once it does.

**A role is justified only if it needs at least one of:**

| Tag | Meaning |
|---|---|
| `authority` | independent decision authority — it decides something no other role can decide for it |
| `context` | an independent context that must not inherit another role's framing (an evidence-gatherer that reasoned from the thing it's evidence-gathering *for* would confirm its own hypothesis) |
| `capability` | a materially different capability or security boundary (a different platform, a different attack surface, a different tool) |
| `duties` | accountability that must remain separate for governance reasons (the author cannot be the sole reviewer, the actor cannot be the sole auditor) |

Everything else is a skill, an operating mode, a checklist, or a gate inside an existing role —
not a new agent file. This is the test Phase 2 of the studio's own revamp already applied once,
cutting a ~40-role plan to today's 29; the table below re-applies it to the roster as it stands now.

| Role | Tag | Why |
|---|---|---|
| `ceo` | `authority` | final scope/vision authority no other role holds |
| `cpo` | `authority` | product-decision authority distinct from engineering |
| `cto` | `authority` | technical-strategy authority distinct from product |
| `chief-of-staff` | `context` | one founder-facing decision-brief context, deliberately not the CEO's own strategic framing — its own description says it "is only worth running if it removes more decisions than it creates" |
| `product-manager` | `capability` | day-to-day ticket-clarification capability below CPO's strategic layer, so CPO is not the bottleneck for every clarification |
| `product-researcher` | `context` | evidence-gathering that must not inherit the CPO's framing, or it would confirm its own hypothesis rather than test it |
| `tech-lead` | `authority` | technical-design authority distinct from CTO's strategic layer |
| `tech-manager` | `authority` | execution/scheduling authority — the only role that merges |
| `ux-architect` | `capability` | information-architecture/flow capability distinct from screen composition |
| `product-designer` | `capability` | visual/screen-composition capability, deliberately not self-approving its own fidelity |
| `ios-developer` | `capability` | Swift/SwiftUI platform capability |
| `android-developer` | `capability` | Kotlin/Compose platform capability |
| `backend-developer` | `capability` | server/API/infra-as-code capability |
| `web-developer` | `capability` | browser-platform capability — the IC that makes product type `web-app` staffed |
| `monetization-engineer` | `capability` | billing/ads correctness is a distinct capability and a distinct financial-blast-radius boundary from general implementation |
| `aso-specialist` | `capability` | store-listing/keyword capability, distinct from product or engineering |
| `data-analyst` | `capability` | analytics-schema and consent-gate capability |
| `devops-engineer` | `capability` | repo plumbing, CI, signing — a distinct operational boundary |
| `product-validator` | `duties` | must sit outside the cpo/cto/tech-manager chain by construction — it cannot validate a PRD it had a hand in writing |
| `qa-engineer` | `duties` | acceptance verification independent of the implementer |
| `test-automation-engineer` | `capability` | harness/infra-building capability distinct from `qa-engineer`'s exploratory pass |
| `code-reviewer` | `duties` | the implementer cannot be its own sole reviewer |
| `security-reviewer` | `capability` | a distinct attack-surface/compliance boundary from functional review — "never off, handles user data" |
| `privacy-reviewer` | `capability` | a distinct evidence set from security (data inventory, consent, retention, regional compliance) |
| `reliability-engineer` | `capability` | offline/retry/recovery is broad enough to need its own pass — "a checklist item inside code review is where it has always been skipped" |
| `red-team-agent` | `context` | adversarial framing does not compose with a reviewer's frame — its own description states this explicitly |
| `verification-engineer` | `duties` | certifies a claim nobody executed — independent of whoever made the claim |
| `release-auditor` | `duties` | the actor performing an irreversible release action must not be its sole evaluator |
| `release-manager` | `authority` | executes the one irreversible action (the actual upload) |
| `incident-commander` | `authority` | independent coordination authority during a live sev1/sev2 — deliberately not `release-manager` (may be the cause) or `tech-manager` (running an unrelated sprint) |

**Honest finding, not a rubber stamp**: every current role clears the bar above at least once. That
is not surprising — this roster already survived one real cut (the studio's own Phase 2 revamp
narrowed a ~40-role plan to these 29 using this same test), so a second pass finding nothing to cut
is the expected outcome of a test that already ran once, not evidence the test is toothless. Re-run
this table whenever a new role is proposed, and expect it to sometimes say no.

## The activation matrix

`on` = active · `?` = conditional, on its named trigger · `—` = off, for the named reason.

| Role | ios-app | android-app | mobile-app | backend-service | web-app | cli | library | Trigger for `?` / reason for `—` |
|---|---|---|---|---|---|---|---|---|
| **staffed?** | yes | yes | yes | yes | yes | **no** | yes | `no` = recognised but unstaffed — activation refuses, see below |
| `ceo` | on | on | on | on | on | — | on | utility: absorbs the `cpo` charter (founder pass) |
| `cpo` | on | on | on | on | on | — | on | utility: off, merged into `ceo` |
| `cto` | on | on | on | on | on | — | on | utility: off, merged into `tech-lead` |
| `chief-of-staff` | ? | ? | ? | ? | ? | — | ? | `?` flagship **and** the founder is fielding more than one project or more than five open decisions — otherwise `ceo` is already the founder interface and this role adds load instead of removing it |
| `product-manager` | on | on | on | on | on | — | — | utility: off, merged into `cpo`/`ceo` · `—` a library's consumers are engineers; `tech-lead` fields their questions |
| `product-researcher` | ? | ? | ? | ? | ? | — | — | `?` new-product or repositioning work, i.e. `docs/01-intake.md` names a market or user assumption nobody has tested · `—` a library's market question is API design |
| `tech-lead` | on | on | on | on | on | — | on | utility: absorbs the `cto` charter (one technical pass) |
| `tech-manager` | on | on | on | on | on | — | on | someone must run the board on every staffed product |
| `ux-architect` | on | on | on | — | on | — | — | `—` no human-facing surface; API ergonomics belong to `tech-lead` |
| `product-designer` | on | on | on | — | on | — | — | `—` no human-facing surface. utility: `?` more than one non-trivial screen, or any custom component |
| `ios-developer` | on | — | on | — | — | — | ? | `?` the library ships an Apple-platform target · `—` no Apple target |
| `android-developer` | — | on | on | — | — | — | ? | `?` the library ships an Android target · `—` no Android target |
| `backend-developer` | ? | ? | ? | on | ? | — | ? | `?` `docs/20-architecture.md` names a server, API, or hosted component. Its `ai` / `data` / `integration` variants are named below |
| `web-developer` | — | — | — | — | on | — | ? | `?` the library ships a JS/TS or browser target · `—` no browser surface |
| `monetization-engineer` | ? | ? | ? | — | ? | — | — | `?` the product sells IAP/subscriptions or serves ads · `—` no store-billing or ad surface (this role's charter is StoreKit 2 / Play Billing / AdMob) |
| `aso-specialist` | on | on | on | — | — | — | — | `—` no app-store listing exists to prepare |
| `data-analyst` | on | on | on | ? | on | — | — | `?` the product emits telemetry or the vision states KPI targets · `—` a library must not phone home; its consumers own analytics |
| `devops-engineer` | on | on | on | on | on | — | on | every staffed product has a branch model, CI, and a release channel |
| `product-validator` | on | on | on | on | on | — | on | flagship: always on. utility: `?` — on when `docs/00-founder-intent/` holds a record to validate against. **Outside the cpo/cto/tech-manager chain by construction; it reports to the founder gate** |
| `qa-engineer` | on | on | on | on | on | — | on | never tier-gated |
| `test-automation-engineer` | ? | ? | ? | ? | ? | — | ? | `?` flagship **and** the device-and-state matrix exceeds what one exploratory pass can cover, or a suite already exists to maintain. Utility: off — `qa-engineer` covers it |
| `code-reviewer` | on | on | on | on | on | — | on | never tier-gated |
| `security-reviewer` | on | on | on | on | on | — | on | **never off on a staffed type, never tier-gated.** Anything handling user data or credentials gets a review; cheapness is not a reason. On utility it also runs the **privacy mode** — see below |
| `privacy-reviewer` | on | on | on | on | on | — | ? | flagship only — utility folds it into `security-reviewer`'s privacy mode. `?` a library that itself collects or transmits data |
| `reliability-engineer` | ? | ? | ? | ? | ? | — | ? | `?` flagship **and** the product syncs, works offline, holds user-created data, or performs an operation that costs money |
| `red-team-agent` | ? | ? | ? | ? | ? | — | ? | `?` flagship **and** (the product handles money, personal data, or user-to-user content) — or the last release shipped a defect a gate should have caught |
| `verification-engineer` | on | on | on | on | on | — | on | **never off on a staffed type.** It certifies constants and proves guard rules can fail — every product has both |
| `release-auditor` | on | on | on | on | on | — | on | **never off on a staffed type, never tier-gated.** Separation of duties: `release-manager` performs an irreversible action and must not be its sole evaluator |
| `release-manager` | on | on | on | on | on | — | on | the channel differs (store · deploy · package registry), the role does not |
| `incident-commander` | ? | ? | ? | ? | ? | — | ? | `?` `incident-ledger.mjs` has an open `sev1`/`sev2` record — never active between incidents; a role that ran all sprint for no reason is the opposite of what a conditional role is for |

The `—` down the `cli` column is not a judgement about those roles. That product type is unstaffed,
so **nothing** activates on it and no team is assembled at all.

`web-app` was in the same position until `web-developer` existed. It is now staffed, and the column
is a real activation, not a courtesy: `web-developer` owns its implementation tickets and
`ux-architect` / `product-designer` its surface.

**`cli` stays unstaffed.** No IC on this team can own a CLI implementation ticket, and adding one to
make the table look complete is exactly what the "unstaffed" state exists to prevent. Activation
refuses on `cli`, by design, until a real CLI product is on the table and someone adds the IC.

### `backend-developer` activation variants

`ai-engineer`, `data-engineer` and `integration-engineer` are **not roles and get no agent file.**
They are `backend-developer` activated with a different conventions pack and a different set of
review dimensions. The workflow — `ic-workflow`, the CODE contract, the gates — is identical, which
is the whole reason they are variants: three more agent files would be three more things that can
drift from each other.

Record the variant in the roster row's reason, so a reader knows which pack was loaded:

| Variant | Trigger | Conventions delta | Extra review dimension |
|---|---|---|---|
| **ai-engineer** | the architecture names a model, embedding store, or prompt-driven feature | prompt and model versioning, token/cost budget, eval set before rollout, deterministic fallback when the model is unavailable | non-determinism: what does this do when the model returns nonsense, refuses, or times out |
| **data-engineer** | the architecture names a pipeline, warehouse, or scheduled transform | schema contracts, idempotent and replayable jobs, backfill plan, late and duplicate data | `database-migration`, plus: what happens when yesterday's job is re-run today |
| **integration-engineer** | the architecture names a third-party API the product depends on | contract test against the real API, versioning and deprecation policy, secret handling, rate limits | the vendor being down, slow, or breaking its contract without telling you |

`board-doctor` still sees `backend-developer` as the owner — the variant is a roster annotation, not
a new spawnable name.

### Every product type must name an IC — or it is unstaffed

A product type is **staffed** only if at least one of `ios-developer`, `android-developer`,
`backend-developer`, `web-developer` is `on` or `?` for it. Those four are the roles that can own an
implementation ticket and actually build the thing; the rest review, coordinate, design, test, or
ship it.

`cli` is **recognised but unstaffed**. Detection can identify it — a `main.go` with no UI is a real
answer — but **activation then refuses and writes no roster**:

```
ACTIVATION REFUSED — product type `cli` is recognised but unstaffed.
No IC role on this team can own a cli implementation ticket:
there is no cli-developer in agents/, and backend-developer builds services, not command-line tools.
To proceed, either: (a) build this as a different product type, or
(b) add the missing IC role — see below — and add it to the activation matrix.
```

Refusing is the correct outcome. Assembling a team that cannot build the product is not: `/app-build`
spawns strictly by a ticket's `Owner`, and `board-doctor` rejects an owner the loop cannot spawn — so
a web UI ticket either strands with no valid owner or goes to `backend-developer`, who builds it
against the wrong conventions. Declared, never picked up, never reported: the exact failure this
repo keeps finding.

`team-doctor` enforces the rule mechanically, both ways: a `staffed` type with no IC is a
configuration error, and an `unstaffed` type whose column names an IC is worse — it would activate.

**Adding an IC is cheap and well-defined**, which is what makes "unstaffed" a costed decision rather
than an accident. `ic-workflow` already holds the whole ticket lifecycle and is product-agnostic by
design (its own description names web, CLI and library). `web-developer` is exactly that: the skill,
plus a conventions delta for the stack, plus one matrix column flipped to `yes` — and it is what
moved `web-app` from unstaffed to staffed. A `cli-developer` would be the same three things. Do it
deliberately, when a real CLI product is on the table — not to make this table look complete.

### Tier deltas — `utility` only

Flagship uses the matrix as-is. Utility applies exactly these eight changes and no others:

1. `cpo` → `off(merged-into: ceo — utility founder pass)`. `ceo` runs one pass covering both
   charters and writes `00-vision.md`, `10-prd.md`, `11-backlog.md`.
2. `cto` → `off(merged-into: tech-lead — utility technical pass)`. `tech-lead` runs one pass and
   writes `20-architecture.md`, `21-engineering-principles.md`, and the impl spec.
   The surviving role in each pair is the one with obligations *after* planning: `tech-lead` is on
   call for the pod all sprint, `cto` is not.
3. `product-manager` → `off(merged-into: ceo — the utility founder pass answers ticket questions
   directly)`. On a three-screen tool there is no clarification queue to absorb.
4. `product-designer` → `conditional(more than one non-trivial screen, or any custom component)`.
   `ux-architect` stays on: a flow that is wrong is wrong on every screen, however small.
5. `data-analyst` → `conditional(the vision states a KPI target)`.
6. `product-validator` → `conditional(docs/00-founder-intent/ holds a record)`. The trigger is the
   record, not the tier: a utility app built from a real brief still drifts from it, and a utility
   app built from a one-line idea has nothing to validate against — which the role would report as
   `INTENT: CANNOT EVALUATE` anyway. **The one thing that never flips is the independence:** on
   utility the `ceo` runs the founder pass and writes the PRD, so `product-validator` is the only
   role left that did not write what it checks. Merging it into anything defeats it.
7. `privacy-reviewer` → `off(merged-into: security-reviewer — privacy MODE)`. One role, two
   checklists: `security-reviewer` runs its own list and then `agents/privacy-reviewer.md`'s,
   and reports both verdict lines. **Utility means one reviewer, never one checklist.**
8. `chief-of-staff`, `test-automation-engineer`, `reliability-engineer`, `red-team-agent` →
   `off(flagship-only)`. Their triggers are flagship-gated in the matrix already; this states it in
   the roster so the reason is on the record rather than inferred from a blank.

**Never a tier delta:** `security-reviewer`, `verification-engineer`, `code-reviewer`,
`qa-engineer`, `release-auditor`. Utility means less ceremony, not less safety — and `release-auditor`
in particular is *separation of duties*, which a small project needs exactly as much as a large one.

## Writing the roster — `docs/02-team-roster.md`

Written once, by `/app-init` or `/app-onboard`, after both axes are fixed. It is the manifest every
later command reads instead of re-deriving activation — it survives agent death and makes the
decision auditable. Exactly this shape:

```markdown
# Team roster

Generated: <YYYY-MM-DD> by /app-init | /app-onboard
Tier: flagship | utility  (source: --utility flag | docs/01-intake.md §Scope | detected: <signal>)
Product type: <one of the seven>  (source: docs/01-intake.md §Product type | detected: <marker>)

| Role | State | Reason / trigger |
|---|---|---|
| ceo | active | founder pass — also covers the cpo charter (utility) |
| cpo | off | merged-into: ceo — utility founder pass |
| aso-specialist | off | product type backend-service has no app-store listing |
| backend-developer | conditional | trigger: docs/20-architecture.md names a server component |
| monetization-engineer | conditional | trigger: product sells IAP/subscriptions or serves ads |
| backend-developer | active | variant: data-engineer — architecture names a scheduled transform |
| product-validator | conditional | trigger: docs/00-founder-intent/ holds a record to validate against |
| privacy-reviewer | off | merged-into: security-reviewer — privacy MODE (utility) |
| ...one row per role in the matrix, none omitted |
```

Three states only: `active`, `conditional`, `off`. **Every role gets a row.** A role missing from
this file is not "off" — it is unaccounted for, which is the silent-drop class this codebase keeps
finding. `team-doctor` enforces the same completeness on the matrix above.

A `conditional` role flips to `active` the moment its trigger is met — amend the row, keep the
reason, and note the round it flipped. Never delete a row.

## `N/A` is not `WAIVED`

Three-state gate vocabulary already exists (`PASS` / `FAIL` / `CANNOT EVALUATE`). Activation adds
one distinction on top, and the two must never blur:

- **`WAIVED: <artifact> — <who> — <reason>`** — a real, applicable gate that a *human decided* to
  proceed without. Requires a name and a reason, recorded in `docs/60-releases.md`.
- **`N/A: <gate> — <role> is off(<reason>) per docs/02-team-roster.md`** — the gate is
  *structurally inapplicable* because the role that owns it is not on this project. No human
  decided anything; there was nothing to decide.

An inactive role's gate is `N/A` and is **printed, not omitted** — in the ship summary, the standup,
and the release record. Recording a structural N/A as a waiver invents a decision nobody made;
recording a waiver as an N/A hides one somebody did.
