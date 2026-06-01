# Analytics & Telemetry

How Mobify Studio instruments apps. The throughline: **consent-gated, PII-free, interface-bound,
funnel-oriented.**

## The consent gate (mandatory)

- Analytics is wrapped by a consent gate decorator (`AnalyticsGate` / `ConsentGatedAnalytics`)
  that reads **live consent at call time** and drops every event/screen/userId/userProperty call
  when consent is false — and also forces the SDK's `setEnabled(false)`.
- Default is **OFF/false**. (Note: a real conflict exists in the studio's history — one internal
  Android app's `AnalyticsGate` doc says default opt-in `false` while its CLAUDE.md §L says opt-out
  `true`. The house default is **opt-in / OFF**; flag any project that wants otherwise.)
- Crash reporting (Crashlytics) follows the same consent posture.

## Interface + implementations

`AnalyticsServiceInterface` / `AnalyticsServiceProtocol` (Sendable) with:
- a **Stub/Console** impl that logs to OSLog/Logcat (the default, and for debug/screenshot builds),
- a **Mock** for tests,
- a **Firebase** impl used only when the Firebase config file is bundled.

Live in `core/domain/analytics` (Android) so events are a shared contract; Firebase impl in
`core/analytics`.

## Event naming & payloads

- **snake_case** event names. IDs only — **never PII** (no names, DOB, addresses, coordinates).
  Cache keys use entity IDs (e.g. `childId`), never names.
- Type the catalog: an `AnalyticsEvent` enum/constants + typed params, not free strings.
- Representative events across the studio:
  - Onboarding/trial funnel: `onboarding_started`, `onboarding_completed`, `trial_started`,
    `trial_converted`, `subscription_purchased`/`subscription_started`/`subscription_success`,
    `subscription_restored`.
  - Engagement: `measurement_logged`, `chart_viewed`, `ai_insight_opened`, `milestone_achieved`,
    `photo_captured`, `template_selected`, `pdf_generated`, `check_in_completed`, `habit_completed`.
  - Paywall funnel: `paywall_impression`/`paywall_shown`, `plan_compared`,
    `paywall_purchase_success`/`_failed`, `paywall_restore_success`.
  - Privacy: `privacy_analytics_toggled`, `privacy_data_deletion_requested`,
    `data_exported`, `data_deleted`.
  - Ads: `ad_impression` (from `OnPaidEventListener`).

## Funnels, retention, guardrails

Define for each app (use an internal app's `ANALYTICS_METRICS_SPEC.md` as the template):
- The activation funnel (e.g. onboarding → first core action → first value moment → paywall → purchase).
- D1/D3/D7 retention cohorts.
- Data-quality guardrails (missing > 2%/day, duplicate > 1%/session, late-arriving > 10min flagged).

## The data-analyst's job in this plugin

- Ensure every P0 feature has a paired analytics ticket so the named events actually ship.
- Verify the consent gate drops events when consent is off (a test, not a vibe).
- After launch, read the funnel and retention numbers and report KPI movement to the CEO.
- Keep the event catalog free of PII; reject any event that would log it.
