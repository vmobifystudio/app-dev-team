# Changelog

All notable changes to this plugin are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
