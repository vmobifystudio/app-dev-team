# Stack Defaults

Default technology choices for a new Mobify Studio app. The CTO/architecture step may deviate
with a written reason, but these are the starting point — they reflect what's in production today.

## iOS (flagship default)

| Concern | Default | Notes |
|---|---|---|
| Language | Swift 6.0, strict concurrency `complete` | Every `@unchecked Sendable` needs an inline justification |
| UI | SwiftUI only | UIKit only via a wrapper for a specific gap (e.g. haptics) |
| Min target | iOS 18.0 (utility) / latest-1 for flagship | e.g. utility apps = 18.0; flagship = 26.0 |
| Project gen | **XcodeGen** (`project.yml` is source of truth) | `.xcodeproj` is git-ignored, never hand-edited |
| Architecture | MVVM + Service + Repository | `View → ViewModel → Service → Repository → Persistence` |
| State | `@Observable` + `@MainActor` on ViewModels only | **No Combine / @Published / ObservableObject** |
| Persistence | SwiftData (content apps) or GRDB+SQLite/FTS5 (camera/media) | Local-first; migrations from day 1; never destructive |
| DI | Hand-rolled composition root (`AppContainer`/`AppDIContainer`) | `make<Name>ViewModel()` factory per VM; protocol+impl+mock parity |
| Networking | URLSession per-service client behind a protocol | Firebase for backend; no heavy HTTP framework |
| Testing | **Swift Testing** (`@Test`/`@Suite`), not XCTest | Pure-Swift domain engine package, 90%+ coverage |
| Dependencies | Minimal — Apple-native + Firebase + SwiftLint | No RevenueCat; add a dep only with a written reason |
| Monetization | StoreKit 2 native | See `monetization.md` |

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
