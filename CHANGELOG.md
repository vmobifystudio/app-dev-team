# Changelog

All notable changes to this plugin are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.5.0] — The gates now fail closed, and something finally runs the app

A full-system review — all 18 agents, 11 commands, 12 skills, 9 scripts, 8 knowledge packs — found
that the team would break on its first real run, and that **almost every defect was fail-open**: a
gate that silently passed, a ticket that silently dropped, a flow that dead-ended. The suite ran
green at 48 assertions throughout, because nothing tested any of it.

Every fix below was verified by executing it, and every new assertion was confirmed to fail against
the old behaviour before being trusted.

### Broke a real run

- **`security-reviewer` could not write its own deliverable** — it lacked `Write`/`Edit` while being
  required to produce `docs/70-security-review.md`, which `/app-ship` gates on.
- **The iOS audit gate was a dead instruction.** `code-reviewer` and `qa-engineer` are told to spawn
  Axiom auditor and test-runner agents; neither had the `Task` tool. The ~25-auditor review the
  README advertises had never once run.
- **`/app-plan` rejected every single-platform and every brownfield project**, demanding both an iOS
  and an Android impl spec and then suggesting `/app-init` — which brownfield is explicitly told not
  to run. `/app-onboard` also never wrote `docs/11-backlog.md`, so the brownfield path could not
  reach a board at all.
- **The board went permanently red.** `cycle_cap_breached` was guarded only by `status !== 'blocked'`,
  so any ticket that legitimately used its two review cycles and merged blocked the pre-spawn gate
  for the life of the project.
- **Doc-owning tickets were structurally un-passable.** `ux-designer`, `qa-engineer`,
  `aso-specialist` and `data-analyst` returned no `Branch:` line, and `verify-done.sh` hard-rejects a
  missing branch. `verification-engineer` was a spawnable owner with no `DONE` contract at all.

### Gates that fail closed

- **`ship-gate.sh` shipped silently three ways**: a renamed or absent `Status` column returned CLEAR
  with no output, backticked status cells were invisible to its `awk`, and `blocked` was not counted
  as in flight. Board reading now goes through `lib/board.mjs` (`scripts/ship-inflight.mjs`) — one
  parser, as the library header always required.
- **A three-state contract**, now shared by every gate: `0` clear · `1` blocked by a real condition ·
  `2` **cannot evaluate**, naming the missing input. Exit 2 is never a pass. Proceeding past it takes
  a recorded `WAIVED:` line with a human and a reason — because a skipped gate and a waived gate are
  indistinguishable in a log unless the waiver is written down.
- **`team-doctor`'s `skill_missing` could never fire**, gated behind a whitelist of eleven names that
  all existed. It now validates against `skills/` and still ignores external plugin skills.
- **`verify-done.sh` discarded test output** while instructing the loop to re-spawn the developer
  "with these failures verbatim". There were none. Output is captured and the tail is printed.
- **`team-message.sh` sanitised only two of five fields**, so a `|` in a ticket ID corrupted the
  ledger table and shifted every downstream field. Its guard windows also disagreed with
  `board-doctor`'s, and ticketless rows all collapsed into one pseudo-thread.

### New: something finally runs the app

Every gate in this repo verified that *the process was followed*. None verified that the artifact
works — a sprint could go green end to end on an app that does not compile. `defect-hunting` has
always said *execute constants, never certify by reading*; the team had simply never pointed that at
the app.

- **`scripts/runtime-gate.sh` + the `runtime-gate` skill** — build, launch, drive the P0 flow, write
  evidence to `docs/evidence/`. Escalates to `axiom:simulator-tester` / `axiom:test-runner` /
  XcodeBuildMCP where present. `qa-engineer` runs it; `verification-engineer` certifies it;
  `/app-build` runs it before the QA wave and `/app-ship` blocks on it.
- Absent toolchain is **CANNOT EVALUATE**, never a pass. A runtime gate that reports success on a
  machine that could not run anything is worse than no gate.

### New: ambiguity dies upstream

- **The `spec-critic` skill** runs after the impl specs exist and before any developer is spawned,
  filing one batch of `question` rows for `tech-lead`. The channel went unused in 10 of 10 dry-run
  agent-runs because an agent that can proceed will proceed — "declare, don't dispatch" catches the
  guess after it is made, at the cost of a rework cycle. This removes the ambiguity first. It is a
  skill invoked by `tech-lead`, deliberately not a nineteenth role.
- `docs/team/messages.md` is now **scaffolded by `/app-init` and `/app-onboard`**. It never was, and
  an agent once reported raising a question on a ledger that had never existed.

### Leaner

- **The canonical output contract** now lives once in `team-protocol`, with a CODE and a DOC profile
  plus a canonical paths table. The daily fragment previously had five spellings, one of which
  `/app-build` gated on.
- **~300 lines of duplicated boilerplate removed** from the agent corpus — the team-protocol block
  alone was copy-pasted into 12 files and into the skill it pointed at. Every line was context paid
  for on every spawn, every round.
- `scripts/integration-branch.sh` resolves the merge base from `docs/23-git-strategy.md` instead of
  four call sites hardcoding `main`, which contradicted the House KB's flagship `develop` model.
- `code-reviewer` and `verification-engineer` no longer duplicate each other's work or double-spawn
  the same security scanner: the reviewer **routes** constants and guard rules; the verifier
  **executes and certifies** them.
- `release-manager` and `monetization-engineer` moved to opus — the roles doing irreversible actions
  and money paths were running the cheapest model in the roster.

### Tests

48 → **82 assertions**, covering every defect above. Each was confirmed to fail against the old
behaviour first. The 1.4.0 note claiming all four `team-message` guard branches were tested firing
was **false** — only the pair limit was; the per-role cap, chain depth and ticketless-row cases are
covered now.

## [1.4.0] — Coordination, isolation, and gates that actually run

What began as "add worktree isolation" grew, across four dry runs, into a release that found and fixed
**fifteen defects by executing the process rather than reading it** — including several in the
tooling written to catch them. Every rule below was written against an observed failure.

Driven by a **live dry run** of the documented process (two developer agents, two deliberately
independent tickets, one working tree) and by four hard-won lessons from a real remediation
programme. Evidence: `docs/research/2026-07-29-dry-run-parallel-agent-collision.md`.

### Fixed

- **Parallel agents corrupted each other.** The process told developers to write files first and
  branch last (`android-developer` step 7), and told the orchestrator to launch them concurrently —
  in one shared working tree. Observed result: the first agent to branch swept the other's
  in-progress files into its commit (8 files / 333 insertions); the second detected the corruption,
  discarded its work, and reimplemented from scratch, spending **588s and 102k tokens**, roughly
  half of it wasted; both branches ended with add/add conflicts on **all 8 files**. The recovery
  was safe only because the other agent had already committed — with different timing the same
  judgment call would have destroyed uncommitted work.
- **Parallelism was judged on features, not files.** `sprint-planner` said "run in parallel when
  tickets touch different modules". The two tickets above were different features in the same
  module and conflicted totally. Independence is now measured in **files**.
- **Nothing in the plugin said "execute it rather than read it".** No agent verified a constant by
  running it, and no agent proved a guard rule could fail. Both are now required.
- **There was no way for one agent to ask another a question.** ICs had no channel; `BLOCKED` and a
  full re-spawn was the only escalation, and `tech-lead`'s "then you ping the ICs" referred to a
  mechanism that did not exist.
- **`tech-manager` contradicted itself** — "never serialize work that could run in parallel" now
  reconciled with the file-overlap rule.

### Added

- **`agent-isolation` skill** — one git worktree per writing agent (verifiers included), branch
  **before** writing, explicit-path staging only (`git add -A` banned), and confirm the mutation
  landed before believing any result.
- **`team-protocol` skill + `scripts/team-message.sh`** — an append-only team channel
  (`docs/team/messages.md`) with kinds `question · answer · handoff · blocker · fyi · escalation ·
  decision`, an org-chart routing table, and a hard **anti-ping-pong guard**: 10 messages per role
  per round, 2 per pair per ticket, 4 roles per chain. Escalations always pass. All four guard
  branches were tested firing.
- **`defect-hunting` skill** — the four lessons, operationalized: audit the data's entry points not
  the screens ("what is the second way this value gets written?"); never certify a number by
  reading it; a rule that cannot fail is worse than no rule; findings need IDs and terminal
  statuses. Includes the corollary that the checker you write to catch the problem is subject to it.
- **`verification-engineer` agent (18th role)** — executes what everyone else asserts. Sweeps
  constants across their real range against outside reference data, grades every guard rule
  (`EXECUTES` / `TEXT-GUARDED` / `TEXT-NAIVE` / `NOT-GATED`), and must watch each rule fail before
  trusting it. Produces `docs/71-verification.md` and gates `/app-ship`.
- **`scripts/board-render.mjs`** — terminal kanban, per-owner load, NEEDS ATTENTION block, and a
  Mermaid dependency graph (`docs/32-board-view.md`) that renders on GitHub with stranded/blocked
  tickets outlined in red.
- **`scripts/lib/board.mjs`** — one shared board parser. Two parsers of the same file drift, and a
  renderer that disagrees with its validator is the exact "second path" defect class.

### Changed

- `code-reviewer` gains a **step 0: the second path** (enumerate every writer and reader of the
  data the diff touches), a constants-and-rules execution check, an isolation-hygiene check, and a
  verdict that must state each explicitly — `NOT CHECKED — <why>` rather than silence, because an
  unstated gap reads as a cleared one.
- All four IC agents: branch-first ordering as **step 0**, an isolation section, a fix-at-the-choke-
  point rule (grep every caller before editing), and an output contract reporting worktree, staged
  paths, mutation confirmation, exact test command, and the second-path check.
- `tech-manager` owns the message channel and the worktree lifecycle; unanswered questions and open
  escalations are its per-round action items.
- `/app-build` creates worktrees before spawning and removes them after merge; `/app-status` and
  `/app-build` render the board; `/app-ship` gates on `VERIFICATION: FAIL` alongside security.
- `board-doctor` knows the new role; refactored onto the shared parser with all five fixtures
  re-run and byte-identical results (13 anomalies / 5 warnings, same codes, same exit codes).

### Cross-check pass (same release)

A structured audit of the plugin against itself — role reachability, ticket-owner vs spawnable-role,
skill references, handoff targets, and the doc writer/reader graph. Six findings, one severe:

- **S1 — a ticket owned by a role `/app-build` never spawns was silently dropped.** `board-doctor`
  accepted 15 owners; `/app-build` step 2 named only three platform developers. `/app-audit` files
  `AUDIT-NNN` tickets against monetization, analytics, ASO, DevOps and security findings and then
  says "remediate via the normal `/app-build` loop" — so those tickets were never picked up, never
  blocked, and never reported. Same silent-drop class as a stranded dependency, through a different
  door. Now: `/app-build` spawns **by the ticket's Owner column**, and `board-doctor` raises
  `owner_not_spawnable`.
- **S2 — three-way disagreement on who may own a ticket** (tech-manager's shape said 5 roles,
  board-doctor accepted 15, `/app-build` could spawn 3). One canonical list now lives in
  `scripts/lib/board.mjs` as `BUILD_SPAWNABLE_OWNERS`.
- **S2 — `docs/52-analytics.md` was written and never read by any implementer.** The data-analyst
  defined the event schema; the developers implementing `APP-NNN-analytics` tickets never opened it,
  so event names were invented per-ticket. All four implementing roles now read it.
- **S2 — `/app-audit` never verified its own findings, and had no register.** It now spawns
  `verification-engineer` over the findings first (a mis-calibrated constant and a rule that cannot
  fail are both invisible to re-reading), and opens `docs/81-findings.md` where every finding has a
  stable ID and a status that is never blank.
- **S3 — `verification-engineer` was missing from the `/app-team` roster.**
- **S3 — the branch model contradicted itself.** `git-workflow.md` integrates on `develop`;
  `tech-manager` merged to `main`. The integration branch is now an explicit per-project decision
  recorded in `docs/23-git-strategy.md`, which the merge gate reads.

### Fixed — found by dry run 2 (`docs/research/2026-07-29-dry-run-2-worktree-isolation.md`)

Re-ran the run-1 collision with the isolation fix applied, fresh agents, same two tickets,
hypotheses written before the run. Isolation held: two clean sibling branches, zero
cross-contamination, no rework, `main` untouched throughout. Two hypotheses failed.

- **`verify-done.sh` was incompatible with `agent-isolation` — two fixes in this same release
  contradicted each other.** It ran `git checkout <branch>` to execute tests; git refuses to check
  out a branch already checked out in another worktree, which under the isolation rule is *always*.
  The result was a **false `REJECTED` on every honest `DONE`**, so the loop would discard correct
  work and re-spawn the developer until the 6-retry budget tripped — with the reason buried in a
  message blaming "uncommitted changes". It now locates the branch via
  `git worktree list --porcelain` and runs the tests where the branch lives. Verified across six
  paths including the plain no-worktree case.
- **The daily fragment is being skipped.** Neither agent wrote one; across both dry runs **1 of 4**
  agent-runs did, though every IC role requires it — and it is the only input to the standup, so
  `tech-manager` was aggregating nothing. `/app-build` now checks the fragment exists on the branch
  before moving a row to `review`.
- **Parallel agents duplicate shared infrastructure.** Both branches independently invented an
  analytics abstraction (`domain/AnalyticsLogger.kt` + `data/ConsentGatedAnalyticsLogger.kt` vs
  `analytics/TodoAnalytics.kt`) for the same schema. The file-overlap rule cannot catch this because
  they created *different* files. `sprint-planner` now requires naming the sprint's cross-cutting
  concerns and either giving each its own foundation ticket or naming the existing type in every
  consuming ticket's `Spec`.

Also confirmed: **worktrees are necessary but not sufficient.** The two clean branches still produced
add/add conflicts on **7 of 10 files** — isolation removes the corruption, file-overlap serialization
removes the unmergeable pile. Both rules are load-bearing.

### Fixed — a systematic review pass, and the bug-fix loop run end to end

Asked "what is left", answered it by measuring rather than guessing: which commands and agents have
never executed, which asserted gates actually run, which contracts have drifted. Seven findings.

**No committed test suite existed.** Every fixture check across three dry runs was ad-hoc, lived in
a scratch directory, and would have vanished with the session — while `CONTRIBUTING` mandated
"run it against a deliberately broken input", which no one could do because no fixtures existed.
`scripts/test.sh` now holds **43 assertions** over four committed board fixtures, each corresponding
to a defect that really shipped. Proven able to fail by seven separate mutations.

**Five of ten spawnable ticket owners had no output contract at all**, and two more were two
releases behind. `/app-build`'s gates read those fields — so for `backend-developer`,
`monetization-engineer`, `devops-engineer`, `ux-designer`, `qa-engineer`, `data-analyst` and
`aso-specialist`, worktree isolation, the fragment check, the assumptions-vs-ledger check and the
duplication check **all silently did nothing while reporting success**. That covered billing,
paywall and CI/signing code. Split into two tiers — code roles (branch + worktree + full contract)
and artifact roles (one uniquely-named document) — and `team-doctor` now enforces both, plus asserts
every spawnable owner belongs to a tier so a new role cannot slip through.

**`board-doctor` never opened the message ledger**, though `team-protocol` claimed it checked the
anti-ping-pong limits and reported unanswered questions. It now reports `question_unanswered`,
`message_pair_exceeded` and `message_chain_too_deep` — and distinguishes "the owner is deciding
without it" from "the ticket already reached `qa`/`done`, so it shipped on an unconfirmed
assumption". Resolutions pair with questions **by count**, after an existence check let one
unrelated `decision` row mask a genuinely open product question.

**The merge gate's own precondition could not fail, and ran too early.** `grep … | sed … || echo`
returns `sed`'s status, so the fallback never fired; and the check ran at the top of the round, so a
reviewer's ledger row landing later meant a merge went through in the window. `tech-manager` now
gates on `grep`'s own exit status and re-reads the ledger at the moment of merging.
`defect-hunting` gains a section on shell guards failing open — a more common unfailable rule than
the `contains()`-over-prose case.

**The bug loop ran end to end.** `BUG-001-fix` (S2, no composition root) went build → verify-done →
review → merge, closing QA's exit criterion with a test that adds through `AddViewModel` and asserts
the todo appears in `ExportViewModel`'s output. Its reviewer gave a split verdict on enforcement and
answered "wired or merely written" honestly — *merely written* — confirmed with two independent
searches.

### Fixed — QA, verification, and the bug loop, run for the first time

**The board ID parser could not handle the plugin's own bug-ticket convention.**
`agents/tech-manager.md` mandates `BUG-NNN-fix` for bug-intake tickets. `parseDependencies` matched
`[A-Za-z]+-\d+`, which truncated `BUG-001-fix` to `BUG-001` — so the doctor reported
`dependency_missing` against a ticket sitting on the same board. Found the first time the bug loop
was actually exercised. Fixed with an optional suffix group; all seven fixtures unchanged.

**Definition-of-Done gates must name a runnable command.** The independent verifier graded
`verify-done.sh` as `NOT-GATED` because the script was nowhere in the project tree. It *had* run —
invoked by the orchestrator from the plugin install — but nothing on the board said where it lived,
so from inside the project the gate was unauditable. `sprint-planner` now requires every DoD gate to
be written out as a runnable command: **a gate whose location is unstated is indistinguishable from
a gate that does not exist.**

**A stated invariant that only a comment enforces.** `ConsentGatedAnalyticsLogger`'s kdoc said every
event must route through it; both ViewModels took the bare `AnalyticsLogger` interface and one
*defaulted* to `NoOpAnalyticsLogger`. Correct in isolation, unenforceable in composition — true only
because nothing was wired yet to break it. `code-reviewer` now grades stated invariants
`EXECUTES` / `TEXT-GUARDED` / `TEXT-NAIVE` and prefers structural enforcement (the analytics events
carry no `String` field at all, so PII cannot leak by shape rather than by discipline).

**What QA found that no per-ticket review could.** Three integration defects, each invisible to a
review scoped to one diff: no composition root wiring Add and Export to one repository (S2); the
`[x]` completed-rendering unreachable end to end because nothing this sprint calls `setCompleted`
(S3); and consent-gating proven only in isolation, with neither feature's tests passing a gated
logger (S2). Both S2s are now `BUG-NNN-fix` tickets on the board.

### Fixed — a relative default path wrote a team message into an unrelated repository

**Corrects an earlier entry in this release.** It originally read "an agent reported doing work it
had not done". That was wrong.

`team-message.sh` defaulted to the relative path `docs/team/messages.md`. An agent invoked it
without `cd`-ing to its worktree, so the path resolved against the shell's working directory — a
completely unrelated project — and wrote a team message into somebody else's repository. The agent
had done exactly what it was asked. The message's absence from the sandbox was then misread as the
agent having lied about sending it.

Found only because the owner of that repository asked whether we were writing into it.

- `team-message.sh` now resolves the ledger against `git rev-parse --show-toplevel` and **refuses to
  run** outside a git repository rather than guessing. Tested from a deep subdirectory, outside any
  repo, and with an explicit `--ledger`.
- The `Assumptions & open questions` contract field and its verification stay — for a better reason
  than originally given. Not "agents lie", but: **an agent's report can be true while the artifact
  it names is unreachable**, and the loop must be able to tell those apart.

### Fixed — the original (incorrect) framing, superseded above

The most consequential finding of the full-sprint run.

A developer hit the deliberate spec ambiguity it was given, decided sensibly, and wrote in its
**daily fragment**: *"Raised to tech-lead on the team channel per the ticket instructions —
implementation proceeds under this assumption pending their answer."*

No message existed. `docs/team/messages.md` had never been created. Two independent searches
confirmed it. The claim was sincere, false, and sitting in the one artifact `tech-manager`
aggregates into the standup — where it would have read as a question awaiting an answer that nobody
had asked.

`verify-done.sh` checks branches, commits and tests. **Nothing checked a claim about a non-code
artifact** — a question raised, a fragment written, a second path traced. The output contract asked
agents to *state* these; nothing confirmed them.

- Developers now report `Assumptions & open questions` as a contract field, and must paste the
  ledger row for each question raised — or write `ASSUMED, NOT RAISED` plainly. The instruction says
  why: a false line is worse than a missing one, because the orchestrator and the standup both read
  it as fact.
- `/app-build` verifies that line against `docs/team/messages.md` before accepting a `DONE`. A
  missing message is filed by the orchestrator, called out in the standup, and makes every other
  unverifiable claim in that report suspect.

Note the base rate: the team message channel has now gone unused in **10 of 10** agent-runs across
three dry runs — including one where the agent was handed the exact command, wanted to use it, and
believed it had.

### Fixed — found by the full-sprint dry run (merge gate)

- **A dependency blocked its dependents until QA, not until merge.** `/app-build` treated a
  dependency as satisfied only at `done`. Observed live: the foundation ticket merged cleanly to
  `main` and both features depending on it stayed `todo`, so the sprint had nothing to run while a
  single QA pass completed. A dependency is satisfied when its code is on the integration branch
  (`qa` or `done`) — QA failures already re-enter as `BUG-NNN-fix` tickets, so gating dependents a
  second time buys nothing and serializes the board behind its slowest stage.
- **The isolation rule contradicted the artifact conventions.** `agent-isolation` said "never leave
  your worktree" while the daily-fragment and review-verdict conventions both wrote into shared
  `docs/`. A developer resolved it by writing its fragment to the repo root, so a fragment for
  unmerged work landed on `main`. Reframed around the real hazard — **collision, not location**: a
  shared write is safe when no other agent can write that path. Code and tests are worktree-only;
  daily fragments live in the worktree and reach `main` at merge; `docs/53-reviews/<id>-cycle-N.md`
  is a safe shared write (unique per ticket+cycle, and must outlive a rejected branch); the board
  and message ledger are append-only.

### Fixed — found by the full-sprint dry run (review gate)

- **A drifted ledger word silently erased a REQUEST CHANGES verdict.** The reviewer appended
  `changes-requested` instead of the canonical `changes`. `parseLedger` filtered the row out, so the
  verdict vanished from every mechanical check, the ledger-derived cycle count stayed at 0, and
  `board-doctor` reported the *milder* `review_never_started` — pointing away from a rejection that
  had really happened. Unknown actions are no longer dropped; `ledger_action_unknown` blocks, the
  legal vocabulary is printed in the ledger template header, and `code-reviewer` names the exact
  words.
- **A strict parser over an append-only log had no supersede path** — one typo would have blocked
  the board permanently, since the bad line can never be deleted. A later valid entry for the same
  ticket now counts as the correction and drops the bad row to
  `ledger_action_unknown_superseded` (visible, non-blocking). An *unsuperseded* bad word still
  blocks; both directions tested.

### Fixed — worktree location and a false claim

`agent-isolation` said "`Add .agent-wt/ to .gitignore` (the `/app-init` bootstrap does this)".
`/app-init` did not do this, and the path was `../.agent-wt/` — a **sibling of the repo**, outside
git, where a `.gitignore` entry means nothing. A rule that describes something nobody does is the
same failure as a guard that cannot fail: it reads as covered. Worktrees now live at `.agent-wt/`
inside the repo, and `/app-init` actually adds the ignore entry.

### Added — `scripts/team-doctor.mjs`

The rule that stops this class coming back: validates the **plugin itself**. Catches an unreachable
role, an owner `/app-build` never spawns, a referenced skill that doesn't exist, an unresolvable
handoff target, and a doc with only one reference (written and never read, or read and never
written). Verified by breaking the plugin on purpose and watching it go red, then recover.

## [1.2.0] — Board integrity

Informed by a study of a production multi-agent orchestrator
(`docs/research/2026-07-29-agent-teams-ai-orchestration-study.md`). The loop shape was already
right; the **state model** was the weak part — every board row was an assertion by an agent, and
nothing ever checked it.

### Fixed
- **The sprint loop could report success while silently stranding tickets.** `/app-build` treated a
  ticket as ready when `Status = todo` and every dependency was `done`, and exited when there were
  no ready `todo` rows and nothing in `review`/`qa`. A ticket behind a `blocked` dependency
  satisfied neither condition, so the loop terminated and printed a successful sprint summary
  without ever mentioning it. Now caught as `stranded`, and the sprint summary must account for
  every non-`done` row by name.
- **There was nowhere to record who reviewed.** The ticket shape had `Owner` but no `Reviewer`, so
  self-review was undetectable, and a `done` ticket was indistinguishable from one that skipped the
  gate. Added a `Reviewer` column and an append-only review ledger.
- **The review-cycle cap lived in a free-text `Notes` cell** as `cycles=N`, so a safety counter
  depended on an LLM correctly editing a substring inside prose. Promoted to its own `Cycles`
  integer column, cross-checked against the ledger.
- **`DONE: APP-NNN` was an unverified self-report** — nothing checked that the branch existed, that
  commits landed, or that the tests named in "tests: all green" were ever run.

### Added
- `scripts/board-doctor.mjs` — validates `docs/31-board.md` before any agent is spawned. 14 blocking
  anomaly codes (`stranded`, `owner_missing`, `owner_invalid`, `dependency_missing`,
  `dependency_cycle`, `self_review`, `done_without_review`, `cycle_cap_breached`, …) plus warnings.
  Exit `1` means spawn nobody. Node, zero dependencies.
- `scripts/verify-done.sh` — proves a `DONE` claim against git: branch exists, commits present,
  files changed, test command exits zero. POSIX `sh`, zero dependencies.
- `board-doctor` skill — wires both, and carries a manual checklist so a vanilla install without
  Node still performs the check by hand.
- **Spawn budget:** max 6 developer retries per ticket across a sprint (review cycles plus
  rejected-DONE retries), then blocked and surfaced.

### Changed
- Board columns: `ID | Feature | Title | Owner | **Reviewer** | Status | **Cycles** | Depends on |
  Estimate | Spec | Acceptance | Notes`. `Notes` is free text only — never status or counters.
- `docs/31-board.md` gains a `## Review ledger` section (append-only: `requested` · `started` ·
  `approved` · `changes` · `merged`).
- Doctor gate added to `/app-build` (step 0, **every round**), `/app-plan` (validate before
  handoff), `/app-status` (verdict at the top), and `parallel-orchestrator`. Not skippable under
  `--yolo` — that flag skips human gates, never correctness gates.
- `code-reviewer` refuses a ticket it owns, and writes its verdict to the ledger.
- `tech-manager` never merges a ticket lacking an `approved` ledger line from a non-owner, and
  re-runs the doctor after setting anything `blocked` (which is what strands its dependents).
- **Legacy boards degrade gracefully:** a board predating the Reviewer/Cycles columns and the ledger
  still gets full structural checking; review-integrity findings become warnings, with a migration
  hint. The doctor never blocks a project purely for predating this release.

## [1.1.0] — Brownfield support

### Added
- **Existing-app support.** The team now works on already-built codebases, not just new ideas.
  - `/app-onboard` — detects the stack, reverse-engineers the as-built architecture + feature
    inventory, and generates `CLAUDE.md`, so the team understands the codebase (read-only).
  - `/app-audit` — fans out the specialist + Axiom auditors, produces a severity-ranked gap report
    (`docs/80-audit.md`) tagging each finding with the exact House KB rule it violates and a
    Safe/Risky classification, builds an `AUDIT-NNN` remediation backlog, gates on your approval,
    then fixes (safe fixes automatically; risky changes — migrations, refactors, concurrency
    rewrites, billing logic — only with an approved plan).
  - `brownfield-onboarding` skill — stack detection, as-built reverse-engineering, and the
    Safe-vs-Risky remediation classifier.
  - `/app-run` now auto-detects greenfield vs brownfield and routes accordingly.

## [1.0.0]

### Added
- Four new roles: `aso-specialist`, `devops-engineer`, `monetization-engineer`, `data-analyst`.
- `/app-run` — mostly-autonomous driver (scope-lock and ship are the only human gates).
- `/app-learn` — mines shipped apps into the living House Knowledge Base.
- `knowledge/` — Mobify Studio house conventions mined from our internal shipped apps.
- `house-conventions` skill — agents load the relevant house pack before working.
- Skill wiring: IC agents now route through the installed Axiom iOS, ui-design Android,
  ASO, and monetization skills; iOS code review runs Axiom auditor agents as a gate.
- Project bootstrap: `/app-init` now generates the target project's `CLAUDE.md`, `.gitignore`,
  and git-strategy doc seeded from the House KB.
- Repo hygiene: LICENSE, CONTRIBUTING, CHANGELOG, .gitignore.

### Fixed (post-review, plugin-validator + skill-reviewer)
- Subagent tool naming: all spawning commands now list both `Task, Agent` in `allowed-tools`,
  so orchestration works regardless of the runtime's tool name.
- `house-conventions` skill: defined the pack path (`${CLAUDE_PLUGIN_ROOT}/knowledge/…` with a
  glob fallback) and made it fail-closed (stop + blocker) instead of silently using defaults.
- `house-conventions`: added Flagship/Utility tier selection and tied learnings to the real
  `docs/daily/…` run-fragment convention.
- Added `model:` to `release-manager` (sonnet) and `security-reviewer` (opus); removed tracked
  `.DS_Store` files.

## [0.1.0]

### Added
- Initial 13-agent hierarchy, 7 commands, 5 skills, docs-as-memory operating model.
