# H8 — does a real tech-manager agent handle a real REQUEST CHANGES retry correctly?

## Hypothesis, stated before running anything

Every prior dry run in this batch (H7) had *this session* playing tech-manager by hand — leasing
worktrees, dispatching developers and reviewers, moving the board. That tested the IC and reviewer
roles for real, but not the orchestration role itself, and not the retry path: what happens when a
real `code-reviewer` agent returns REQUEST CHANGES and a real `tech-manager` agent has to route the
fix back, re-verify, and re-review — the exact loop the original review's throughput concerns were
about.

**Falsifiable prediction:** a real `app-dev-team:tech-manager` agent, spawned once and given one
ticket, will run the correct sequence itself (dispatch developer → verify → request review →
receive REQUEST CHANGES if it happens → re-dispatch the developer with the findings → re-review →
merge → close) using its own role file and the plugin's own scripts, without being told the
sequence — and if the review genuinely finds a defect, the retry will produce a real fix, not a
rubber stamp.

## Setup

Extended the H7 fixture (`dry-runs/h7-parallel-sprint/`) with a third, independent ticket,
`APP-003` — `truncate(str, maxLen)`. The spec (`docs/10-prd.md#F-003`) was written to make a
specific, realistic off-by-one mistake *plausible* without rigging the outcome: "the **returned
string's total length**, ellipsis included, must not exceed `maxLen`" — the common naive
implementation (`input.slice(0, maxLen) + "…"`) overshoots by one character. No instruction told any
agent to make or avoid this mistake.

A real `app-dev-team:tech-manager` agent was spawned once, handed the ticket, and told to run its
own normal process end to end, including a real retry cycle if one occurred, using its own role
file and this plugin's own scripts (`board.mjs`, `worktree-slot.mjs`, `verify-done.sh`,
`wave-integrate.mjs`) — not narrated, not simulated.

## A real setup defect, found before the actual test began

The worktree for `ios-developer` was leased *before* this session's edits to `docs/10-prd.md` and
`docs/22-impl-spec-cli.md` (adding F-003 / §5-APP-003) were committed to the fixture's `main` — an
ordering mistake in how this dry run was set up, not a plugin defect. Since a git worktree is cut
from a specific commit and does not follow later commits on its source branch, the leased worktree
was missing both spec sections entirely.

**The developer agent handled this exactly right**: it read `docs/10-prd.md` and
`docs/22-impl-spec-cli.md` inside its own worktree, found neither F-003 nor §5-APP-003 present,
and returned `BLOCKED: APP-003` naming precisely what was missing and refusing to guess at API
shape — `ic-workflow`'s "you do not start coding until you have read all three... if any is missing
or ambiguous, you stop" held under a real, unplanned failure, not just the documented case. Fixed by
fast-forwarding the worktree to the current `main` (`git merge --ff-only main`); `tech-manager`
recorded the `blocked` → `unblocked` transition on the board correctly once told the underlying
cause was resolved.

**Note for later:** nothing in `context-preflight.mjs` (or elsewhere) currently checks whether a
leased worktree's spec/context files are stale relative to the base branch's current tip — this
dry run's failure mode was safe (a clean block, not a silent stale-spec implementation), but a
narrower staleness (a spec file present but since *edited*, not added) would not trigger the same
"missing section" signal and could silently work from an outdated contract. Worth a future check;
not built here, since the observed failure mode already fails safe.

## What actually happened, cycle by cycle

| ts (UTC) | event | by |
|---|---|---|
| 13:03–13:07 | created → corrected → claimed → **blocked** → **unblocked** | tech-manager, ios-developer |
| 17:34:59 | `done_reported` (cycle 0 implementation) | ios-developer |
| 17:35:20 | `verified` (tech-manager ran the real suite directly — a legitimate call for one lone ticket with nothing to batch into a wave) → `review_requested` | tech-manager |
| 17:40:19–17:40:20 | code-reviewer opens, returns **REQUEST CHANGES** | code-reviewer |
| 17:53:44 | `done_reported` (cycle 1 fix) | ios-developer |
| 17:53:49 | `verified` → `review_requested` | tech-manager |
| 17:57:13–17:57:14 | code-reviewer opens, returns **APPROVE** | code-reviewer |
| 17:58:15 | `merged` (via `wave-integrate.mjs`, wave 2) | tech-manager |
| 17:58:41–17:58:56 | `verified` (real wave suite, 20/20) → `qa_passed` → `closed` | tech-manager |

**The review's cycle-0 finding was real, not staged.** The implementation
(`src/truncate.js:7`, `input.slice(0, maxLen - ELLIPSIS.length) + ELLIPSIS`) is correct for
`maxLen >= 1`, but for `maxLen <= 0`, `maxLen - 1` goes negative — and JavaScript's `slice` treats a
negative start as an offset *from the end* — so `truncate("hello world", 0)` returned `"hello worl…"`
(11 characters, not 0). The developer's own 17 tests (all using `maxLen >= 2`) never exercised this.
The reviewer found it, proved it against the actual code (not inferred), and separately flagged an
uncommitted daily fragment (B2) — the same class of "claim vs. git truth" gap this plugin's own
`report-check.mjs --root` exists to catch, found here by a human-equivalent reviewer instead.

**The retry produced a real fix, verified against its own regression.** The re-spawned developer
added `if (maxLen <= 0) return '';`, ran the new tests against the *unfixed* code first
(17 pass / 3 fail, reproducing the reviewer's exact numbers) before applying the guard, then 20/20
after — the same "prove the assertion can fail" discipline this plugin's own `mutate.sh` enforces on
its own gates, done here by an IC on its own ticket. It also made and documented a real product
judgment call (`maxLen <= 0` returns `''` rather than throwing) as an `ASSUMED, NOT RAISED` ledger
entry, reversible in one line — exactly the shape `ic-workflow` asks for.

**The re-review did not rubber-stamp the fix.** The cycle-1 reviewer independently reverted the
guard in a scratch copy, reproduced the original 17/3 failure by hand, restored the fix, confirmed
20/0 — and added two of its own mutations (narrowing `<=` to `<`, and returning the ellipsis instead
of `''` on the guard path), both caught. This is the second dry run in a row (after H7's
`APP-001` review) where a spawned `code-reviewer` chose to mutation-test the diff itself, unprompted
— behavior this plugin documents as the ideal, now observed twice without being asked for by name.

## What this closes

The specific gap the last independent re-rating named: "has the retry/escalation path — a ticket
that fails review and gets re-spawned — ever been tested with real agents?" Answered yes, for one
ticket, with a genuine (not staged) defect, a genuine fix, and a genuine independent re-verification
that reproduced the regression rather than trusting the developer's numbers.

## An honest note on cost — do not read 295 minutes of wall-clock as the real cost

Ticket creation to closed spans **295 minutes** of session wall-clock. That number is misleading if
read as "this is what a retry costs": most of it is latency specific to *how this dry run was
run* — `tech-manager` was spawned as a subagent of this session rather than as the top-level driver
a real `/app-build` invocation would use, so it went idle between steps waiting to be explicitly
resumed, and several of those gaps line up with unrelated back-and-forth in the same session
(including a user question about an unrelated dashboard feature) rather than any agent actually
working. The meaningful number is the **sum of each subagent's own reported compute time**:
25s + 40s + 293s + 84s + 209s ≈ **10.8 minutes of actual agent work** across 4 spawns (2 developers,
2 reviewers) and 1 retry, for one ticket carrying a real defect and a real fix. Neither number
should be read as what a live, top-level-driven `/app-build` round would cost — this is one data
point, from one harness configuration, and the gap between the two numbers here (wall-clock vs.
actual compute) is itself worth remembering the next time either figure is quoted alone.

## What is still unproven

This is one ticket, one retry, one lone review cycle — not a sprint under budget pressure, not
multiple tickets retrying concurrently, not a case where `tech-manager` had to decide between two
competing retries with a shared worktree slot. E1–E5 (larger-scale, multi-ticket cost measurement)
remain open. And because `tech-manager` here was a spawned subagent rather than the top-level
driver, the finding that it needed explicit wake-up nudges between steps says something about this
test's harness shape, not necessarily about how `tech-manager` behaves when it IS the top-level
loop — that distinction matters and should not be quietly dropped in any later summary of this run.
