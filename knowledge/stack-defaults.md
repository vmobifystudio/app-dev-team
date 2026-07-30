# Stack Defaults

Default technology choices for a new Mobify Studio app. The CTO/architecture step may deviate
with a written reason, but these are the starting point — they reflect what's in production today.

## iOS (flagship default)

| Concern | Default | Notes |
|---|---|---|
| Language | Swift 6.0, strict concurrency `complete` | Every `@unchecked Sendable` needs an inline justification |
| UI | SwiftUI only | UIKit only via a wrapper for a specific gap (e.g. haptics) |
| Min target | Flagship: **the immediately preceding released major**. Utility: the oldest major the app's APIs and ad SDKs still support | Relative, never pinned here. **Not arithmetic** — Apple went from iOS 18 straight to iOS 26, so "latest minus one" yields a version that never shipped. **Resolve it; never recall it** — see below |
| Project gen | **XcodeGen** (`project.yml` is source of truth) | `.xcodeproj` is git-ignored, never hand-edited |
| Architecture | MVVM + Service + Repository | `View → ViewModel → Service → Repository → Persistence` |
| State | `@Observable` + `@MainActor` on ViewModels only | **No Combine / @Published / ObservableObject** |
| Persistence | SwiftData (content apps) or GRDB+SQLite/FTS5 (camera/media) | Local-first; migrations from day 1; never destructive |
| DI | Hand-rolled composition root (`AppContainer`/`AppDIContainer`) | `make<Name>ViewModel()` factory per VM; protocol+impl+mock parity |
| Networking | URLSession per-service client behind a protocol | Firebase for backend; no heavy HTTP framework |
| Testing | **Swift Testing** (`@Test`/`@Suite`) for unit and domain tests, not XCTest. **UI automation stays XCUITest** — it is XCTest-based and has no Swift Testing equivalent, and `runtime-gate` runs it | Coverage floor is **90%+ line coverage of the pure-Swift domain engine package only** — not the app target, not UI. See `ios-conventions.md` §Testing |
| Dependencies | Minimal — Apple-native + Firebase + SwiftLint | No RevenueCat; add a dep only with a written reason |
| Monetization | StoreKit 2 native | See `monetization.md` |

### Resolving the iOS min target

The rule above is correct and, resolved from memory, unverifiable — which moves the failure out of
the rule, where a reviewer caught it, into agent knowledge, where nothing does.

So: route the question to whatever iOS reference this install actually has — an `axiom-*` skill
(`axiom-apple-docs`, `axiom-ios-build`) if one is present, otherwise Apple's published list of
released iOS majors. Those are **external and optional** — other plugins; if none is installed, say so
and resolve against Apple's published list directly. Never answer it from recollection.

Record in `docs/20-architecture.md`, on one line: **the number, the source you resolved it against,
the then-current release, and the date**. A number with no source is not resolved, it is remembered.

**This is a constant, and constants are `verification-engineer`'s** — route it like any other, so it
is executed rather than trusted. If you cannot reach a source, record `MIN TARGET: UNRESOLVED` and
raise it. An unresolved number is a blocker; a confidently wrong one ships.

## Android (flagship default)

| Concern | Default | Notes |
|---|---|---|
| Language | Kotlin 2.3.x, JDK 17, **KSP** (never KAPT) | |
| Build | AGP 9.x, convention plugins in `build-logic/` | |
| SDK | compileSdk/targetSdk 36, minSdk 24–26 | |
| UI | 100% Jetpack Compose + Material 3 (Compose BOM) | No XML UI |
| Architecture | Clean Architecture, multi-module | `app`, `core/{designsystem,common,data,domain}`, pure-Kotlin engine, `feature/*`, `service/*` |
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

Leaner: Kotlin (±Java), ViewBinding (no Compose), MVVM+Koin or Activity-based, AGP 8.11.x,
minSdk 23, ad-first monetization (AdMob + Meta mediation, UMP). Shared "Mobify Studio DNA":
`ads/AdUnits.kt`, `BaseActivity`, `DialogUtils`, `Extension`, `TinyDB`, in-app locale switcher,
`keystore.properties` gitignored. Publisher ID `ca-app-pub-5607708682456367`.

## Cross-platform invariants

- **Local-first**, offline-capable; sync is additive.
- A **pure domain engine** (Swift package / Kotlin module) with no platform deps, heavily tested.
- **Consent-gated** analytics & ads, defaults OFF/false (see `analytics.md`, `monetization.md`).
- **No secrets in the repo** — keystores, `google-services.json`, API keys via env/local files.
- **Design tokens only** — no hardcoded colors, spacing, or font sizes.
- **Localized from day one** — `String(localized:)` / `strings.xml`, no interpolation in keys.
