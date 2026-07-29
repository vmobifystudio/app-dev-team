# Changelog

All notable changes to this plugin are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

## [1.3.0] — Coordination, isolation, and reviews that find real defects

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
