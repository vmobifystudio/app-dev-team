---
name: process-tiering
description: Use when sizing a ticket at planning time, and when calibrating how much review ceremony a diff needs. Maps the studio's existing XS/S/M/L/XL estimate to how much process a ticket carries — a one-line fix should not walk the same PRD-to-impl-spec pipeline as a multi-screen feature. Triggers from sprint-planner (at ticket creation) and code-reviewer (at review time).
---

# Process tiering

Mined from studying `rsmdt/the-startup` (tiered Direct/Standard/Factory dispatch) and
`olehsvyrydov/AI-development-team` (`change_classes` → `track` mapping) — both scale process weight
to task size instead of running the same ceremony on everything. This studio already has the input
those systems built new fields for: `cpo`'s backlog already estimates every item **XS/S/M/L/XL**
(`agents/cpo.md`), and `board.mjs add --estimate` already carries it onto the ticket. This skill is
the mapping from that existing field to how much process the ticket actually needs — no new field,
no new ticket state.

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

## Why this is guidance, not a hard gate — for now

Everything mechanically enforced elsewhere in this plugin (`verify-done.sh`, `board-doctor.mjs`,
the board state machine's `closed` refusal) earned that by being proven against a real, measured
failure first. This hasn't been dry-run yet — there's no evidence yet that letting XS tickets skip
anything actually saves meaningful cost without also letting something real slip through. Treat this
as the studio's stated intent, verify it earns a script the same way everything else here did, and
do not cite "process-tiering" as an enforced gate until it has one.
