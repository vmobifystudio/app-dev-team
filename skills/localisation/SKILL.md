---
name: localisation
description: Use when the product ships in more than one locale, or when a string, date, number, currency or layout could differ by region — by ux-architect when the locale set changes navigation, by privacy-reviewer when region determines obligation, and by any IC writing a user-visible string. Triggers on the first string, not on the first translation.
---

# Localisation

Localisation is an architecture decision taken at the first string, and a translation task only at
the end. Teams that reverse the order pay for it twice.

Where a platform skill exists, use it: `axiom-localization` on Apple platforms. **External and
optional** — missing → follow this file, never file its absence as a defect.

## Do this from the first ticket, in every locale count including one

- **Every user-visible string is a key in the catalogue.** No string literal in a view, ever. This
  is cheap now and a full re-read of the codebase later.
- **Never concatenate a sentence from fragments.** Word order differs by language. Use one
  parameterised string per sentence.
- **Plurals use the platform's plural rules**, not `if count == 1`. Several languages have more than
  two plural forms and `1 items` is the cheapest possible way to look unfinished.
- **Dates, times, numbers, currencies and units go through the locale-aware formatter.** A
  hand-formatted date is wrong in most of the world, silently.
- **Never sort or compare user-facing text with byte comparison.** Use the locale-aware collator.

## Layout

- **Assume text grows 30–40%** from English. A button that fits exactly is a button that clips.
- **RTL is a layout mode, not a translation.** Use leading/trailing, never left/right; mirror
  directional icons (back, next, progress) and never mirror ones with real-world orientation
  (a clock, a logo, a play button).
- Test at the longest supported locale and the largest Dynamic Type together — that combination is
  where clipping actually happens.

## Region is not language

Region determines: currency and price tier, legal and privacy obligation (`privacy-reviewer`),
store metadata and rating, available payment methods, and sometimes whether a feature may ship at
all. **A locale added to the catalogue is a market entered.** Say so explicitly rather than letting
a translation file imply it.

## Output

The locale set and its consequences are stated in `docs/12-flows.md` (navigation and layout impact)
and in `docs/15-aso.md` (store metadata per locale). Pseudo-localise before you have translations —
it finds hardcoded strings and clipping without waiting for a translator.
