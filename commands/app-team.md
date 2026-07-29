---
description: List the agents on this app dev team and what each one does
allowed-tools: Read, Glob
---

# /app-team — Roster

Print the team in this order, each line as `<role> — <one-line charter>`:

**Exec**
- ceo — vision, success metrics, scope
- cpo — PRD, user stories, backlog
- cto — architecture, stack, engineering principles (starts from the House KB defaults)
- chief-of-staff — the single founder interface: decision briefs, unresolved commitments, founder
  inbox (flagship, and only when it removes more decisions than it creates)

**Product**
- product-manager — day-to-day product execution below the CPO: ticket clarification, backlog
  grooming, in-sprint scope calls
- product-researcher — independent evidence gathering, with fact / user evidence / competitor
  observation / hypothesis / agent inference labelled separately (conditional)

**Management**
- tech-lead — per-platform impl specs, patterns, hands-on senior
- tech-manager — sprint plan, board, daily report, merge gate, standups, pod coordination

**Build**
- ios-developer — Swift/SwiftUI implementation, routes through Axiom skills (multiple in parallel)
- android-developer — Kotlin/Compose implementation, Material 3 skills (multiple in parallel)
- web-developer — TypeScript/browser implementation; the IC that makes `web-app` a staffed product type
- backend-developer — API + persistence (if backend in scope); activates as the `ai-engineer`,
  `data-engineer` or `integration-engineer` variant when the architecture calls for one
- monetization-engineer — StoreKit/Play Billing IAP, paywall gateway, AdMob + consent
- code-reviewer — gate on every PR-equivalent; runs Axiom auditors on iOS branches
- qa-engineer — test plans, bug filing, ship sign-off
- test-automation-engineer — test infrastructure, the device and state matrix, evidence bundles,
  flake detection (flagship, conditional)
- verification-engineer — executes what everyone else asserts: sweeps constants against outside
  reference data, grades every guard rule, and must watch a rule fail before trusting it

**Design & Growth**
- ux-architect — information architecture, navigation, flows, the screen-and-state inventory
- product-designer — screen composition, hierarchy, interaction, visual quality, tokens, components
- aso-specialist — store listing, keywords, screenshots, store-readiness gate
- data-analyst — analytics schema, instrumentation check, post-launch KPI report

**Platform & Release**
- devops-engineer — git strategy, CI, signing, flavors, secrets hygiene
- security-reviewer — pre-ship MASVS pass, severity-classified findings (and the privacy checklist
  as its privacy mode on utility projects)
- privacy-reviewer — data inventory, consent, retention, regional compliance (flagship)
- reliability-engineer — offline, retries, idempotency, sync conflict, state restoration, recovery
  (flagship, conditional)
- red-team-agent — attacks the product *and* the studio's own assumptions (flagship, conditional)
- release-manager — version, signing, store upload, release notes
- release-auditor — independently reviews the evidence bundle and the gate record, and can block the
  release. `release-manager` cannot satisfy it — separation of duties

End by reminding the user that **not every role runs on every project**: `role-activation` decides
the roster from the product type and tier, records every deactivation with its reason in
`docs/02-team-roster.md`, and refuses outright on a product type no IC can build. Also that team
size can be tuned per project via the `tech-manager` agent, and that all build agents read the
Mobify Studio House Knowledge Base (`knowledge/`) before working.
