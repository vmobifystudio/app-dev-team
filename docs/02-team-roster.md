# Team roster

> **This copy is the template.** `/app-init` and `/app-onboard` copy it into the *target project's*
> `docs/02-team-roster.md` and fill it in from `role-activation`'s matrix. The plugin repo has no
> tier and no product type of its own — the values below are a worked example (flagship · mobile-app)
> showing the shape every generated roster must have.
>
> **Every row below is derived from `skills/role-activation/SKILL.md`'s matrix, mobile-app column.**
> That is not a stylistic note: `scripts/team-doctor.mjs` asserts the two files name exactly the
> same set of roles, and it blocks when they drift. They drifted once — see DR5-002 — and the
> template went on naming a role that had been split in two and silently omitting `release-auditor`,
> whose entire reason for existing is that `release-manager` must not evaluate its own release.

Generated: <YYYY-MM-DD> by /app-init | /app-onboard
Tier: flagship  (source: derived from docs/01-intake.md §Scope — subscription + content library)
Product type: mobile-app  (source: docs/01-intake.md §Product type)

| Role | State | Reason / trigger |
|---|---|---|
| ceo | active | vision, success metrics, scope |
| cpo | active | flagship keeps both exec product roles |
| cto | active | flagship keeps both exec technical roles |
| chief-of-staff | conditional | trigger: the founder is fielding more than one project, or more than five open decisions |
| product-manager | active | flagship keeps the standing product owner |
| product-researcher | conditional | trigger: docs/01-intake.md names a market or user assumption nobody has tested |
| tech-lead | active | impl specs; on call for the pod all sprint |
| tech-manager | active | runs the board |
| ux-architect | active | mobile-app has a human-facing surface — flow and IA |
| product-designer | active | mobile-app has a human-facing surface — screens |
| ios-developer | active | product type includes iOS |
| android-developer | active | product type includes Android |
| backend-developer | conditional | trigger: docs/20-architecture.md names a server, API, or hosted component |
| web-developer | off | no browser surface on a mobile-app |
| monetization-engineer | conditional | trigger: the product sells IAP/subscriptions or serves ads |
| aso-specialist | active | ships to the App Store and Play |
| data-analyst | active | product analytics + consent gate |
| devops-engineer | active | branch model, CI, signing |
| product-validator | active | flagship: always on. Outside the cpo/cto/tech-manager chain; reports to the founder gate |
| qa-engineer | active | never tier-gated |
| test-automation-engineer | conditional | trigger: the device-and-state matrix exceeds one exploratory pass, or a suite already exists to maintain |
| code-reviewer | active | never tier-gated |
| security-reviewer | active | never off — handles user data |
| privacy-reviewer | active | flagship only; utility folds this into security-reviewer's privacy mode |
| reliability-engineer | conditional | trigger: the product syncs, works offline, holds user-created data, or performs an operation that costs money |
| red-team-agent | conditional | trigger: the product handles money, personal data, or user-to-user content — or the last release shipped a defect a gate should have caught |
| verification-engineer | active | never off — certifies constants, proves guard rules can fail |
| release-auditor | active | never off — separation of duties: release-manager performs an irreversible action and must not be its sole evaluator |
| release-manager | active | store release channel |
| incident-commander | conditional | trigger: incident-ledger.mjs has an open sev1/sev2 record |

## Rules this file is held to

- **Every role in the activation matrix gets a row.** A role missing from this file is not "off",
  it is unaccounted for. The count is not written here on purpose: a hardcoded number is one more
  thing that goes stale, and `team-doctor` compares against the matrix rather than against a number
  somebody typed.
- Three states only: `active`, `conditional`, `off`. A merge is an `off` with
  `merged-into: <role>` as its reason.
- A `conditional` role flips to `active` the round its trigger fires — amend the row, keep the
  reason, note the round. Never delete a row.
- An `off` role's gate is reported `N/A: <gate> — <role> is off(<reason>) per
  docs/02-team-roster.md`. That is not a `WAIVED:` — see `role-activation`.
- An unstaffed product type never reaches this file: activation refuses first. Today `cli` is the
  only unstaffed type — `web-app` **is** staffed, and this line said otherwise until DR5-002.
