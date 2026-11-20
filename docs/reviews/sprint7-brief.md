# Sprint 7 brief — fix the 2026-11-19 fresh audit

Base branch: `fix/sprint-7` (commit 213fc6e). Findings: `docs/reviews/2026-11-19-fresh-audit.md`
(verbatim reports with reproductions). Triage/task list: `docs/reviews/2026-11-18-sprint-2.md`
§ "Fresh audit on main 33bfab2".

## Setup (every track)
Your worktree starts from `main`. First run:
`git fetch -q . fix/sprint-7:fix/sprint-7 2>/dev/null; git checkout -q -B sprint7/<track> fix/sprint-7`
Commit only on `sprint7/<track>`. Stage explicit paths (the installed old hook blocks `git add -A`,
`git stash`, and even command text containing "git reset --hard"). Never push.

## Rules
- Re-reproduce each finding before fixing (the report gives the repro). If it does not reproduce,
  record it as disproved with the evidence — do not "fix" it.
- Root-cause fix in the shared function, smallest diff. Every behaviour change gets one regression
  check in `scripts/test.sh`, in a NEW section whose banner starts `Sprint 7 <track>:` (append at the
  end of the file, just before the final summary; do not reorder other sections). For each gate you
  add or change, append a mutation line to `scripts/mutate.sh` with scope `Sprint 7 <track>` — the
  anchor must match exactly once in its file (check with grep -c).
- Edit ONLY the files your track owns (below). If a fix needs a file another track owns, do not
  edit it: put the exact needed change under "Cross-track requests" in your report.
- Keep `sh scripts/test.sh` green (full run before your final commit; ~2300+ checks). If agents/*.md
  changed, run `node scripts/prompt-registry.mjs sync`.
- POSIX/mawk-safe shell; works on ubuntu CI (no git identity, `git init` defaults to master — fixtures
  set `-b main` and identity) and macOS.

## Ownership
| Track | Findings | Owns |
|---|---|---|
| U1 integration+wave | W7-1, G7-6, W7-2, C7-5, G7-3, G7-16, W7-3, W7-5, W7-8, G7-17, R7-4, W7-9 (app-init gitignore part), W7-11 doc part, R7-10 | scripts/wave-integrate.mjs, scripts/lib/integration.mjs, scripts/integration-branch.sh, scripts/orchestrator.mjs, scripts/board-doctor*.mjs, scripts/ship-gate.sh, scripts/runtime-gate.sh, commands/app-init.md, commands/app-build.md, agents/devops-engineer.md, skills/agent-isolation/** |
| U2 gate evidence | G7-1, G7-2, G7-4, G7-5, G7-7, S7-5/W7-11 code, S7-2, S7-3, G7-13, G7-14 (board side), C7-8/G7-15/W7-6 (adopt messages + lock-while-waiting), S7-13 (journey-gate/criterion-check paths) | scripts/board.mjs, scripts/lib/{evidence,risk,events,capabilities,actor,readiness,approval,test-evidence}.mjs, scripts/journey-gate.mjs, scripts/criterion-check.mjs, scripts/approval-check.mjs, scripts/evidence-check.mjs |
| U3 hooks | G7-8, G7-9, G7-10, G7-11 (hook parses via integration-branch.sh), G7-12, G7-14 (guard refuses `board.mjs adopt` for subagents), G7-18, W7-9 (dirty test skips operational paths), R7-7 (hook: subagent branch switch / write in main checkout) | hooks/** |
| U4 spawn/prompts | C7-2, R7-5/C7-4, R7-1, R7-6, R7-7 (prompt: absolute slot, `git -C`), C7-6, C7-7, C7-12, R7-9 (GATE_HEADERS), R7-13 code | scripts/spawn-prompt.mjs, scripts/context-preflight.mjs, scripts/context-manifest.mjs, scripts/lib/contract.mjs, scripts/report-check.mjs, scripts/spawn-gate*.mjs, scripts/prompt-registry.mjs |
| U5 tools/locks/tests | C7-1, C7-3, C7-9, C7-10, C7-11, R7-2, R7-3, R7-11, S7-11, S7-1, S7-4 code, W7-12, N3, N6 | scripts/test.sh infrastructure (preamble/helpers + the mirror-test sections it must move to copies), scripts/mutate.sh existing entries, scripts/worktree-slot.mjs, scripts/lib/atomic.mjs, scripts/messages.mjs, scripts/lib/messages.mjs, scripts/run-ledger.mjs, scripts/run-doctor.mjs, scripts/review-pattern-scan.mjs, scripts/memory-curator.mjs, scripts/build-env.sh, scripts/lib/operational-paths.txt, scripts/verify-done.sh, scripts/merge-reconcile.mjs, scripts/accessibility-scan.mjs, scripts/financial-constant-scan.mjs |
| U6 prose | S7-4 doc, S7-6, S7-7, S7-8, S7-9, S7-10, S7-12, R7-8, R7-9 role text, R7-12, R7-13 doc, W7-4, W7-6 doc, W7-7, W7-10 | agents/*.md (except devops-engineer.md), skills/** (except agent-isolation), commands/*.md (except app-init.md, app-build.md), docs/HANDBOOK.md, docs/team/prompt-registry.json |

## Report (final message)
Per finding: ID — fixed (commit, test label) / disproved (evidence) / cross-track request. Then
suite result line, mutation lines added, and the branch tip.
