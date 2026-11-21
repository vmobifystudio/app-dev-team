---
name: architecture-builder
description: On an app-dev-team project, use to produce docs/20-architecture.md and docs/21-engineering-principles.md during /app-init. The single source of the architecture's section list. Used by cto, and by tech-lead on utility tier.
---

# Architecture builder

Produce `docs/20-architecture.md` and `docs/21-engineering-principles.md` from `docs/00-vision.md` +
`docs/10-prd.md`. **This is the only copy of the section list** — `cto.md` and `tech-lead.md` point
here. Other roles cite sections by number (§4, §7, §8), so keep the numbers.

## docs/20-architecture.md sections

Write the stack sections the roster's **product type** actually has. The list is a floor for
mobile, not a template to fill in with N/A.

1. **Platform decision** — iOS, Android, both, web, service. State the order if parallel isn't
   possible. Justify in one paragraph.
2. **Client stack** — one subsection per client platform, one line per item, then one "why"
   paragraph tied to the PRD:
   - **iOS** — Swift version (latest stable); minimum iOS target resolved to a **concrete number**
     per `stack-defaults.md` §Resolving the iOS min target; UI: SwiftUI (UIKit only for
     a gap the PRD forces); state: `@Observable` + `@MainActor` on ViewModels only (no Combine /
     `@Published` / `ObservableObject`); networking: URLSession + async/await; persistence:
     SwiftData (content) or GRDB+SQLite/FTS5 (camera/media); DI: protocol + initializer injection;
     testing: **Swift Testing** for unit/domain, **XCUITest** for UI automation (`runtime-gate` runs
     it), the snapshot lib, and the domain package's coverage floor.
   - **Android** — Kotlin version; minSdk/targetSdk from the PRD's users; UI: Jetpack Compose;
     MVVM or MVI, picked once; Retrofit + OkHttp + kotlinx.serialization; Room + DataStore; DI: Hilt
     (flagship) or Koin (utility); Coroutines + Flow; JUnit, Turbine, MockK, Paparazzi.
   - **Web** — framework and rendering model, hosting target, Node version, browser support
     matrix, security-header and cookie posture (`web-conventions.md` is the default).
3. **Service or library stack** — a `backend-service`: runtime, datastore, hosting; a `library`:
   target platforms and the public API surface. `none` when the product has neither.
4. **Shared concerns** — auth, analytics, crash reporting, feature flags, remote config, push —
   and the **kill switch / forced update** decision: how a shipped build can be disabled or forced
   to upgrade (remote-config flag, minimum-version check, or a written "none, because …").
   **Push**, when in scope: provider (APNs / FCM / a vendor), where device tokens are stored and
   expired, the permission prompt's moment (after the user sees the value, never at first launch),
   and the notification categories; the APNs key and FCM project are founder setup rows.
5. **Backend interface** — the APIs the apps need. Backend in scope → sketch the service shape;
   not → list the external services integrated against.
6. **Repository layout** — top-level folders (`/ios`, `/android`, `/web`, `/backend`, `/docs`)
   and, inside each app, the v1 structure from `stack-defaults.md` §v1 structure: one
   app module plus a pure domain package, folders per feature. Name the split triggers; do not
   pre-build the target module layout.
7. **CI / release** — branch model, build pipeline, signing, distribution channel, and the **store
   platform requirements** this release must meet (Play's minimum `targetSdk`, App Store's minimum
   Xcode/SDK), each with the date last checked. `release-manager` blocks on a stale one.
8. **Non-functional budgets** — cold start, memory, payload size, accessibility floor (WCAG 2.1
   AA); Core Web Vitals for web.
9. **Risks** — top 3 technical risks, each with its mitigation.

Before handing off, run `node "${CLAUDE_PLUGIN_ROOT}/scripts/requirements-conflict-scan.mjs" .` —
exit `1` is a number in the architecture contradicting the PRD; resolve it with the PRD's owner.

## docs/21-engineering-principles.md

A short, opinionated rulebook the pod is held to. Examples to include or adapt:
- Every PR ships tests for the layers its diff changes
- No force-unwraps (iOS) / no `!!` (Android)
- Every screen has accessibility labels; snapshot tests for the screens the impl spec names
- No new third-party dep over 200KB without a written exception
- Strings are localized from day one
- Logs go through the named logger; no `print` / `Log.d` in shipped code

## Quality bar

Every decision in §2 and §3 has one paragraph of "why" tied to the PRD. If you can't write the
"why", reconsider the choice.
