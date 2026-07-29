---
name: role-activation
description: Use at project start — /app-init, /app-onboard, or /app-run's first step — to decide which of the 19 roles this product actually needs, and to write the durable roster the rest of the flow reads. Triggers whenever a command is about to fan out to a team, or a gate is about to run for a role that may not be on this project.
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

## The activation matrix

`on` = active · `?` = conditional, on its named trigger · `—` = off, for the named reason.

| Role | ios-app | android-app | mobile-app | backend-service | web-app | cli | library | Trigger for `?` / reason for `—` |
|---|---|---|---|---|---|---|---|---|
| **staffed?** | yes | yes | yes | yes | **no** | **no** | yes | `no` = recognised but unstaffed — activation refuses, see below |
| `ceo` | on | on | on | on | — | — | on | utility: absorbs the `cpo` charter (founder pass) |
| `cpo` | on | on | on | on | — | — | on | utility: off, merged into `ceo` |
| `cto` | on | on | on | on | — | — | on | utility: off, merged into `tech-lead` |
| `tech-lead` | on | on | on | on | — | — | on | utility: absorbs the `cto` charter (one technical pass) |
| `tech-manager` | on | on | on | on | — | — | on | someone must run the board on every staffed product |
| `ux-designer` | on | on | on | — | — | — | — | `—` no human-facing surface; API ergonomics belong to `tech-lead` |
| `ios-developer` | on | — | on | — | — | — | ? | `?` the library ships an Apple-platform target · `—` no Apple target |
| `android-developer` | — | on | on | — | — | — | ? | `?` the library ships an Android target · `—` no Android target |
| `backend-developer` | ? | ? | ? | on | — | — | ? | `?` `docs/20-architecture.md` names a server, API, or hosted component |
| `monetization-engineer` | ? | ? | ? | — | — | — | — | `?` the product sells IAP/subscriptions or serves ads · `—` no store-billing or ad surface (this role's charter is StoreKit 2 / Play Billing / AdMob) |
| `aso-specialist` | on | on | on | — | — | — | — | `—` no app-store listing exists to prepare |
| `data-analyst` | on | on | on | ? | — | — | — | `?` the product emits telemetry or the vision states KPI targets · `—` a library must not phone home; its consumers own analytics |
| `devops-engineer` | on | on | on | on | — | — | on | every staffed product has a branch model, CI, and a release channel |
| `product-validator` | on | on | on | on | — | — | on | flagship: always on. utility: `?` — on when `docs/00-founder-intent/` holds a record to validate against. **Outside the cpo/cto/tech-manager chain by construction; it reports to the founder gate** |
| `qa-engineer` | on | on | on | on | — | — | on | never tier-gated |
| `code-reviewer` | on | on | on | on | — | — | on | never tier-gated |
| `security-reviewer` | on | on | on | on | — | — | on | **never off on a staffed type, never tier-gated.** Anything handling user data or credentials gets a review; cheapness is not a reason |
| `verification-engineer` | on | on | on | on | — | — | on | **never off on a staffed type.** It certifies constants and proves guard rules can fail — every product has both |
| `release-manager` | on | on | on | on | — | — | on | the channel differs (store · deploy · package registry), the role does not |

The `—` down the `web-app` and `cli` columns is not a judgement about those roles. Those product
types are unstaffed, so **nothing** activates on them and no team is assembled at all.

### Every product type must name an IC — or it is unstaffed

A product type is **staffed** only if at least one of `ios-developer`, `android-developer`,
`backend-developer` is `on` or `?` for it. Those three are the roles that can own an implementation
ticket and actually build the thing; the rest review, coordinate, design, test, or ship it.

`web-app` and `cli` are **recognised but unstaffed**. Detection can identify them — a `package.json`
with a web framework is a real answer — but **activation then refuses and writes no roster**:

```
ACTIVATION REFUSED — product type `web-app` is recognised but unstaffed.
No IC role on this team can own a web-app implementation ticket:
there is no web-developer in agents/, and backend-developer builds services, not UI.
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
design (its own description names web, CLI and library). A `web-developer` is that skill, plus a
conventions delta for the stack, plus one matrix column flipped to `yes`. Do that deliberately, when
a real web product is on the table — not to make this table look complete.

### Tier deltas — `utility` only

Flagship uses the matrix as-is. Utility applies exactly these five changes and no others:

1. `cpo` → `off(merged-into: ceo — utility founder pass)`. `ceo` runs one pass covering both
   charters and writes `00-vision.md`, `10-prd.md`, `11-backlog.md`.
2. `cto` → `off(merged-into: tech-lead — utility technical pass)`. `tech-lead` runs one pass and
   writes `20-architecture.md`, `21-engineering-principles.md`, and the impl spec.
   The surviving role in each pair is the one with obligations *after* planning: `tech-lead` is on
   call for the pod all sprint, `cto` is not.
3. `ux-designer` → `conditional(more than one non-trivial screen, or any custom component)`.
4. `data-analyst` → `conditional(the vision states a KPI target)`.
5. `product-validator` → `conditional(docs/00-founder-intent/ holds a record)`. The trigger is the
   record, not the tier: a utility app built from a real brief still drifts from it, and a utility
   app built from a one-line idea has nothing to validate against — which the role would report as
   `INTENT: CANNOT EVALUATE` anyway. **The one thing that never flips is the independence:** on
   utility the `ceo` runs the founder pass and writes the PRD, so `product-validator` is the only
   role left that did not write what it checks. Merging it into anything defeats it.

**Never a tier delta:** `security-reviewer`, `verification-engineer`, `code-reviewer`,
`qa-engineer`. Utility means less ceremony, not less safety.

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
| ...one row per role in the matrix, all 19, none omitted |
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
