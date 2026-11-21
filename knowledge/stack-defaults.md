# Stack Defaults

Defaults for a new Mobify Studio app, taken from production. Deviate only with a written reason.

## v1 structure — start small, split on a trigger

A new app starts as **one app module plus a pure domain package** (the engine), a folder per
feature. Service/Repository only over real IO; no pass-through layers. Split on a trigger, named
in an ADR: a second target needs the code → extract it; more than five features, or one module
conflicting two waves running → `feature/*` modules. The multi-module layouts are the **target**,
not day 1; never flag a v1 app for lacking them.

## iOS (flagship default)

| Concern | Default | Notes |
|---|---|---|
| Language | Swift 6.0, strict concurrency `complete` | Every `@unchecked Sendable` needs an inline justification |
| UI | SwiftUI only | UIKit only via a wrapper for a specific gap (e.g. haptics) |
| Min target | Flagship: **the immediately preceding released major**. Utility: the oldest major the app's APIs and ad SDKs still support | Relative, never pinned. **Not arithmetic** (iOS 18 went straight to 26). **Resolve it; never recall it** — below |
| Project gen | **XcodeGen** (`project.yml` is source of truth) | `.xcodeproj` is git-ignored, never hand-edited |
| Architecture | MVVM + Service + Repository (target; §v1 structure) | `View → ViewModel → Service → Repository → Persistence` |
| State | `@Observable` + `@MainActor` on ViewModels only | **No Combine / @Published / ObservableObject** |
| Persistence | SwiftData (content apps) or GRDB+SQLite/FTS5 (camera/media) | Local-first; migrations from day 1; never destructive |
| DI | Hand-rolled composition root (`AppContainer`/`AppDIContainer`) | `make<Name>ViewModel()` factory per VM; protocol+impl+mock parity |
| Networking | URLSession per-service client behind a protocol | Firebase for backend; no heavy HTTP framework |
| Testing | **Swift Testing** for unit/domain tests; **XCUITest** for UI automation (`runtime-gate` runs it) | **90%+ line coverage of the domain engine package only** — `ios-conventions.md` §Testing |
| Dependencies | Minimal — Apple-native + Firebase + SwiftLint | No RevenueCat; add a dep only with a written reason |
| Monetization | StoreKit 2 native | See `monetization.md` |

### Resolving the iOS min target

Never answer it from recollection. Resolve it against an `axiom-*` skill
(`axiom:axiom-apple-docs`, `axiom:axiom-ios-build`; **external and optional**) or Apple's published
list of released iOS majors. Record in `docs/20-architecture.md`, on one line: **the number, the
source, the then-current release, and the date** — a number with no source is remembered, not
resolved. It is a constant, so route it to `verification-engineer`. No source reachable → record
`MIN TARGET: UNRESOLVED` and raise it: a blocker beats a confidently wrong number.

## Android (flagship default)

| Concern | Default | Notes |
|---|---|---|
| Language | Kotlin 2.3.x, JDK 17, **KSP** (never KAPT) | |
| Build | AGP 9.x; convention plugins in `build-logic/` once there is more than one module | |
| SDK | compileSdk/targetSdk 36, minSdk 24–26 | |
| UI | 100% Jetpack Compose + Material 3 (Compose BOM) | No XML UI |
| Architecture | Clean Architecture; v1 = `app` + pure-Kotlin engine (§v1 structure) | Target: `app`, `core/{designsystem,common,data,domain}`, engine, `feature/*`, `service/*` |
| State | MVVM + MVI-flavored `StateFlow<UiState>` | `collectAsStateWithLifecycle()`; one-shot events via `SharedFlow<Unit>` |
| Persistence | Room (KSP) + DataStore | **Never SharedPreferences**; `@ForeignKey CASCADE` + `@Index`; never `fallbackToDestructiveMigration()` |
| DI | Hilt (`@HiltViewModel`, `@Binds`, `@HiltWorker`) | |
| Navigation | Navigation 3 (`@Serializable` routes) | `PredictiveBackHandler`, not `BackHandler` |
| Networking | Retrofit 3 + OkHttp 5 + kotlinx.serialization | Or Firebase-only for content apps |
| Images | Coil 3 (`coil3`) | **Never** coil v2 (`io.coil-kt`) |
| Firebase | Firebase BOM, **no `-ktx`** modules | |
| Testing | JUnit + Turbine + MockK + Paparazzi (screenshot) | Pure-Kotlin engine module tested independently |
| Monetization | Play Billing 8.3.0; AdMob + mediation for ad apps | See `monetization.md` |
| Versioning | `version.properties`, `versionCode = MAJOR*10000 + MINOR*100 + PATCH` | |

## Android (utility tier)

**New utility apps:** the flagship table, one module, **Koin**, ad-first (AdMob + Meta mediation,
UMP). Still Compose and DataStore. Publisher ID `ca-app-pub-5607708682456367`; `keystore.properties`
gitignored. **Existing utility apps (brownfield reference only):** ViewBinding, Activity-based or
MVVM+Koin, AGP 8.11.x, minSdk 23, `BaseActivity`, `DialogUtils`, `TinyDB` — match it when editing
those apps, never copy it into a new one.

## Cross-platform invariants

- **Local-first**, offline-capable; sync is additive.
- A **pure domain engine** (Swift package / Kotlin module) with no platform deps, heavily tested.
- **Consent-gated** analytics & ads, defaults OFF/false (see `analytics.md`, `monetization.md`).
- **No secrets in the repo** — keystores, `google-services.json`, API keys via env/local files.
- **Design tokens only** — no hardcoded colors, spacing, or font sizes.
- **Localized from day one** — `String(localized:)` / `strings.xml`, no interpolation in keys.
