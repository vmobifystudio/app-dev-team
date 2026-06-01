# Monetization

How Mobify Studio monetizes. Two models: **subscription/IAP** (flagship content/AI apps) and
**ads** (utility apps and ad-supported tiers). Pair with `axiom-in-app-purchases` /
`axiom-storekit-ref` (iOS) and `admob-android-integration` (Android).

## Paywall — the two-door gateway (iOS, portable concept)

All paywall presentation routes through a single `PaywallPresentationGateway` with **two doors**:

- `presentDirect(source:)` — user-initiated ("Upgrade" taps). Bypasses session cap and the 24h
  cooldown. Still suppressed if the user is already premium.
- `presentIfEligible(...)` / `present(source:)` — automatic/interruptive triggers. Enforces
  **max 1 per session + a 24h cooldown** persisted via the preferences service.

A `PaywallTriggerService` (`actor`) owns the policy. ~15 typed triggers (e.g. `fifthMeasurement`,
`exportTapped`, `secondChildAdded`, `trialDay25`, `aiCoachOpenedFree`, deep-link variants) each
map to a `PaywallContext` (`.generic` / `.achievement` / `.featureFocused`). The trigger carries
its source for analytics.

## StoreKit 2 (iOS) — entitlement rules

- `StoreManager` (`@MainActor @Observable`) is the single source of truth. Derive entitlement
  from `Transaction.currentEntitlements` (tri-state `PremiumStatus`, cold-start safe).
- Listen to `Transaction.updates` for renewals/refunds/Ask-to-Buy.
- Optimistic grant, then a deterministic re-scan reconcile + a **visible** confirmation.
- Always `transaction.finish()`. Handle `purchasePending` (Ask-to-Buy). Use `transaction.offer?.type`
  (not `offerType`). Disable Restore while a purchase/restore is in flight (a `ReentrancyGuard`).
- Bundle a `.storekit` config for testing. Typical products: Monthly, Annual (best value),
  Lifetime (non-consumable), with a free trial. No RevenueCat — native StoreKit only.

## Play Billing (Android)

- Play Billing 8.3.0 behind a `BillingServiceInterface` with a real `PlayBillingServiceImpl`
  (Mutex-guarded) and a `StubBillingServiceImpl` for debug/screenshot builds.
- `BillingCatalog` holds product IDs (subscriptions + a one-time lifetime/remove-ads INAPP).
  Entitlement state flows to an `EntitlementRepository`. Optimistic grant before acknowledgment.
- Ship Play in-app review + in-app update (flexible + immediate) alongside billing.

## Ads (AdMob) — the AdGate discipline

When an app shows ads:

- A central **`AdGate`** enforces ordering: **ad-free check → consent check** (treat `.unknown`
  consent as "suppress / ad-free"). No ad manager is called directly by feature code.
- **NO-AD zones** (enforced by callers never invoking ad managers): capture, route tracking,
  stamp/crop/rotate customization, onboarding, permission dialogs.
- **Frequency caps** via a `FrequencyCap`/`FrequencyCapManager` (Mutex-guarded). Examples in
  production: interstitial = 3rd-capture / 5-day / 3-min; app-open = session-2+ / 5-min /
  4h-expiry, skipping Splash/Privacy/Language/Intro screens.
- Ad formats used: App Open, Interstitial (preload pool), Banner (adaptive), Native, Rewarded
  (e.g. "Remove ads 1 hour"). `OnPaidEventListener` → Firebase `ad_impression`.
- **Ship Google test ad unit IDs by default.** Real IDs are injected per flavor via
  `BuildConfig`/`resValue` (`AdUnits.kt`) for prod only — never risk invalid traffic before real
  IDs exist. Mediation: AppLovin MAX and/or Meta Audience Network configured in the AdMob console.
- Studio AdMob publisher ID: `ca-app-pub-5607708682456367` (utility apps).
- **The prod-release build must fail fast** if `ADMOB_APP_ID` (and `MAPS_API_KEY` where used) is
  missing.

## Consent (gates everything)

- **UMP (Android) / ATT + UMP (iOS) runs before any ad or analytics init** (with a ~5s watchdog).
- `canRequestAds()` is the single source of truth for whether ads may load.
- All consent flags default **false**; Firebase Consent Mode v2 denies storage by default,
  granted only after the user consents. Offer a "privacy options" / revoke path.

## Checklist for a monetized release

- [ ] Paywall routes only through the gateway; auto-triggers respect cap + cooldown.
- [ ] Restore works and is disabled while in flight.
- [ ] Entitlement derived from the platform source of truth, never plaintext prefs.
- [ ] Ads gated by ad-free → consent; NO-AD zones honored; frequency caps applied.
- [ ] Real ad unit IDs present for prod only; prod build fails without required secrets.
- [ ] Consent collected before any ad/analytics init; defaults false.
