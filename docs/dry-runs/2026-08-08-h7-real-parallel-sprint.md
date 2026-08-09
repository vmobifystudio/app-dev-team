# H7 — does parallel dispatch actually work now, and what does a wave cost?

## Hypothesis, stated before running anything

The original adversarial review (`docs/reviews/2026-08-07-adversarial-operations-review.md`) found
11 of 19 tickets in a real programme never got claimed under parallel dispatch — the studio's
throughput failure mode. Every fix since (worktree-slot leasing, spawn-gate, the wave model,
merge-reconcile, the destructive-git hook, the OPS-009/012/013/014 batch) has been built and unit-
tested against fixtures, but the parallel-dispatch mechanism itself had not been re-run for real
since the fixes landed — H6 (2026-08-07) was corrected mid-setup to a single sequential agent.

**Falsifiable prediction:** two independent tickets, two real developer agents spawned in the same
message (true concurrency, not sequential), each in its own leased worktree, will both get claimed,
worked, committed and reported without collision, without a stall, and without a governance breach —
and E6 (the cost/economics measurement this repo has never taken) will be answerable from the
board's own event log rather than estimated.

If either ticket sits unclaimed, or the two agents step on each other's files, or a governance rule
gets bypassed the way H6's qa-engineer bypassed the merge gate, that is a real finding to fix, not a
number to round away.

## Setup

Fresh fixture at `dry-runs/h7-parallel-sprint/` — a tiny two-function Node.js (ESM) library, chosen
deliberately over another mobile-platform fixture (tap-counter etc.) because it needs no toolchain
beyond Node itself, which is this plugin's own language and therefore guaranteed present on every
host that can run the plugin at all.

- `APP-001` — `slugify(str)`, owner `ios-developer` (role name borrowed for realism; platform is
  `cli`), files `src/slugify.js` + `test/slugify.test.js`.
- `APP-002` — `titleCase(str)`, owner `android-developer`, files `src/titleCase.js` +
  `test/titleCase.test.js`.
- No dependency between them, no shared logic — the only legitimately shared surface is
  `package.json` (`"type": "module"`), which neither ticket's impl spec mentions and both
  discovered independently was required for `node --test` to parse an ESM `.js` file at all.
- `docs/10-prd.md`, `docs/20-architecture.md`, `docs/22-impl-spec-cli.md`,
  `docs/team/project-profile.json` (platform `cli`, test command `node --test test/`),
  `docs/23-git-strategy.md` (`Integration branch: main`) — the minimum a real IC's read-order
  requires, so neither agent could legitimately block on a missing spec.

Two worktree slots leased (`worktree-slot.mjs lease --owner ios-developer …` /
`--owner android-developer …`), `spawn-gate.sh ios-developer android-developer` asked for GO before
either agent was spawned — exactly the sequence `parallel-orchestrator` prescribes.

## What actually happened

Two real Claude Code agents (general-purpose, briefed with the `ic-workflow` skill by name and the
literal board row + output contract via `spawn-prompt.mjs compose`) were spawned **in the same
message**, each pointed at its own `.agent-wt/<owner>` worktree.

**Both succeeded, in parallel, with no collision.** Timestamps from `docs/31-board-events.jsonl`
(the record, not a transcript):

| ts (UTC) | ticket | event | by |
|---|---|---|---|
| 10:01:47 | APP-001, APP-002 | created | tech-manager |
| 10:03:28 | APP-001, APP-002 | claimed | ios-developer, android-developer |
| 10:07:08 | APP-001, APP-002 | done_reported | ios-developer, android-developer |
| 10:07:29 | APP-001, APP-002 | review_requested | ios-developer, android-developer |
| 10:10:44 / 10:11:35 | APP-001 / APP-002 | approved | code-reviewer (two separate spawns) |
| 10:11:42 | APP-001, APP-002 | merged | tech-manager |
| 10:12:50 | APP-001, APP-002 | verified | tech-manager (real wave, not static) |
| 10:16:22 | APP-001, APP-002 | closed | tech-manager |

Neither ticket sat unclaimed. Neither agent read or wrote the other's worktree. Both branches
(`feat/APP-001-slugify`, `feat/APP-002-title-case`) carried only their own ticket's files plus the
shared `package.json` — byte-identical on both branches (confirmed by the reviewer, `sha1
23edf32d…`), so `wave-integrate.mjs`'s merge of both into one wave produced a clean add/add with
**zero conflicts**, exactly as N3 of the APP-001 review predicted before it happened.

Both developer agents wrote real, correct, tested code — 6 tests each, all passing, verified by a
genuinely independent `code-reviewer` spawn per ticket that re-ran the tests itself and, for
APP-001, reintroduced four mutants by hand and watched three of them go red (full verdict:
`docs/53-reviews/APP-001-cycle-0.md`). Neither review was a rubber stamp; both APPROVE verdicts are
backed by re-execution, not by reading the developer's claim.

**No governance bypass.** Both ICs stopped at `done_reported` and never touched `board.mjs move …
merged` or a raw `git merge`; `code-reviewer` reviewed and approved; `tech-manager` (this session,
acting the role) ran the actual merge via `wave-integrate.mjs`, never a hand `git merge --no-ff`.
The exact H6 failure mode did not recur.

## Two real defects found by running it, not by reading the code

**1. `wave-integrate.mjs` reported a genuinely green wave as `CANNOT EVALUATE`.** The first
`wave-integrate.mjs --wave 1` run merged both branches cleanly, ran `node --test test/` on the
merged tree, and got `# tests 12 / # pass 12 / # fail 0` — then declared `WAVE RESULT: CANNOT
EVALUATE — the suite did not demonstrably run here`, over evidence sitting in the output it had just
printed. Root cause: the ran-evidence regex expects a test count *before* the noun ("N tests …
pass/fail"); Node's own built-in test runner puts the count *after* it (`# tests N`), so it matched
nothing. This is the plugin's own language, on the plugin's own documented default platform
(`cli`/`library`), and it had never been mutation-tested against real `node --test` output before —
only against hand-written shell fixtures that happened to say "N tests run" in the older shape.
Fixed in `scripts/wave-integrate.mjs`'s `RAN` regex.

**2. `scripts/verify-done.sh` carried the identical gap**, found *independently* by the
`android-developer` agent itself while working APP-002 — it noticed `verify-done.sh` would return
CANNOT EVALUATE on its own branch, correctly diagnosed the exact regex and line number, correctly
declined to edit a plugin script outside its ticket's surface, and recorded the finding in its daily
fragment for tech-manager instead. That is the behaviour this studio's rules ask for, demonstrated
without being told to demonstrate it. Fixed alongside the wave-integrate.mjs fix, from the same root
cause.

Both fixes, their test.sh coverage and mutation catalogue entries (M77, M78) are in the commit that
accompanies this document.

## E6 — what a real wave actually costs (never measured before this)

From `docs/31-board-events.jsonl`, ticket creation to both tickets `closed`:

- **Wall-clock: 14.6 minutes** (10:01:47 → 10:16:22), for 2 tickets landed in one wave.
- **Agent spawns: 4** — 2 developers (parallel, same message) + 2 code-reviewers (parallel, same
  message). Zero retries; neither ticket needed a re-spawn.
- **Disk: ~0 MB.** Both worktrees together, before `worktree-reap.mjs --apply` reclaimed them.
  (This fixture has no dependencies to install; a real mobile project's DerivedData/Gradle cache
  would not be zero — this number is honest about what it measures, not a general claim.)
- **CLI calls, tech-manager side:** ~25, hand-counted from this session's own command history —
  `board.mjs` (add/move ×~14), `worktree-slot.mjs` (lease ×2, release ×2), `spawn-gate.sh` (×2),
  `spawn-prompt.mjs compose` (×2), `verify-done.sh --static` (×2), `wave-integrate.mjs` (×3, one of
  which hit the bug above), `worktree-reap.mjs` (×1), `orchestrator.mjs round` (×1). What each IC and
  reviewer agent ran *inside* its own session (git, node --test, file reads) is not counted here —
  this harness cannot see inside another agent's tool-call log, so that half of the true CLI-call
  cost is genuinely unmeasured, not assumed zero.
- **Refusals: 2** — `spawn-gate.sh` once (this session's own usage error, passing ticket IDs where
  the current model expects owner names — which is what surfaced the stale usage-comment bug fixed
  alongside this document) and the `wave-integrate.mjs` CANNOT EVALUATE above. Neither was a
  governance refusal; both were tooling gaps, now fixed.
- **Token/dollar cost: still not measurable in this harness**, per `round-journal.mjs`'s own honesty
  rule — `spendUsd` stays `null` rather than inventing a number this environment cannot report.

This is one wave, two small tickets, on a toolchain-light fixture — not a claim about a 20-ticket
mobile sprint. It is, however, the first number in this repository's history that was *measured*
rather than estimated (§5 of the original review computed ~95 CLI calls / 12–17 spawns / 4 builds
from reading the process, never from running it).

## What this closes, and what it still does not

**Closed:** the specific "H6 was sequential, parallel dispatch is unproven" gap the last adversarial
re-review named — two agents, two tickets, one message, real concurrency, no stall, no collision, no
governance bypass, real independent review, real wave merge, real E6 numbers.

**Still open:** this is 2 tickets, not 19; one wave, not a multi-round sprint under budget pressure;
and the reviewer roles here were spawned directly rather than through a full `/app-build` round with
`tech-manager` itself as an agent (this session played that role by hand, deliberately, to keep the
experiment legible). A larger parallel sprint — more tickets, more owners, at least one ticket
designed to fail review and force a retry — is the next falsifiable question, not run here for time.
