# ASO & Store Readiness

How Mobify Studio prepares store listings and ships. Pair with the `aso-screenshots` skill
(screenshot generation) and `axiom-app-store-submission` / `axiom-shipping` (iOS submission).

## Screenshots — automate the capture

The studio captures screenshots from a seeded build, not by hand:

- **Android:** a `capture_screenshots.sh` script builds the dev/debug flavor, launches a
  `ScreenshotSeedActivity` that seeds demo data (e.g. child "Emma"), drives N screens via deep
  links, and `adb screencap`s each. Onboarding screens captured manually. Raw PNGs land in
  `playstore_screenshots/raw/` or `screenshots/android-dev/`.
- **iOS:** capture from the simulator across the required device sizes; raw frames in
  `screenshots/raw/`. (Use the simulator-tester / screenshot-validator Axiom agents to verify.)
- `marketing-assets/` holds the app icon + stock photos used to compose the final framed,
  localized store images. The `aso-specialist` produces the final composites with `aso-screenshots`.

## Listing copy & keywords

- Positioning leads with credibility hooks the studio actually uses (e.g. WHO/CDC standards,
  point counts, AI features, language count, accessibility compliance).
- Keep iOS description ≤ 4000 chars; Android "What's New" ≤ 500 chars.
- Keyword research is owned by the `aso-specialist`; record the chosen keyword set in
  `docs/15-aso.md` per project. (No app in the corpus checked in a keyword file — close that gap.)

## Play Data Safety / iOS Privacy — tie answers to code

- The studio maintains a `PLAY_DATA_SAFETY.md` that maps **every** Data Safety answer to the
  exact code site that collects/shares it (location, optionality via settings toggle, etc.).
  Reproduce this per project — it's the artifact that survives a Play review.
- iOS: a Privacy Manifest (`PrivacyInfo.xcprivacy`) declaring Required-Reason APIs and tracking
  domains; consent defaults off.

## Store-readiness checklist (gate before `/app-ship`)

- [ ] App icon finalized (all required sizes/densities).
- [ ] Screenshots captured for every required device size, validated (no placeholder/debug text).
- [ ] Listing title/subtitle/description + keyword set written into `docs/15-aso.md`.
- [ ] "What's New" / release notes drafted (within length limits).
- [ ] Play Data Safety form mapped to code; iOS Privacy Manifest present.
- [ ] Privacy policy + terms URLs live (studio uses `vmobify.in/privacy-policy`, `/terms-conditions`).
- [ ] Age rating / content rating questionnaire answered.
- [ ] Real ad unit IDs and signing configured for the prod build (see `monetization.md`).
- [ ] Support email and account names recorded in the architecture release section.

## Reference artifacts in the corpus

`Docs/APP_STORE_READINESS_PLAN.md` (AI Baby iOS), `Project Docs/16_RELEASE_CHECKLIST.md` +
`09_COMPETITIVE_ANALYSIS.md` + `docs/PLAY_DATA_SAFETY.md` (GPS Map Camera),
`docs/RELEASE_CHECKLIST.md` + `PLAY_DATA_SAFETY_ALIGNMENT.md` (LifeOS).
