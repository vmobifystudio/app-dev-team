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
