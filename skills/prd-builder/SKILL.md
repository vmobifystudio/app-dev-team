---
name: prd-builder
description: On an app-dev-team project, use to write docs/10-prd.md from docs/00-vision.md during /app-init. Used by cpo, and by ceo's founder pass on utility tier.
---

# PRD builder

Build `docs/10-prd.md` and `docs/11-backlog.md` from `docs/00-vision.md` and `docs/01-intake.md`.

## Required sections (in order)

1. **Product summary** — 2-3 sentences.
2. **Personas** — 1-3, each with: name, goal, frustration, context-of-use.
3. **User journeys** — 3-7 prose paragraphs, not bullets, each under a `### [J-NN] <name>` heading. Each paragraph: entry → steps → exit → success state.
4. **Feature table** —

   | ID | Name | Description | Priority | Trace |
   |----|------|-------------|----------|-------|
   | [F-001] | ... | ... | P0 | src: O-001 · rev: YYYY-MM-DD |

   Then, under the table, each feature's acceptance criteria as their own lines — one per
   criterion, the ID first so `trace.mjs` sees it declared:

   `- [AC-001] Given <state>, When <action>, Then <observable result> — src: F-001`

   Priority is P0/P1/P2 (P0 = MVP must-have). Each row cites the founder outcome it serves as
   `src: O-NNN` (the `intent-trace` convention) — or `src: team-default|house-kb` for a `[TD-NNN]`
   team decision (`docs/03-decision-rights.md`); a feature that serves neither is an invented
   requirement. **The bracketed `[F-NNN]` ID is mandatory and is the join key of the whole
   pipeline** — a feature row without one is unreachable from every downstream role. `rev:` is the
   date the row last changed; amend it whenever the row does.

5. **User stories** — for each P0 feature, 1–5 stories:
   *As a [persona], I want to [action] so that [outcome]*
   citing the `[AC-NNN]` lines it is accepted by (never a second paraphrase of them).

6. **Out of scope** — explicit list. Repeat the CEO's non-goals, then add product-level cuts.

7. **Open questions** — each one already decided as an `ASSUMED` `[TD-NNN]` default (listed at
   Gate 1); only money, irreversible actions or scope beyond the brief are left for the founder.

## Backlog format

`docs/11-backlog.md` — the same P0/P1/P2 items as a sequenced list with rough estimates (XS/S/M/L/XL, not hours; `process-tiering` reads them). Every backlog item carries both the implementation ticket ID and the PRD feature ID so the chain is traceable end-to-end:

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
- Every P0 traces back to a journey, which traces back to a persona, which traces back to the vision and a founder outcome (`[O-NNN]` in `docs/00-vision.md`).

If you can't trace a feature back, delete it.
