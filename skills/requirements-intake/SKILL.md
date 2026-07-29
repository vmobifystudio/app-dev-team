---
name: requirements-intake
description: Use at the very start of a new app project to convert a one-line idea or rough brief into a structured requirements document the CEO/CPO/CTO agents can act on. Triggers when the user says "build an app", "I have an idea for an app", or kicks off /app-init with a fuzzy prompt.
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

2. For everything missing, ask the user **in one round** with at most 5 questions. Use the AskUserQuestion tool if available. Cluster questions; don't drip them.

   The five questions, in priority order:
   1. Who is this for? (one specific persona, not a market)
   2. What is the single most important thing they'll do in the app?
   3. What kind of product is this — **iOS app, Android app, both, web app, backend service, CLI
      tool, or a library**? If more than one, which ships first?

      This question used to ask "iOS, Android, or both", which could not describe a product that is
      neither. `role-activation` reads its answer to decide which specialists exist at all, and a
      product type it cannot read from here it has to guess at.
   4. What does success look like in 6 months? (numbers if possible)
   5. Anything that's explicitly out of scope?

2a. **Record the raw material first.** Before you structure anything, put the user's own words —
   the original one-liner, your five questions and their answers, and anything they pasted or
   linked — into `docs/00-founder-intent/` verbatim and dated, then run
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

- Don't ask 12 questions. Five is the cap.
- Don't write the PRD here — that's CPO.
- Don't make up answers when the user is vague. Ask again, more concretely.
