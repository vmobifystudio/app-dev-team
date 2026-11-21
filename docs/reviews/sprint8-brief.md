# Sprint 8 brief — fix the 2026-11-21 studio audit

Base branch: `fix/sprint-8`. Findings (verbatim, with reproductions): `docs/reviews/2026-11-21-studio-audit/`
(`audit-<LENS>.md`, lenses AU PR SM FL QA CX LN SK EN) and `sprint8-brief.md`. Goal of this sprint: an unattended `/app-run`
takes a normal app from brief to ship-ready with **no human except** money/credentials/irreversible
actions and the final store submission (which must stay a plain checklist, never a gate).

## Setup (every track)
Your worktree starts from `main`. First run:
`git fetch -q . fix/sprint-8:fix/sprint-8 2>/dev/null; git checkout -q -B sprint8/<track> fix/sprint-8`
Commit only on `sprint8/<track>`. Stage explicit paths (the installed old hook blocks `git add -A`,
`git stash`, and command TEXT containing "git reset --hard"/"git clean" — put such text in a file and
`git commit -F`). Never push.

## Rules
- Re-reproduce each finding before fixing. If it does not reproduce, record it as disproved with evidence.
- Root-cause fix in the shared function, smallest diff. **Deletion beats addition**: if the finding says
  delete and nothing real depends on it (grep), delete it and its tests/mutations/doc mentions.
- No new roles, commands, scripts or doc files unless the finding cannot be fixed otherwise.
- Every behaviour change gets one regression check in `scripts/test.sh`, in a NEW section whose banner
  starts `Sprint 8 <track>:` (append at the end, just before the final summary). Prefer behaviour checks
  (run the script) over grepping prose. For each gate you add or change, append a mutation line to
  `scripts/mutate.sh` with scope `Sprint 8 <track>` (anchor must match exactly once: `grep -c`).
- Word budgets are enforced by the suite: `commands/app-build.md` ≤ 4500 (it is at ~4498 — every
  addition needs an equal deletion in the same file), `skills/ic-workflow/SKILL.md` ≤ 1000, IC spawn
  ≤ 6600. Check before committing.
- Shared files (`commands/app-run.md`, `app-build.md`, `app-ship.md`, `app-init.md`, `README.md`,
  `docs/HANDBOOK.md`): any track may edit them, but only the lines its finding needs — no reflowing,
  renumbering or rewording of other paragraphs (the lead merges six branches).
  Every other file: edit only the files your track owns; otherwise put the exact change under
  "Cross-track requests" in your report.
- Keep `sh scripts/test.sh` green (full run before your final commit). If agents/*.md or spawn-prompt
  changed and the prompt registry still exists, run `node scripts/prompt-registry.mjs sync`.
- POSIX/mawk-safe shell; ubuntu CI (no git identity, `git init` defaults to master — fixtures use
  `-b main` and set identity) and macOS.

## Tracks
| Track | Findings | Owns |
|---|---|---|
| V1 autonomy | AU-1,2,4,5,6,7,8,9,10,12,13,14 · PR-1,2,3,4,7,9,10,11 · FL-10, FL-11 | scripts/trace.mjs, scripts/founder-intent.mjs, docs/03-decision-rights.md, agents/{ceo,cpo,product-manager,product-validator,product-researcher,release-manager}.md, skills/{requirements-intake,intent-trace,prd-builder,spec-critic,brownfield-onboarding}/** |
| V2 board+loop | SM-1..10 · AU-3, AU-11 · QA-4 (qa_failed↔bug link) · EN-11 · FL-3 (ship-gate side), FL-12 | scripts/lib/{events,board,capabilities,actor}.mjs, scripts/board.mjs, scripts/orchestrator.mjs, scripts/round-journal.mjs, scripts/ship-gate.sh, scripts/ship-inflight.mjs, scripts/run-doctor.mjs, agents/tech-manager.md, skills/{sprint-planner,parallel-orchestrator}/** |
| V3 QA+evidence | QA-1,2,3,5,6,8,10,11 · PR-5,6 · LN-9 · FL-2 (journey-gate serves the app itself), FL-3 (qa-engineer side), FL-5, FL-15 | scripts/drivers/**, scripts/journey-gate.mjs, scripts/lib/test-evidence.mjs, scripts/runtime-gate.sh, scripts/verify-done.sh, scripts/evidence-check.mjs, scripts/criterion-check.mjs (delete per QA-7), scripts/studio-eval.mjs, eval/**, agents/{qa-engineer,test-automation-engineer,verification-engineer}.md, skills/{runtime-gate,accessibility-gate,defect-hunting}/** |
| V4 context+comms | CX-1..8, 11, 12 · LN-2 | scripts/spawn-prompt.mjs, scripts/context-manifest.mjs, scripts/context-preflight.mjs, scripts/lib/contract.mjs, scripts/report-check.mjs, scripts/team-message.sh, scripts/messages.mjs, scripts/lib/messages.mjs, hooks/**, skills/{ic-workflow,team-protocol,context-preflight}/** |
| V5 learning | LN-1,3,4,5,6,7,8,10 · EN-5 | commands/{app-learn,app-memory}.md, scripts/memory-curator.mjs, scripts/review-pattern-scan.mjs, scripts/run-ledger.mjs, scripts/incident-ledger.mjs, knowledge/{README.md,failure-corpus.md}, agents/incident-commander.md |
| V6 prune+tooling | SK-5,6,8 · CX-9,10 · EN-7,8,9,10,14 · QA-7 (with V3), QA-9 | deletions below; scripts/test.sh infrastructure + scripts/mutate.sh runner; scripts/team-doctor.mjs, scripts/foundation-conformance.mjs, scripts/prompt-registry.mjs, docs/team/prompt-registry.json, commands/{app-impact,app-manager-failover,app-manager-harness,app-run-status,app-eval,app-status,app-portfolio}.md |
| V7 org+eng guidance | SK-1,2,3,4,7,9,10,11 · EN-1,2,3,4,6,12,13 · FL-6 | skills/{role-activation,process-tiering,architecture-builder,house-conventions,git-pr-strategy,dependency-policy,database-migration}/**, knowledge/ (except README, failure-corpus, web-conventions), agents/{cto,tech-lead,code-reviewer,ios-developer,android-developer,backend-developer,monetization-engineer,release-auditor,reliability-engineer,red-team-agent,privacy-reviewer,security-reviewer}.md |
| V8 web path | FL-1, FL-2 (devops scaffolds package.json + Playwright at init), FL-4, FL-7, FL-8, FL-9, FL-13, FL-14, FL-16 · EN-10 (team-bootstrap part) | scripts/project-profile.mjs, scripts/release-candidate.mjs, scripts/privacy-disclosure-scan.mjs, scripts/team-bootstrap.mjs, agents/{devops-engineer,web-developer,security-reviewer}.md, knowledge/web-conventions.md, skills/agent-isolation/** |

### Lead decisions (apply as stated)
- **Delete** (V6): `scripts/impact-map.mjs` + `/app-impact`; `scripts/manager-failover.mjs` +
  `/app-manager-failover`; `scripts/manager-harness.mjs` + `/app-manager-harness` + its eval case;
  `/app-run-status` (duplicate of /app-recover); `/app-eval` command (keep the eval-lab script, CI uses
  it); `scripts/prompt-registry.mjs` + `docs/team/prompt-registry.json` + `requirePromptRegistry` +
  team-doctor §2e; skills `growth-analysis`, `support-mining`; agent `chief-of-staff` (+ matrix rows,
  app-status step 5b, `docs/17-founder-inbox.md` references). Keep `/app-capabilities`, `/app-context`,
  `/app-risk`, `/app-schedule` (cheap human diagnostics). Update counts in README/HANDBOOK/CHANGELOG
  and team-doctor.
- **Delete** (V5): `memory-curator.mjs` + `/app-memory` + app-learn step 6, unless you wire `retrieve`
  into compose in ≤ 10 lines — your call, with evidence. `review-pattern-scan.mjs` once LN-2 lands (V4
  inlines review blockers into compose).
- **Founder gates (V1)**: drop `legal-disclosure`, `account-deletion`, `visual-direction`,
  `sensitive-data` triggers. Keep money/irreversible ones (`pricing` not already in founder's own
  words, `paid-infrastructure`, `destructive-migration`, `waiver`). A fired gate must not stop the
  whole loop: record it as an open founder question and keep building tickets it does not touch.
  Gate 1 approval records the `FOUNDER DECISION` lines. Every other ambiguity: the owning role decides,
  records `DECISION (auto): … — reason` and continues.
- **Review deadlock (V2)**: `reopened` past the cap goes to tech-lead/cto (one extra cycle), not the founder.
- **Store submission** stays a human checklist; do not add gates to it (AU-10: trim it).

## Report (final message)
Per finding: ID — fixed (commit, test label) / disproved (evidence) / cross-track request (exact
change). Then the suite result line, mutation lines added, and the branch tip.
