---
name: brownfield-onboarding
description: Use when pointing the team at an EXISTING, already-built app instead of a blank project — detects the stack, reverse-engineers the as-built architecture, and classifies remediation work as safe-to-auto-fix vs risky-needs-approval. Triggered by /app-onboard, /app-audit, and by /app-run when it detects a non-empty app directory.
---

# Brownfield onboarding

Greenfield commands generate vision → PRD → architecture → code. For an app that already exists,
you go the other way: **read the code, snapshot what's there, grade it against the House KB, and
plan the gap.** This skill is the procedure for the "read and understand" half.

## When to use

- `/app-onboard` (adopt an existing codebase) and `/app-audit` (grade it) both start here.
- `/app-run` invokes this when the target directory already contains an app (see Detection).

## Step 1 — Detect the app

Scan the target directory (not deeper than ~3 levels) to establish ground truth before any agent reasons about it:

- **iOS:** `*.xcodeproj` / `*.xcworkspace` / `Package.swift`; read `project.yml` (XcodeGen),
  `*.xcconfig`, `Info.plist`, `Package.resolved`. Note Swift version, min iOS target, SwiftUI vs UIKit.
- **Android:** `settings.gradle*`, `app/build.gradle(.kts)`, `gradle/libs.versions.toml`. Note Kotlin/AGP,
  `compileSdk`/`minSdk`/`targetSdk`, Compose vs XML, the module list.
- **Both / signals:** existing `CLAUDE.md`, `README`, `docs/`, CI under `.github/workflows`,
  `google-services.json`/`GoogleService-Info.plist` presence (Firebase), ads/billing SDKs in deps.
- Record the raw findings; do not guess where you can read.

## Step 2 — Reverse-engineer the as-built baseline

Produce the docs the team normally writes, but describing **what exists**, not what's wished for:

- `docs/20-architecture.md` — the *actual* stack, module/folder layout, state/persistence/DI/nav
  patterns in use, backend, CI, signing. Mark anything inferred as `(inferred)`.
- A feature inventory in `docs/10-prd.md` — the screens/features that exist, derived from the code
  (navigation graph, view/screen files). Ask the user only for product intent you cannot read.
- `CLAUDE.md` at the project root if missing — seeded from the as-built architecture + the House KB,
  pinning the real stack, build/run commands, and canonical type/property names found in the code.

Do not refactor anything in this step. You are taking a photograph, not renovating.

## Step 3 — Classify every remediation as Safe or Risky

When `/app-audit` turns findings into work, tag each one so safe fixes can be automated and risky
changes are gated behind a plan + human approval:

**Safe (auto-fix, normal code-review gate):**
- Accessibility labels / Dynamic Type / touch-target fixes
- Hardcoded color/spacing/font → design-token swaps
- String localization (`String(localized:)` / `strings.xml`)
- Missing analytics events; wrapping calls in the existing consent gate
- Lint/detekt/ktlint/SwiftLint fixes, dead-code removal, `print`/`Log.d` → logger
- Mechanical correctness: missing `transaction.finish()`, missing `@Index`, missing `@ForeignKey` index

**Risky (write a ticket + a short plan, require approval before touching code):**
- Any database/schema **migration** or change to persisted user data
- Architecture **refactors** — layering, module boundaries, Display-DTO introduction
- **Concurrency** model changes — removing Combine/`@Published`, actor isolation rewrites
- Navigation restructure, DI overhaul
- Billing/entitlement logic changes, ad-gating/consent-flow rework
- Anything that changes app behavior a user would notice

Default posture: **fix Safe automatically; for Risky, propose and wait.** Never silently perform a
risky change during an audit.

## Step 4 — Hand off

Onboarding hands to `/app-audit`. Audit writes `docs/80-audit.md` and a remediation backlog of
`AUDIT-NNN` tickets (each carrying its severity, the violated House KB rule, and Safe/Risky tag),
then the normal build loop closes them.

## Anti-patterns

- Reasoning about the app from its README alone — read the build files and code; READMEs drift.
- Rewriting code during onboarding/audit "while you're in there" — separate seeing from changing.
- Treating a risky refactor as safe because it's small — risk is about blast radius, not diff size.
