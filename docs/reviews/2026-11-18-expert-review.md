# Expert review — 2026-11-18 (branch fix/e2e-review-sweep)

Five independent read-only reviews: workflow walk-through (W), roles/prompts (R), skills (S),
context engineering (C), review & gates (G). Every finding is listed. Status: **V** verified by the
reviewer (ran or quoted), **V\*** re-verified by the lead, **I** inferred, **X** disproved.
Duplicates across reviewers are cross-referenced, not dropped.

## Disproved / not applicable
- R8 "five reviewers lack Write" — **X**. The session's agent catalog is the stale installed 3.1.0
  cache; on this branch all five declare Write.
- S20 "subagents cannot spawn subagents" — **X**. Nested spawning is allowed up to 3 levels (Claude
  Code docs, confirmed in the previous review).

## Workflow walk-through (W) — can a literal agent reach Gate 2?
1. **Blocker V\*** wave-integrate `RAN` regex misses Jest/Vitest/Gradle → every wave CANNOT EVALUATE → `verified_static` forever, `closed` refused, dependents unclaimable.
2. **Blocker V\*** no step runs `git init` / first commit; planning docs uncommitted are invisible to worktrees.
3. **Blocker V\*** tree always dirty: board log, docs/team/*, runs.jsonl, 53-reviews untracked → runtime/readiness/ship STALE. (= G-F6, G-F12)
4. **Blocker V\*** default risk-policy medium requires a tech-manager approval nobody is told to give; remedy loops back to reviewer.
5. **Blocker V\*** approval-check evaluates every approval, not the latest; reviewer's `--bind` has no `--commit`, binds main HEAD → permanent block.
6. Major V `wave-integrate --wave N` then `--push` refused (branch exists); re-run needs `branch -D` which the hook blocks.
7. Major V no `origin` → push fails exit 1 → read as "re-spawn owners" though main was fast-forwarded.
8. Major V QA ticket: qa-engineer can't `qa_passed` its own ticket, nobody else told → step 7 loop never ends.
9. Major V default capabilities forbid `package.json` (web devs) and `docs/team/journeys` (QA); bootstrap message says "starts CLOSED" while writing 15 roles.
10. Major V web-developer reads `22-impl-spec-web.md`; nothing writes it.
11. Major V runtime-gate/release-candidate have no web mode → every web release needs a waiver.
12. Major V app-build has no utility-tier path; ~40 orchestrator steps, ≥6 spawns per ticket.
13. Major I orchestrator overload (app-build 7.4k + tech-manager 4k words with history mixed in).
14. Minor V utility app-init step 4: devops reads architecture tech-lead is writing in the same batch.
15. Minor V verdict-file text mismatch: `APPROVED` vs required `APPROVE`; FAIL files lack `REVIEW VERDICT:` line. (= R1)
16. Minor V tech-manager merge contradictions; bug tickets "depend on original being done" deadlocks (should be merged). (= R20)
17. Minor V release-manager "Signing & upload"; signing/store credentials never asked at Gate 1. (= R13)
18. Minor V product-validator spawned twice under /app-run.
19. Minor I brownfield "risky / needs-approval" has no board field; `--yolo` defer has no mechanism; app-audit still says "docs/31-board.md".

## Review & gates (G)
- F1 **Critical V** actors are self-declared (`insecure-local` default); tech-manager may write verified/approved/merged/qa_passed/closed — one role clears every gate.
- F2 **Critical V\*** approval-check accepts commits added after approval (ancestor test only).
- F3 High V `merged` does not enforce binding; approval-check is prose-only.
- F4 High V `verified`/`qa_passed` carry no evidence; verdict file is 3 regexes, `Scope` never compared to bound commit.
- F5 High V verify-done accepts tests that assert nothing / "Executed 0 tests".
- F6 High V readiness accepts hand-written gate-result files; honest path STALE (dirty tree). (= W3)
- F7 High V risk routing is a path regex at planning time; `required_evidence` never enforced.
- F8 High V review-cycle cap: blocked → unblocked → review → only exit is approve. No reopen.
- F9 Medium V review hook accepts an old cycle's verdict.
- F10 Medium V `closed` reachable with code never merged; merge-reconcile catches it a round later.
- F11 Medium V qa_failed has no path back to the developer; QA ticket goes through review+merge itself.
- F12 Medium I board log not gitignored; `git checkout main` rolls the board back.
- F13 Low I ship scanners only replay known defects.

## Roles & prompts (R)
1. High V FAIL verdict files rejected by verdict.mjs. (= W15)
2. High V design-QA owners (ux-architect, code-reviewer) never told they run it.
3. High V ios/android/backend/monetization report lists omit `DONE:`.
4. Medium V `NEXT:` blocks parsed by nothing; cpo's contradicts real order.
5. High V ceo's `team-message --kind decision` lacks `--artifact` → refused.
6. Medium V data-analyst has no pass/fail line at ship.
7. Medium V devops/aso/ux/designer have two competing return formats.
8. — **X** (see above).
9. Medium V aso (keyword research, screenshot-validator), security (CVE lookup), privacy (URL resolves) lack tools.
10. Low V security-reviewer has Edit; ceo/cpo/cto/release-manager have Task/Agent they shouldn't use.
11. High V cpo and release-manager told to ask the user mid-run.
12. High V cpo/ceo never read docs/00-founder-intent/ that product-validator checks against.
13. High V release-manager upload/rollout/48h-watch contradicts never-upload; aso "Next: release-manager to upload".
14. Medium V incident-commander orders containment nobody can execute; no return line.
15. Medium V doc-number collisions 16/17/72/73.
16. Medium V security-reviewer reviews `main`, not the candidate.
17. Medium I devops CI step uses `${CLAUDE_PLUGIN_ROOT}` on a runner.
18. Medium V no owner for dSYM/mapping upload, export compliance/age rating, kill switch/forced update.
19. Low V `Localizable.strings` → String Catalogs; `connectedAndroidTest` with no emulator.
20. High V tech-manager merge contradictions. (= W16)
21. Medium V tech-manager event list omits `corrected`.
22. Medium V tech-manager never mentions sprint-planner.
23. Low V tech-manager handoff "after all PRs land: review queue" contradicts streaming review.
24. Low V `import-bugs --by qa-engineer` run by tech-manager.
25. Medium V Opus tech-manager spawned per approved ticket to run two CLI calls. (= C3)
26. High V code-reviewer has no tiering/stop condition — every ticket gets the full battery.
27. Medium V code-reviewer mutation rule contradicts itself.
28. Medium I code-reviewer scratch edits without a throwaway worktree.
29. Low V code-reviewer "four lines mandatory" vs seven; two verdict shapes.
Per-agent verdicts: trim tech-manager, code-reviewer, release-manager, devops, incident-commander, data-analyst; keep the rest with the fixes above.

## Skills (S)
1. High V agent-isolation calls `spawn-gate.sh APP-001 APP-002` (tickets, not owners).
2. High V output contract in four drifting copies (contract.mjs canonical).
3. High V parallel-orchestrator predates `orchestrator.mjs round`; launch before compose.
4. Medium V app-build step 2 restates parallel-orchestrator.
5. Medium V sprint-planner `board.mjs add` example lacks `--file/--invariant/--by`.
6. Medium V runtime-gate skill omits `--record`.
7. Medium V mutation-testing says 16 mutations (85 exist); app agents told to run plugin-relative `scripts/mutate.sh`.
8. Medium I descriptions too long (~11.6k chars) — likely why listings drop them.
9. Medium I broad triggers fire in unrelated projects; scope them to app-dev-team projects.
10. Low–Med V context-preflight, dependency-policy, git-pr-strategy, policy-checker descriptions lack "when".
11. Medium V 11 commands have no frontmatter; consider `disable-model-invocation` on run/init/ship/recover.
12. Medium V sprint-planner/parallel-orchestrator/intent-trace name callers that never invoke them.
13. Medium V agents restate skill bodies (cpo↔prd-builder, tech-manager↔agent-isolation/parallel-orchestrator).
14. High V/I IC loads ~13k words of skills before the ticket; team-protocol mostly orchestrator-only. (= C1)
15. Medium V dated incident history in skill bodies.
16. Medium V defect-hunting loaded whole (3.4k) for §1.
17. Low–Med V role-activation matrix and board-doctor manual fallback belong in references/.
18. Low V bare `knowledge/...` paths resolve against the app, not the plugin.
19. Low I external skills unqualified (`axiom-ios-build` vs `axiom:axiom-ios-build`).
20. — **X** (see above).
21. Low V incident-commander names no skills.

## Context engineering (C)
1. High V IC spawn ≈15.2k words of instructions, ~80% not about the ticket. (= S14)
2. High V code-reviewer ≈19.1k words before the diff.
3. High V Opus tech-manager (~11k words) spawned for merge gate and standup. (= R25)
4. High V run-ledger leases never completed → run-doctor flags every claim orphaned after 15 min → /app-recover always stops.
5. Medium V spawn topology inconsistent (app-build: main spawns ICs; tech-manager.md: it does); no depth rule.
6. Medium V/I orchestrator carries ~18–21k words, grows per round, no post-compaction rule; IC reports not persisted.
7. Medium V reviewer has no spawn template, never gets the DONE report; IC gets no spec excerpt; app-build says multi-ticket, compose takes one.
8. Medium V Opus on mechanical roles; Haiku tier unused; retry ladder self-reported.
9. Medium V three parallelism caps (2/3/3); scheduler counts review/qa as running; preflight-after-claim refuses; spend unmeasured.
10. Medium V model-judged steps that should be hooks/scripts (spawn-prompt verify, report-check, file-overlap).
11. Low V context manifest re-snapshotted every round proves little; token_estimate unenforced.
12. Low V incident history padding in app-build/code-reviewer/tech-manager/ic-workflow.
Target budgets: IC ≤4k words, reviewer ≤8k, tech-manager ≤3k or no spawn, orchestrator ≤6k resident.
