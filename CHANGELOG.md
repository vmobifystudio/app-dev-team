# Changelog

All notable changes to this plugin are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
