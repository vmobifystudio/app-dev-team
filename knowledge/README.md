# Mobify Studio — House Knowledge Base

These packs encode how Mobify Studio actually builds and ships mobile apps. They were mined
from our internal shipped apps and are the **default conventions** every
agent in this plugin reads before working.

## Packs

| Pack | What it governs |
|---|---|
| `stack-defaults.md` | Default languages, versions, libraries, SDK targets per platform |
| `ios-conventions.md` | iOS architecture, layering, concurrency, UI, testing rules |
| `android-conventions.md` | Android architecture, modules, state, persistence, UI rules |
| `monetization.md` | StoreKit/Play Billing paywalls, AdMob, UMP consent, NO-AD zones |
| `analytics.md` | Consent-gated analytics, event naming, funnels, PII rules |
| `aso.md` | Screenshots, store listings, Play Data Safety, store readiness |
| `git-workflow.md` | Branch model, commits, versioning, releases, CI, secrets |

## How agents use these

An agent loads the relevant pack(s) via the `house-conventions` skill **before** writing code
or specs, then follows them unless the project's own `docs/` explicitly overrides a rule.
House conventions are the floor, not a ceiling — a project can be stricter.

## Governance — living and auto-updated

This KB improves after every shipped app:

- `/app-learn <path-to-app>` re-mines a (new or existing) app and folds net-new learnings back
  into these packs, printing a diff summary.
- **Conflicts are flagged, never silently overwritten.** When two apps disagree (e.g. analytics
  default opt-in vs opt-out — a real disagreement found between one internal app's code and its
  CLAUDE.md), the pack records both and the studio's chosen default, and surfaces the conflict
  for a human decision.
- The studio's portable standards artifact `iOS_GENERIC_RULES_AND_LEARNINGS.md`
  (distilled from an internal flagship app) is the spiritual ancestor of these packs; keep them
  in that spirit — concrete, example-driven, "the 12 mistakes that cost the most."

## Tiers

Some packs distinguish two app archetypes the studio ships:
- **Flagship** — content/AI/subscription apps: modern Compose/SwiftUI, multi-module, high test
  coverage, subscription-first.
- **Utility** — single-purpose tools: leaner, ad-first monetization, faster to ship. The plugin
  defaults to **Flagship** rules unless a project declares itself a utility.
