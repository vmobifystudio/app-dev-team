# Android Conventions

Mined from AI Baby Growth Android, GPS Map Camera, and LifeOS (flagship tier), with utility-tier
notes from ZipMaker and Photo Recovery. Pair with `ui-design:mobile-android-design` (Material 3 /
Compose) for current UI API details.

## Architecture (flagship)

Modular Clean Architecture + MVVM with unidirectional state:
`UI (Compose) → ViewModel → UseCase/Domain interfaces → Repository (Data) → Room/Network/DataStore`

Modules:
- `app` — single Activity, Hilt root, NavHost, **no business logic**.
- `core/{designsystem, common, data, domain}` — `core/domain` is pure Kotlin, **zero Android deps**.
- A pure-Kotlin **engine** module (scoring/report/streak math), tested independently.
- `feature/*` — import only `core/{domain, ui/designsystem, common}`; **never** another feature,
  **never** `core/data`/`core/database`. Cross-feature data flows via a domain interface +
  Hilt `@Binds` (e.g. `AdFreeStatusProvider`).
- `service/{firebase, billing, notification, sync, analytics, ai}` behind interfaces.

Convention plugins in `build-logic/` keep module config DRY (`<studio>.android.application/compose/hilt`).
File-size guidance: warn > 600 LOC, hard > 800 LOC (refactor in its own PR).

## State management — the five mandatory ViewModel patterns

1. **Double-tap guard** — set `isProcessing = true` *before* `viewModelScope.launch`.
2. **Snapshot before IO** — read `_uiState.value` on Main, then dispatch; never re-read inside IO.
3. **Cancel previous Job** before relaunching a collector.
4. **Pair related flows** in one `flatMapLatest` chain (avoid stale `_uiState.value`).
5. **One-shot events** via `SharedFlow<Unit>` + `LaunchedEffect` — never assign callbacks during composition.

Screens are stateless composables receiving state + event lambdas. Collect with
`collectAsStateWithLifecycle()`. Use `SavedStateHandle` for process-death recovery. Always
re-throw `CancellationException`; guard `suspendCancellableCoroutine` with `isActive`; file I/O
on `Dispatchers.IO`; `Mutex` for shared singleton state; never expose `e.message` to users.

## Persistence

- Room (KSP) is the single local source of truth. Flow-based DAOs. Entities `*Entity`
  (lowercase plural tables; `id: String` UUID PK; `Long` epoch-millis timestamps; enums as String).
- Every FK column: `@ForeignKey(onDelete = CASCADE)` + `@Index`.
- **Never** `fallbackToDestructiveMigration()` — write a migration per schema change.
- DataStore Preferences for settings — **never SharedPreferences**; exactly one DataStore
  instance per file via the top-level delegate; never `runBlocking` a read.
- Offline-first: Room + Firestore sync with a per-entity `syncStatus`
  (`local/synced/pendingUpload/pendingDelete/conflict`).

## DI

Hilt + KSP (KAPT banned). `@HiltViewModel` + `@Inject`, `@Module @InstallIn`, `@Binds @Singleton`
for interface→impl. `@HiltWorker` + `@AssistedInject` for WorkManager. `HiltTestRunner` for
instrumented tests.

## Navigation

Navigation 3 with `@Serializable sealed interface AppRoute`; args via `SavedStateHandle`.
Per-tab back stacks. Modal sheets managed outside the nav graph via an `AppSheet` sealed type.
`PredictiveBackHandler` (not `BackHandler`). Glance widgets use URI-based click actions
(`<scheme>://…`), never `ACTION_MAIN`. Validate deep-link params; reject unknown hosts/invalid IDs.

## UI & design tokens

- **Never** hardcode colors — pull from `<App>Theme.colors.*`.
- No business logic in composables. Never mutate `mutableStateOf` inside a `LazyColumn` lambda.
- Guard `enableEdgeToEdge()` by API where needed; use `Context.findActivity()` (never unsafe cast).
- Material 3 + `material-icons-extended`.

## Localization & formatting

- All user strings in `strings.xml`. Convert SI units (kg/cm) only for display.
- `Locale.US` for **all non-display** `String.format()`. Per-app in-app locale switcher pattern
  exists in utility apps; keep all locales in the base bundle if you ship one.

## Logging & errors

- Timber/abstracted logger, not raw `Log.d` noise in shipped code. No `!!` non-null asserts.
- Never expose `e.message` to users. `enableSplit=false` for locales if using an in-app switcher.

## Testing

JUnit + Turbine (Flow) + MockK + `kotlinx-coroutines-test`; Paparazzi/golden screenshot tests;
shared `:testing` module for mocks/fixtures. Pure-Kotlin engine module tested to high coverage.
Coverage via Kover/JaCoCo (report-only on AGP 9 lib modules is a known limitation — enforce the
threshold in `core/domain`). Standard gate: `./gradlew test` / `testDebugUnitTest`. Lint with a
baseline, `abortOnError = true`; detekt + ktlint.

## Build flavors & secrets

- Flavors `dev`/`staging`/`prod` × `debug`/`release`. Ad unit IDs and API keys via flavored
  `BuildConfig`/`resValue` (Google test IDs in dev, real in prod).
- **Prod-release Gradle task throws** if required secrets (`ADMOB_APP_ID`, `MAPS_API_KEY`,
  signing vars) are missing — prevents shipping a test-ad build.
- Signing from env or a gitignored `keystore.properties`; fall through to unsigned so CI compiles.
- **Never** commit `google-services.json`, keystores, or API keys.

## Utility-tier deltas (ZipMaker / Photo Recovery)

Activity-based or MVVM+Koin, ViewBinding (no Compose), AGP 8.11.x, minSdk 23. Shared `ads/`
module (`AdUnits.kt`, `AppOpenAdManager`, `InterstitialPool`, native loaders, `AdsSuppression`),
`BaseActivity` + `DialogUtils` + `Extension` + `TinyDB`, coroutine `Executer` for background work,
in-app locale switcher. Always bump `versionCode`/`versionName` before a release build.
