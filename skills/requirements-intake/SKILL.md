---
name: requirements-intake
description: On an app-dev-team project, use at the start of /app-init (and /app-run through it) to turn the founder's one-line idea or rough brief into docs/01-intake.md.
---

# Requirements intake

You are converting fuzzy human intent into a structured intake doc. You are not the CEO yet — you are the funnel.

## When to use

- User starts a project with a one-liner ("Build a habit tracker", "An app for X")
- The CEO agent needs a clean input
- `/app-init` is called

## Procedure

1. Read what the user said. Extract whatever's already there:
   - Product idea
   - Target user (if named)
   - Platform preference (if named)
   - Constraints (timeline, budget, must-haves)

2. **Ask only questions 1–3, only when the brief cannot answer them, in one round** (AskUserQuestion
   if available). **Under `--yolo` (or `/loop`) ask nothing.** Every answer you did not get from the
   founder — 4 and 5 always, 1–3 under `--yolo` — is your best default from the brief, written
   `(ASSUMED)` in the intake; the Gate 1 brief lists them so one yes covers them.

   The five fields, in priority order:
   1. Who is this for? (one specific persona, not a market)
   2. What is the single most important thing they'll do in the app?
   3. What kind of product is this — **iOS app, Android app, both, web app, backend service, CLI
      tool, or a library**? If more than one, which ships first?

      `role-activation` reads this answer to decide which specialists exist at all — record it
      verbatim, so nothing has to guess the product type.
   4. What does success look like in 6 months? (numbers if possible)
   5. Anything that's explicitly out of scope?

2a. **Record the raw material first.** `/app-init` step 0 already recorded the brief — never append
   to it (a recorded file that changes reads as `TAMPERED`). Write your questions and the founder's
   answers verbatim, if you asked any, to a new `docs/00-founder-intent/intake-qa-<date>.md`, then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs" --project-root . --write`.

   The intake below is already an interpretation: it clusters, it phrases, it drops what did not fit
   a heading. That is fine as long as the un-interpreted version still exists to check it against —
   `product-validator` compares the two, and it cannot compare against something nobody kept. The
   directory is append-only; a later change of mind is a new dated line in its `decisions.md`.

3. Write `docs/01-intake.md` with the answers, verbatim where possible:

```
# Intake

## Idea (user's words)
> ...

## Target user
...

## Core action
...

## Product type
One of: ios-app | android-app | mobile-app | backend-service | web-app | cli | library

## Platforms
Primary: ...
Order: ...

## Success in 6 months
- ...

## Out of scope
- ...

## Constraints
- Timeline: ...
- Budget: ...
- Other: ...
```

4. Hand off to the CEO agent. Do not try to write vision yourself.

## Anti-patterns

- Don't ask 12 questions. Three is the cap, and one round.
- Don't write the PRD here — that's CPO.
- Don't present a default as the founder's words: an inferred answer is always marked `(ASSUMED)`.
