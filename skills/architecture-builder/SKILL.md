---
name: architecture-builder
description: Use to produce the technical architecture doc and engineering principles for a mobile app. Used primarily by the CTO agent. Triggers on "design the architecture", "pick the stack", or as part of /app-plan.
---

# Architecture builder

Produce `docs/20-architecture.md` and `docs/21-engineering-principles.md` from `docs/00-vision.md` + `docs/10-prd.md`.

## docs/20-architecture.md sections

1. **Platform decision** — iOS / Android / both, with order if sequential.
2. **iOS stack** —
   - Swift version (latest stable)
   - Minimum iOS target (set based on the PRD's user, not vanity)
   - UI: SwiftUI by default; UIKit only if PRD demands something SwiftUI struggles with
   - State: ObservableObject + @State, or a documented store pattern
   - Networking: URLSession + async/await, or a named lib
   - Persistence: SwiftData / Core Data / GRDB — pick by PRD complexity
   - DI: lightweight — protocol + initializer injection
   - Testing: XCTest, snapshot lib named, UI test framework named
3. **Android stack** —
   - Kotlin version
   - minSdk / targetSdk (set based on PRD users)
   - UI: Jetpack Compose
   - Architecture: MVVM or MVI, picked once
   - Networking: Retrofit + OkHttp + Kotlinx Serialization (or named alternative)
   - Persistence: Room (or named alternative)
   - DI: Hilt or Koin
   - Async: Coroutines + Flow
   - Testing: JUnit, Turbine, Compose UI test
4. **Shared concerns** — auth, analytics, crash reporting, feature flags, remote config, push.
5. **Backend interface** — sketch the APIs the apps need. If backend is in scope, name the service shape.
6. **Repository layout** —

   ```
   /
   ├── ios/                # Xcode project / SwiftPM workspace
   ├── android/            # Gradle multi-module
   ├── backend/            # if in scope
   ├── docs/               # all team docs
   └── specs/              # ticket-level specs if any
   ```

7. **CI / release** — branch model, build pipeline, signing, distribution channel (TestFlight, Play internal track).
8. **Non-functional budgets** — cold start, memory, payload size, accessibility floor (WCAG 2.1 AA).
9. **Risks** — top 3 with mitigations.

## docs/21-engineering-principles.md

A short rulebook. Examples to include or adapt:
- Every PR ships with tests
- No force-unwraps (iOS) / no `!!` (Android)
- Every screen has accessibility labels and a snapshot test
- No new third-party dep over 200KB without written exception
- Strings are localized from day one
- Logs go through the named logger; no `print` / `Log.d` in shipped code
- Public API for a module is documented in a `README.md` at the module root

## Quality bar

Every decision in §2 and §3 has one paragraph of "why" tied to the PRD. If you can't write the "why", reconsider the choice.
