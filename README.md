<div align="center">

# 📱 app-dev-team

**An autonomous mobile-app development team for [Claude Code](https://claude.com/claude-code).**

Give it a one-line idea. A 17-role team — exec, management, engineering, design, growth, and
release — takes it from scope to a shipped iOS/Android app, working in parallel, reviewing and
fixing its own code, reporting via daily standups, and stopping for you at only two gates:
**scope-lock** and **ship**.

[![version](https://img.shields.io/badge/version-1.0.0-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![platforms](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey)]()
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-8A2BE2)]()

</div>

---

## Why this exists

Most "AI builds your app" demos are a single agent improvising. Real software gets built by a
**team with roles, handoffs, conventions, and a review gate**. This plugin models that:

- **A real org chart.** CEO sets vision, CPO writes the PRD, CTO picks the stack, a tech-lead turns
  it into impl specs, a tech-manager runs the board, and a pod of specialist engineers ships it.
- **It uses your skills as hands.** iOS work routes through the **Axiom** skill ecosystem (~150
  skills: SwiftUI 26, Swift concurrency, SwiftData, build-fixing, App Store submission, IAP…),
  Android through **Material 3 / Compose** skills, store work through **ASO** skills. The team
  doesn't re-invent that knowledge — it *wields* it.
- **It builds the way you already build.** A **House Knowledge Base** (`knowledge/`) — mined from
  7 shipped apps — encodes your real architecture, monetization, analytics, ASO, and git
  conventions. New apps come out in *your* house style, not generic AI defaults. And it's
  **living**: every shipped app folds its learnings back in.
- **Zero external dependencies.** Pure Claude Code — subagents, commands, skills, and
  docs-as-shared-memory. Nothing to install on a server. Anyone can clone and run it.

## Quickstart

```bash
# 1) Install: clone into your Claude Code plugins, or add via your marketplace.
# 2) From the root of a new (empty) project directory:

/app-run "A habit tracker for new parents, iOS + Android, freemium"
```

`/app-run` drives the whole thing. It pauses once for **scope-lock** (approve the vision + PRD +
architecture), then runs the sprint autonomously — parallel devs → code review → merge → QA → bug
loop — streaming a standup after each round, and pauses again only at **ship**.

Prefer to drive manually? Use the granular commands below.

## The autonomy model

```
            ┌─────────────── GATE 1: scope-lock (you approve) ───────────────┐
 idea ─▶ /app-init ─▶ vision + PRD + architecture + impl specs + CLAUDE.md ───┘
                                       │
                                       ▼
                          /app-plan  →  parallel board
                                       │
                  ┌────────────────────▼─────────────────────┐
                  │  /app-build loop (autonomous)             │
                  │   parallel devs ─▶ streaming code review  │
                  │   (Axiom audits on iOS) ─▶ merge gate     │
                  │   ─▶ QA ─▶ bug loop ─▶ daily standup      │
                  │   escalates ONLY blockers + cap-hits      │
                  └────────────────────┬─────────────────────┘
                                       ▼
        ship-readiness: ASO assets · security (MASVS) · analytics verified
                                       │
            ┌─────────────── GATE 2: ship (you confirm) ─────────────────────┐
            └────────────── /app-ship ─▶ store upload ───────────────────────┘
```

"Mostly autonomous" means the team drafts and ships most of the work and **shows you the seams** —
it never invents intent when a requirement is ambiguous; it writes the blocker to the standup and
surfaces it verbatim.

## The roster (17 agents)

| Layer | Agent | Owns |
|---|---|---|
| **Exec** | `ceo` | Vision, success metrics, scope |
| | `cpo` | PRD, user stories, backlog |
| | `cto` | Architecture & stack (starts from the House KB defaults) |
| **Management** | `tech-lead` | Per-platform impl specs, reusable patterns |
| | `tech-manager` | Sprint board, parallel coordination, standups, **merge gate** |
| **Engineering** | `ios-developer` | SwiftUI — routes through Axiom iOS skills (parallel) |
| | `android-developer` | Compose/Material 3 (parallel) |
| | `backend-developer` | API + persistence (when in scope) |
| | `monetization-engineer` | StoreKit/Play Billing IAP, paywall gateway, AdMob + consent |
| | `code-reviewer` | The gate — runs **Axiom auditor agents** on iOS branches |
| | `qa-engineer` | Test plans, bug filing, ship sign-off |
| **Design & Growth** | `ux-designer` | Flows, design tokens, component inventory |
| | `aso-specialist` | Store listing, keywords, screenshots, readiness gate |
| | `data-analyst` | Analytics schema, instrumentation check, post-launch KPIs |
| **Platform & Release** | `devops-engineer` | Git strategy, CI, signing, flavors, secrets hygiene |
| | `security-reviewer` | Pre-ship MASVS pass, severity-classified findings |
| | `release-manager` | Versioning, signing, store upload, release notes |

Every build agent invokes the `house-conventions` skill before working. Roles are just Markdown
files — add, remove, or retune them.

## Commands

| Command | What it does |
|---|---|
| `/app-run [idea]` | **The autonomous driver** — init → scope-lock → sprint loop → ship-readiness. `--yolo` skips scope-lock; wrap in `/loop` for hands-off pacing. |
| `/app-init [idea]` | Intake → CEO vision → parallel CPO/CTO → parallel ux/tech-lead/devops → bootstraps the project `CLAUDE.md`, `.gitignore`, and git strategy. |
| `/app-plan [focus]` | Tech-manager turns backlog + specs into a parallel-friendly board. |
| `/app-build [tickets]` | Spawns devs/reviewers/QA in parallel; streams reviews; gates merges; loops the bug fixes. 2-cycle review cap. |
| `/app-review <branch>` | Code review on a single branch. |
| `/app-ship [version]` | Parallel security + ASO + analytics readiness → release-manager. Confirms before any upload. |
| `/app-status` | Vision, sprint goal, board summary, blockers, latest standup. |
| `/app-learn <app paths>` | Mines a shipped app's conventions into the **living** House KB; flags conflicts for your decision. |
| `/app-team` | Lists the roster. |

## The House Knowledge Base (`knowledge/`)

Mined from 7 shipped Mobify Studio apps (AI Baby Growth iOS + Android, GPS Camera iOS, GPS Map
Camera, LifeOS, ZipMaker, Photo Recovery). Every build agent reads the relevant pack first:

| Pack | Encodes |
|---|---|
| `stack-defaults.md` | Default languages, versions, libraries, SDK targets |
| `ios-conventions.md` | Layering, Display DTOs, Swift 6 concurrency rules, DI, tokens, a11y |
| `android-conventions.md` | Clean Architecture modules, the 5 ViewModel patterns, Room/DataStore |
| `monetization.md` | Two-door paywall gateway, StoreKit/Play Billing, AdGate, consent |
| `analytics.md` | Consent-gated events, PII rules, funnels, retention |
| `aso.md` | Screenshot automation, Play Data Safety, store-readiness gate |
| `git-workflow.md` | Branch model, commit conventions, versioning, CI, secrets |

It's **living** — `/app-learn` folds new learnings from each shipped app back in, and flags
conflicts (it never silently overwrites a convention).

## What it leverages on your machine

The plugin is dependency-free, but gets dramatically better when these are installed (they're
soft-routed — absent ones degrade gracefully to the House KB defaults):

- **Axiom iOS** skills + auditor agents — the iOS team's primary toolkit and review gate.
- **ui-design** (`mobile-android-design`, `mobile-ios-design`, …) and **ui-ux-pro-max**.
- **aso-screenshots** and **admob-android-integration**.

## File layout the team creates in your project

```
CLAUDE.md                    project conventions (seeded from the House KB)
docs/
  00-vision · 01-intake · 10-prd · 11-backlog
  12-flows · 13-design-tokens · 14-components · 15-aso
  20-architecture · 21-engineering-principles · 22-impl-spec-{ios,android,backend}
  23-git-strategy · 40-api · 41-monetization
  50-test-plan · 51-bugs · 52-analytics
  60-releases · 70-security-review
  daily/standup-YYYY-MM-DD.md
ios/   android/   backend/   (per scope)
```

## Tuning

- **Pod size** defaults to 3 engineers; the tech-manager scales it at sprint planning.
- **Roles are files** in `agents/` — edit, add (e.g. `ml-engineer`), or remove.
- **Stack defaults** live in `knowledge/stack-defaults.md` — change them once, every project follows.
- **Autonomy** — `/app-run --yolo` to skip scope-lock; `/loop /app-run …` for fully self-paced runs.

## Philosophy

It is not a robot you turn on and walk away from. It is a structured team that drafts most of the
work, holds itself to your conventions, reviews and fixes its own code, and shows you the seams at
the two moments that actually need a human: **what we're building**, and **whether to ship it**.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Everything here is Markdown — no build step.

## License

[MIT](./LICENSE) © Mobify Studio
