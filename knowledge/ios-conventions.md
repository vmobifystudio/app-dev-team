# iOS Conventions

Mined from AI Baby Growth Tracker and GPS Camera iOS. These are house law for new iOS apps.
Pair with the Axiom iOS skills (`axiom-ios-ui`, `axiom-ios-concurrency`, `axiom-ios-data`,
`axiom-swiftui-26-ref`, etc.) for the up-to-date API details.

## Layering (non-negotiable)

`View → ViewModel → Service → Repository → Persistence`

- Views never touch repositories, `ModelContext`, the DB queue, or `@Model`/GRDB records.
- ViewModels call **Services only** — never repositories directly.
- Only repositories touch persistence (`ModelContext` / GRDB `DatabaseQueue`).
- `Core/` never imports `Features/`. Domain layer is pure Swift (no SwiftUI/UIKit/DB).

## Display DTO pattern

Persistence types never cross into Views. Convert in the ViewModel:
`@Model` / GRDB record / `PHAsset` → `XxxDisplayItem` (`Identifiable, Sendable, Equatable`,
built via `init(from:)`). This keeps Swift 6 isolation clean and the UI decoupled.

## Concurrency (Swift 6 `complete`)

- `@Observable` + `@MainActor` on **ViewModels only** (never Services or Models).
- Services are `final class` or `actor`.
- **Forbidden:** Combine, `@Published`, `ObservableObject`, Combine publishers/cancellables.
  Reactive flows use `async/await` + `AsyncStream` (e.g. GRDB `ValueObservation+AsyncStream`).
- Double-tap guard: set `isProcessing = true` **synchronously** before launching the `Task`.
- Snapshot `@MainActor` state before a background render/save; don't re-read on a background thread.
- Store long-lived `Task` handles and cancel them; break `AsyncStream` retain cycles with weak rebind.
- `@unchecked Sendable` → inline justification every time. `nonisolated(unsafe)` only for
  write-once-in-init constants (formatters are not thread-safe).

## DI

A `@MainActor @Observable` composition root (`AppContainer` / `AppDIContainer`) owns the
`ModelContainer`/DB, app state, router, and session-lifetime services. Every ViewModel has a
`make<Name>ViewModel()` factory. Services are protocol-based; each has a `Mock<Name>Service`
in its own file. Provide an `AppContainer.preview` for SwiftUI previews.

## Navigation

- `TabView` with one `NavigationPath`/`NavigationStack` per tab — **never nest NavigationStacks**.
- Sheets = quick tasks; push = drill-down; `fullScreenCover` = immersive only.
- Deep links via a `DeepLinkHandler` that validates resource ownership and rejects invalid/
  unknown URLs (and while the app is locked). Use a custom scheme per app.

## Persistence

- Local-first. Repositories are the only DB touchpoint.
- Migrations registered in order from day 1; **never** destructive/erasing migrations; a
  migration-fixture test is required before any schema change.
- Date lookups via a normalized `"yyyy-MM-dd"` string (timezone-safe).
- Validate inputs before writes. Delete order for media: asset first, then DB row (no orphans).
- Sensitive fields: CryptoKit AES-GCM; secrets in Keychain. Never store entitlements as
  plaintext UserDefaults source of truth.

## UI & design tokens

- **Never** hardcode colors (`.white`/hex/`Color(red:)`), spacing, or `.font(.system(size:))`
  for text. Use the design-token types (`<App>Colors`, `DesignTokens.Spacing`, `<App>Typography`).
- `.strokeBorder` (not `.stroke`) on cards. Clinical/chart surfaces are solid, never glass.
- The accent color is for celebration/premium only — never to signal danger.

## Accessibility (App Store floor)

- `accessibilityLabel` on every interactive element; `accessibilityHidden(true)` on decorative icons.
- Gate animations on `accessibilityReduceMotion`. Touch targets ≥ 44pt.
- Never convey information by color alone. `.monospacedDigit()` on numerics.
- Every chart offers a "Show Data Table" alternative.

## Localization

`String(localized:)` for every user-facing string, including previews and accessibility labels.
**Never** interpolate inside `String(localized:)` — use `%@` format args. String Catalog for
all target languages. Non-display number/date/coordinate formatting uses `en_US_POSIX` /
central `LocaleFormatters`; never `String(format:"%.2f", …)` or `Double(userInput)` for display.

## Logging & errors

- OSLog only (`Logger.<category>`), fixed subsystem per app. **No `print`/`NSLog`.**
- No `try?` to silence errors; no empty `catch {}`. No force-unwraps in production
  (`fatalError` only in container init / tests). Never expose raw errors to users.

## File hygiene

- View / ViewModel / Service ≤ 300 lines (SwiftLint `file_length` warn 300 / error 500).
- One primary type per file; filename == type name. Split via `Type+Feature.swift` extensions.

## Testing

- Swift Testing (`@Suite`/`@Test`/`#expect`), per-module test targets.
- Pure-Swift domain engine package tested independently (`swift test --package-path <Engine>`),
  95%+ coverage. Migration-fixture tests for schema changes. Green build + green tests are a
  hard merge gate.

## Canonical-reference discipline

Pin exact model property names and type disambiguations in the project's `CLAUDE.md` (e.g.
"`weight` NOT `weightKg`") so agents never invent names. Append every hard-won learning back
into `CLAUDE.md`. Keep `project.yml` and the generated project in sync — edit project config
programmatically, never by hand.
