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
   3. iOS, Android, or both — and which first if you have to pick?
   4. What does success look like in 6 months? (numbers if possible)
   5. Anything that's explicitly out of scope?

3. Write `docs/01-intake.md` with the answers, verbatim where possible:

```
# Intake

## Idea (user's words)
> ...

## Target user
...

## Core action
...

## Platforms
Primary: iOS | Android | both
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
