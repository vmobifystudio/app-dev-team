---
name: process-tiering
description: Use when sizing a ticket at planning time and when deciding how much review ceremony a diff needs — maps the XS–XL estimate to the process a ticket carries. Used by sprint-planner, tech-lead and code-reviewer.
---

# Process tiering

Scale process weight to task size. The input already exists: `cpo`'s backlog estimates every item
**XS/S/M/L/XL** (`agents/cpo.md`) and `board.mjs add --estimate` carries it onto the ticket. This
skill maps that field to how much process the ticket needs — no new field, no new ticket state.
`code-reviewer` carries its own projection of this table; keep the two in step.

## The tiers

| Estimate | Track | What changes |
|---|---|---|
| XS | **floor** | `tech-lead` may write the impl spec as a single paragraph naming the file and the change — no separate architecture note. `code-reviewer` still runs the full review, but §4b's on-device-measurement and round-trip-execution requirement applies **only if** the change touches a value a user supplies, sees, or is told (§4b's own trigger condition, unchanged) — most XS tickets don't. |
| S | **light** | Impl spec covers acceptance criteria and the file(s) touched, no separate design-pattern section. Full review, full §4b when it applies. |
| M | **standard** | Today's default — full impl spec, full review. No change from current behavior. |
| L / XL | **full** | Impl spec must name reusable patterns for the pod (`tech-lead`'s existing job, made explicit as required rather than optional at this size) and cross-reference the architecture doc section it extends. Review adds `defect-hunting` §1 (second write path) as a *named, mandatory* step in the verdict, not just available — the larger the change, the more likely it has a second write path nobody enumerated. |

## What never tiers down — the safety override

**A ticket is `full` tier regardless of its estimate if it touches:** authentication, payment/IAP,
PII or any data a `privacy-reviewer` finding would apply to, or anything `security-reviewer` owns.
An XS-estimated one-line auth change is still a full-ceremony review. This is not a size question —
an estimate measures how much *code* moves, not how much *damage* a wrong line does, and those are
different axes. If a ticket's tier and its estimate disagree, the tier wins and the estimate is
simply wrong-sized, not a reason to skip anything.

Nothing here ever lightens `defect-hunting` §1b (new code must be reachable), §3 (a rule that
cannot fail is worse than no rule), or the board's own `closed`-transition refusal
(`verifiedStatic` must be false) — those aren't ceremony proportional to task size, they're the
floor every ticket sits on.

## How to use it

**At planning (`sprint-planner`):** when writing a ticket's `--estimate`, also state the track in
the ticket's `--notes` if it's not `standard` (M) — `--notes "track: floor"` or similar — so
`tech-lead` and `code-reviewer` don't have to re-derive it from the estimate alone, and so a human
scanning the board can see it without reading impl specs.

**At review (`code-reviewer`):** read the ticket's estimate and any explicit track note before
starting. Apply the table above. **State which track you applied, in the verdict** — the same
"findings discipline" reasoning as everywhere else in `defect-hunting`: an unstated calibration
reads as full ceremony having been applied, when it wasn't.

## Guidance, not a gate

Nothing enforces this yet. Do not cite "process-tiering" as an enforced gate until a script does.
