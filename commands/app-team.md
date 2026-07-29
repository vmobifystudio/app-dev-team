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

- product-validator — compares the founder's recorded brief to the PRD and flags omitted intent,
  invented requirements and silent scope change. Sits outside the cpo/cto/tech-manager chain,
  reports to the scope-lock gate, and never writes the PRD it checks

**Management**
- tech-lead — per-platform impl specs, patterns, hands-on senior
- tech-manager — sprint plan, board, daily report, merge gate, standups, pod coordination

**Build**
- ios-developer — Swift/SwiftUI implementation, routes through Axiom skills (multiple in parallel)
- android-developer — Kotlin/Compose implementation, Material 3 skills (multiple in parallel)
- backend-developer — API + persistence (if backend in scope)
- monetization-engineer — StoreKit/Play Billing IAP, paywall gateway, AdMob + consent
- code-reviewer — gate on every PR-equivalent; runs Axiom auditors on iOS branches
- qa-engineer — test plans, bug filing, ship sign-off
- verification-engineer — executes what everyone else asserts: sweeps constants against outside
  reference data, grades every guard rule, and must watch a rule fail before trusting it

**Design & Growth**
- ux-designer — flows, design tokens, component inventory
- aso-specialist — store listing, keywords, screenshots, store-readiness gate
- data-analyst — analytics schema, instrumentation check, post-launch KPI report

**Platform & Release**
- devops-engineer — git strategy, CI, signing, flavors, secrets hygiene
- security-reviewer — pre-ship MASVS pass, severity-classified findings
- release-manager — version, signing, store upload, release notes

End by reminding the user that team size and roles can be tuned per project via the `tech-manager`
agent, and that all build agents read the Mobify Studio House Knowledge Base (`knowledge/`) before working.
