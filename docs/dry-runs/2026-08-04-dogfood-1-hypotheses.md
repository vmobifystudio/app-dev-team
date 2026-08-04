# Dogfood run 1 — the studio builds its own remaining work

Date: 2026-08-04
Type: targeted experiment (engineering rule #2), not an app build
Baseline: foundation conformance 12/12, suite 1045 assertions green, PRs #22–#27 stacked

## Why this run, and why it is allowed now

Engineering rule #1 — written this morning — said no broad run until Kernels 1–3 pass their
invariant suites. They pass. The rule was holding out for exactly this.

Six dry runs have exercised the AGENTS by building sample apps. None has exercised the
ORCHESTRATION under real load: the board under concurrent writers, contention between overlapping
tickets, worktree isolation, actor stamping, and the review protocol, all on work that actually
matters. Concurrency has been unproven since dry run 1.

Running the team on this repository's own remaining tasks tests the half that has never been tested,
with real stakes rather than a fixture.

## The work

Two tickets, chosen because they OVERLAP on purpose.

| Ticket   | Task                                          | Files |
|----------|-----------------------------------------------|-------|
| STUDIO-001 | F8 — shared CLI conventions and first-class environment failure classification | `scripts/lib/args.mjs`, several `scripts/*.mjs` |
| STUDIO-002 | F21 — iOS/Android journey drivers against the documented contract | `scripts/drivers/*`, `docs/team/journeys/README.md` |

The overlap is the experiment. If `contention-check` does not fire, that is the finding.

## Hypotheses, committed BEFORE the run

**H1 — contention.** STUDIO-001 and STUDIO-002 both touch `scripts/`. Either `contention-check`
refuses the second dispatch, or the scheduler dispatches both and proves the detector exists but is
not wired into the dispatch path. I expect the SECOND: `contention-check.mjs` was written today and
nothing calls it yet.

**H2 — worktree isolation holds.** `git worktree` per ticket, no cross-contamination, and
`board.mjs` from inside a worktree resolves to the one project log. This is the first real load
since the regression that broke exactly this was fixed a few hours ago.

**H3 — every event is stamped `insecure-local`.** Nothing spawns agents with actor tokens, so
attestation is BUILT AND NOT ADOPTED. If the run produces a single `attested` event I was wrong
about the adoption gap. I expect zero.

**H4 — at least one non-cosmetic REQUEST CHANGES.** If the reviewer approves everything first time
on off-domain code, that is evidence the review is soft, not that the code was good.

**H5 — the board survives the wave with an intact chain**, and `board-doctor` reports no divergence
between the log and the generated view.

**H6 — off-domain cost.** The dev roles are iOS/Android specialists and this repo is Node CLI
tooling. I expect the orchestration evidence to be strong and the code-quality evidence to be weak,
and I am recording that prediction so it cannot be retrofitted afterwards.

## Stopping condition

Stop and write up if any of:
- the board chain breaks, or events are lost;
- an agent writes outside its worktree;
- two agents edit the same file in the same wave;
- more than two rounds pass with no ticket reaching review.

## What this run cannot prove

- Code quality on Node tooling, per H6.
- Anything about the platform layer working on a real device — no simulator or emulator is attached,
  so a journey driver can be written and its contract checked, but not exercised against hardware.
- That 12/12 invariants means the system is correct. It means twelve properties are measured rather
  than assumed. This run is looking for the thirteenth thing nobody thought to measure.
