# Team roster

> **This copy is the template.** `/app-init` and `/app-onboard` copy it into the *target project's*
> `docs/02-team-roster.md` and fill it in from `role-activation`'s matrix. The plugin repo has no
> tier and no product type of its own — the values below are a worked example (flagship · mobile-app)
> showing the shape every generated roster must have.

Generated: <YYYY-MM-DD> by /app-init | /app-onboard
Tier: flagship  (source: derived from docs/01-intake.md §Scope — subscription + content library)
Product type: mobile-app  (source: docs/01-intake.md §Product type)

| Role | State | Reason / trigger |
|---|---|---|
| ceo | active | vision, success metrics, scope |
| cpo | active | flagship keeps both exec product roles |
| cto | active | flagship keeps both exec technical roles |
| tech-lead | active | impl specs; on call for the pod all sprint |
| tech-manager | active | runs the board |
| ux-designer | active | mobile-app has a human-facing surface |
| ios-developer | active | product type includes iOS |
| android-developer | active | product type includes Android |
| backend-developer | conditional | trigger: docs/20-architecture.md names a server or API component |
| monetization-engineer | conditional | trigger: product sells IAP/subscriptions or serves ads |
| aso-specialist | active | ships to the App Store and Play |
| data-analyst | active | product analytics + consent gate |
| devops-engineer | active | branch model, CI, signing |
| qa-engineer | active | never tier-gated |
| code-reviewer | active | never tier-gated |
| security-reviewer | active | never off — handles user data |
| verification-engineer | active | never off — certifies constants, proves guard rules can fail |
| release-manager | active | store release channel |

## Rules this file is held to

- **All 19 roles get a row.** A role missing from this file is not "off", it is unaccounted for.
- Three states only: `active`, `conditional`, `off`. A merge is an `off` with
  `merged-into: <role>` as its reason.
- A `conditional` role flips to `active` the round its trigger fires — amend the row, keep the
  reason, note the round. Never delete a row.
- An `off` role's gate is reported `N/A: <gate> — <role> is off(<reason>) per
  docs/02-team-roster.md`. That is not a `WAIVED:` — see `role-activation`.
- An unstaffed product type (`web-app`, `cli`) never reaches this file: activation refuses first.
