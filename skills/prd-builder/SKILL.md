---
name: prd-builder
description: Use to construct a complete Product Requirements Document for a mobile app from a vision file. Used primarily by the CPO agent. Triggers on requests to "write the PRD", "spec out the product", or as part of /app-plan.
---

# PRD builder

Build `docs/10-prd.md` and `docs/11-backlog.md` from `docs/00-vision.md` and `docs/01-intake.md`.

## Required sections (in order)

1. **Product summary** — 2-3 sentences.
2. **Personas** — 1-3, each with: name, goal, frustration, context-of-use.
3. **User journeys** — 3-7 prose paragraphs. Each paragraph: entry → steps → exit → success state.
4. **Feature table** —

   | ID | Name | Description | Priority | Acceptance criteria |
   |----|------|-------------|----------|---------------------|

   Use F-001, F-002, ... Priority is P0/P1/P2.

5. **User stories** — for each P0 feature, 1–5 stories:
   *As a [persona], I want to [action] so that [outcome]*
   plus Given/When/Then acceptance.

6. **Out of scope** — explicit list.

7. **Open questions** — what needs CEO or user input.

## Backlog format

`docs/11-backlog.md` — every backlog item carries both the implementation ticket ID and the PRD feature ID so the chain is traceable end-to-end:

```
# Backlog

## Sprint 1 — MVP foundation
- APP-001 [F-001] <feature> — XS/S/M/L/XL
- APP-002 [F-002] <feature> — ...

## Sprint 2 — MVP completion
- ...

## v1.1+
- ...
```

The `[F-NNN]` is mandatory. The sprint-planner skill carries it through to the board's `F-NNN` column, and code-reviewer + qa-engineer use it to fetch the matching acceptance criteria from `docs/10-prd.md` without guessing.

## Quality bar

- Every story is buildable by an engineer without another conversation.
- Every acceptance criterion is testable.
- Every P0 traces back to a journey, which traces back to a persona, which traces back to the vision.

If you can't trace a feature back, delete it.
