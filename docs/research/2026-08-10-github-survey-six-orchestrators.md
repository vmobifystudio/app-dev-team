# Survey: six public agent-orchestration repos — what shipped, what's proposed

**Date:** 2026-08-10
**Subjects, all cloned read-only via `gh search repos` and deleted after review (never a dependency
of this plugin):**

| Repo | Stars | Category |
|---|---|---|
| `Yeachan-Heo/oh-my-claudecode` | 38.4k | Claude Code plugin+CLI, benchmarked |
| `GammaLabTechnologies/harmonist` | 2.3k | "mechanical protocol enforcement," zero-dep |
| `unohee/OpenSwarm` | 835 | Always-on autonomous orchestrator, real integrations |
| `russelleNVy/three-man-team` | 896 | Minimalist 3-role bet |
| `aws-samples/sample-claude-code-agent-team` | 48 | Official AWS reference sample |
| `olehsvyrydov/AI-development-team` | 13 | "process, not prompts" (found: prose, not process) |

**Method:** for each, a parallel fork read the README, agent/hook/protocol definitions, and (where
present) the actual enforcement source — not just the docs describing it — specifically checking
whether every "enforced"/"gate"/"mechanical" claim was backed by real code that can refuse/fail, or
was prose in a role file an agent could silently not follow. Compared against this plugin's actual
mechanisms throughout: `worktree-slot.mjs` isolation (backed by a measured dry-run collision),
`verify-done.sh` (derives ground truth from git state, never trusts self-report), `board-doctor.mjs`,
mutation-testing as a standing gate, the board state machine's hard refusal of an unverified `closed`
transition, the tamper-evident hash-chained event log.

---

## What shipped, same day: `hooks/require-review-verdict.sh`

`harmonist`'s `hooks/scripts/gate-stop.sh` is genuinely the strongest find across all eight repos
studied this session (both this survey and the earlier `the-startup`/`cas` study). It's a Cursor
`Stop` hook that blocks an agent's final response from completing unless a reviewer subagent was
actually invoked, a handoff file was updated with a matching correlation ID, and memory validation
passes — fails **closed** on validator timeout/crash, and can't be exhausted by a stubborn agent
repeating its final message.

Before building anything on this, confirmed `Stop` and `SubagentStop` are real, fully-documented
Claude Code hook events, supported inside a plugin's own `hooks/hooks.json` (checked
`docs.claude.com/en/docs/claude-code/hooks` directly — not assumed from the name resembling
something else). Every other hook this plugin has runs on `PreToolUse` only; nothing here enforced
anything at the point an agent's *session* ends.

The gap this closes was not hypothetical — it's the exact bug this session hit itself. A
`code-reviewer` spawned as a named interactive teammate to review this plugin's own PR #32 went idle
three separate times, producing nothing: no verdict file, no `board.mjs` event, no findings message.
Two direct nudges asking it to report changed nothing; a human did the review by hand instead.
`agents/code-reviewer.md` already said, in prose, "your verdict is only checkable if it is
recorded" — this repo's own recurring lesson (H6, DR4-027, and now this) is that prose does not stop
an agent from simply not doing the thing.

`hooks/require-review-verdict.sh` (merged in PR #37) wires to `SubagentStop`, matcher
`code-reviewer`. It blocks the stop unless the subagent's own transcript shows evidence of one of its
three legitimate outcomes: a `docs/53-reviews/*.md` write **and** a `board.mjs move <id>
approved|changes` call, or a documented `BLOCKED: <id>` refusal (the role's own self-review exit,
which produces neither artifact by design and must not be caught by the same gate). Fails open on an
unparseable payload or unreadable transcript, same rule as every other hook in this plugin.
Full suite 1458/0, mutation M82 (disable the block condition) CAUGHT.

The SHA-256-manifest idea also mined from `harmonist` (checksumming `agents/*.md` against
drift/tampering) turned out to be **already covered** by `scripts/prompt-registry.mjs`'s
`content_hash` field and `team-doctor.mjs`'s drift detection — the exact mechanism that caught this
session's own edit to `code-reviewer.md` going stale mid-session. No new work needed there.

---

## Proposed, not shipped: two ideas that need real new infrastructure

Same discipline as the `the-startup`/`cas` study's builder/verifier barrier: these are genuine
workflow/architecture additions, not checklist edits, and rushing them into existence without a dry
run is exactly the "ship it and hope" pattern this plugin's whole culture refuses.

### 1. Base-vs-head regression verification (from `OpenSwarm`)

`OpenSwarm`'s `src/verify/runner.ts` runs the verify command on **both** the base ref and the head
ref, and only flags a **new** failure — a pre-existing flaky or already-broken test doesn't get
blamed on the ticket under review. `verify-done.sh` currently checks the current state's suite in
isolation; a ticket built on a codebase with one known-flaky unrelated test would read as failing
verification for a reason that has nothing to do with the ticket.

**Sketch:** `verify-done.sh` would need to checkout (or have available) the merge base alongside the
head, run the test command against both, diff the failure sets, and treat only head-exclusive
failures as blocking. Real risk if rushed: masking an actual regression because the "known failing"
comparison itself is stale or the base checkout is wrong — this is exactly the shape of change that
needs a dry run proving it catches a planted regression *and* doesn't mask a real one, before it
touches a load-bearing gate.

### 2. Automated conflict grouping before dispatch (from `OpenSwarm`)

`OpenSwarm`'s `src/orchestration/conflictDetector.ts` runs a Union-Find over which pending tasks
touch overlapping files/modules and groups conflicting ones so they're never scheduled in parallel —
algorithmic, not a judgment call. Checked: this plugin has **no script backing this at all**
(`scripts/sprint-planner.mjs` doesn't exist; the file-overlap discipline lives entirely as prose in
`skills/parallel-orchestrator/SKILL.md`, e.g. "before launching a batch, list the files each ticket
is likely to touch").

**Sketch:** would need each ticket's impl spec to declare its expected touched-file set (tech-lead
already writes impl specs; this is a new required field, not a new artifact), then a script computing
pairwise overlap before a batch is dispatched, refusing or resequencing a batch that has one. Real
question before building it: does declaring touched files up front actually predict real overlap
well enough to be worth the ceremony, or does the existing per-file serialization rule (already
enforced by convention, per this session's own README) already catch the practical cases? Worth a
small dry run — plant two tickets with genuine file overlap that the current planning process misses
— before committing to the infrastructure.

---

## For calibration: where every one of the six was behind us, consistently

Worth stating plainly rather than only cataloguing what to steal — the pattern held across all six,
not just one or two:

- **No repo had real per-agent filesystem isolation backed by measured evidence of what it
  prevents.** Worktrees were absent (`three-man-team`, `AI-development-team`), optional/a selectable
  mode (`oh-my-claudecode`), or convention-based with the gap stated outright in their own docs
  (`aws-samples`: *"Isolation is enforced through convention, not hard boundaries"*). Only
  `harmonist` and `OpenSwarm` had anything close to mechanical enforcement of *something*, and
  neither was isolation specifically backed by a measured collision the way `worktree-slot.mjs` is.
- **Most trust self-reported completion over derived ground truth.** `oh-my-claudecode`'s
  `factcheck` validates a JSON claims object the agent itself writes; `aws-samples`'s verification
  sentinel is written by the same teammate being checked, with nothing forcing the claim true.
  `verify-done.sh` instead re-derives the answer from git state directly.
- **`AI-development-team` is the sharpest cautionary case**: extremely well-*written* process
  documentation — better prose than most of this plugin's own skill files — with **zero** executable
  backing anywhere in the repo. A worked example of exactly the trap this plugin's own culture is
  built to avoid: a rule that reads as enforced and isn't.

## Open items

Both proposals above are unscoped — no ticket, no owner, no dry run yet. Do not cite either as a
shipped mitigation.
