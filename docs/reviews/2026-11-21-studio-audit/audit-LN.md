LN-1 [High] What `/app-learn` learns is written into the installed plugin cache and lost at the next update
**Where:** `commands/app-learn.md:41`, `:51` and `:148-151` write to `${CLAUDE_PLUGIN_ROOT}/knowledge/*.md` and to an unspecified `CHANGELOG.md`. `~/.claude/plugins/installed_plugins.json` sets installPath to `~/.claude/plugins/cache/mobify-studio/app-dev-team/3.1.0`.
**What happens:** That install directory has no `.git`. Each new version is installed into a fresh directory pulled from GitHub, so every pack addition and failure-corpus row `/app-learn` writes is thrown away at the next reinstall. RESUME's next step is exactly that reinstall. Nothing ever reaches the source repo, so other machines never see the learning either. Step 4 says `knowledge/` without a root, and step 7's `CHANGELOG.md` is ambiguous (the project's or the plugin's).
**Why it matters:** The only cross-project learning path writes somewhere temporary. The studio cannot get better run over run.
**Fix:** Have `/app-learn` write its additions and corpus rows as a patch in the project (`docs/93-kb-patch.diff`) or a branch or PR against the plugin repo, never into the install path. Put `${CLAUDE_PLUGIN_ROOT}` in front of the step 4 and step 7 paths, or drop the CHANGELOG step.

LN-2 [High] A defect found in review never reaches a later spawn prompt, in the same run or in a later one
**Where:** `scripts/spawn-prompt.mjs:383-405` (`composeIc` inlines the role file, skills, KB packs, the spec excerpt and only this ticket's own `--retry` verdict). `commands/app-learn.md:61-64` (the harvest reads `docs/research/*-findings.md`, `docs/80-audit.md` and `docs/51-bugs.md`, not `docs/53-reviews/`). `scripts/review-pattern-scan.mjs:66-71`.
**What happens:** In the scratch project, APP-001 and APP-002 were each blocked for "uses Float for money (spec 22 says Decimal)", in `src/a.ts` and `src/b.ts`. `review-pattern-scan` printed "No file has blocked more than one ticket. Nothing to correlate." It groups by file path only, so the same defect in two files is invisible. APP-003's IC prompt carries neither verdict. After the run, `/app-learn` never reads the review verdicts, which are where review defects actually live.
**Why it matters:** Each ticket pays a full review cycle, plus a model-tier bump, to rediscover a defect the reviewer already wrote down. This is the main efficiency loss, and nothing learns from it.
**Fix:** In `composeIc`, inline the `Blocking:` lines of this sprint's REQUEST CHANGES verdicts, capped at about 10 lines, under "already caught this sprint — do not repeat". Add `docs/53-reviews/*.md` to `/app-learn` step 5.1. Then `review-pattern-scan` can be deleted (it is report-only and keyed to the wrong thing).

LN-3 [Medium] Governed memory is write-only: delete it or wire it in
**Where:** `scripts/memory-curator.mjs:70-100` (`retrieve`), `commands/app-memory.md`, `commands/app-learn.md:104-146`, `agents/incident-commander.md:83`.
**What happens:** `grep -rn "memory-curator\|memory.jsonl\|retrieve"` finds no caller of `retrieve` outside `test.sh`. `spawn-prompt` and `context-manifest` never read `docs/team/memory.jsonl`. Proposals need a reviewer, but no role or step is assigned to review them. The ledger is per project, so a `studio`-class memory from project A never reaches project B. In the scratch run, `--scope anything-goes` was accepted without validation. A later `reject` from a third role silently cancelled a promotion (`retrieve` went from 1 live record to 0).
**Why it matters:** The hash chain, six classes, expiry and supersede machinery cost agent steps at `/app-learn` and incident time. They give the impression of a self-improvement loop, and none of it ever changes an agent's behaviour.
**Fix:** Delete `memory-curator.mjs`, `/app-memory` and `/app-learn` step 6, and route studio-process findings into the same patch as LN-1. The alternative is a single line in `composeIc` that inlines `retrieve --class project` output, but only if someone owns reviewing the proposals.

LN-4 [High] The recurrence measurement reports clean while recurrences have happened
**Where:** `knowledge/failure-corpus.md` (last commit 2026-07-30), `scripts/team-doctor.mjs:800-880`, `commands/app-ship.md:368`.
**What happens:**
- `team-doctor --json` currently returns no `corpus_recurrence` findings.
- The scripts record the recurrences themselves. `scripts/board.mjs:201` and `:648` say "That is FC-001 once more" and "FC-001 once more". `incident-ledger.mjs`, `report-check.mjs` and others have FC-001 comments that landed between 2026-07-30 and 08-06 (`git log -S`), after FC-001's "Rule shipped: 2026-07-30".
- None of those became an instance row, so the doctor says the rule works.
- Instances only exist if an agent writes a row by hand, and `/app-learn` only runs "after a confirmed release, not after a blocked one". Blocked runs, where most of the failures are, never feed it.

**Why it matters:** The one signal meant to prove "this stopped recurring" is a self-reported changelog, and it is currently wrong.
**Fix:** Let `team-doctor` count recurrences itself from the `FC-NNN` IDs reviewers already have to cite (`code-reviewer.md:29-37`) in dated `docs/53-reviews/*.md` files, compared against `Rule shipped`, instead of relying on hand-added rows. Run the `/app-ship` harvest on BLOCKED runs and on budget stops too.

LN-5 [Medium] The economic brake fails open: it reads only numbers the manager types in
**Where:** `scripts/round-journal.mjs:48-49` and `:161-175`, `commands/app-build.md:499-505`, `commands/app-run.md:118-121`.
**What happens:** In a project with no `docs/33-rounds.jsonl`, `round-journal.mjs check` prints `BUDGET: rounds 0/12 · spawns 0/60 · retries 0/30` and exits 0. Every count comes from flags the LLM manager passes to `append`. A manager that forgets, or that is respawned cold after compaction, gets an unlimited budget. The board event log already records claims, verdicts and reworks.
**Why it matters:** This is the only run-level self-awareness that acts (it stops the loop). Since it relies on the manager remembering to call it, it can silently fail to stop.
**Fix:** In `check`, take rounds, spawns and retries as the max of the journal and counts derived from `docs/31-board-events.jsonl` (claimed, review verdicts, rework). Keep `append` only for wall-clock and spend.

LN-6 [Medium] Nothing measures run-over-run efficiency, so "gets better each time" cannot be checked
**Where:** `scripts/portfolio.mjs` (ranks by stuck-ness), `scripts/studio-eval.mjs` (planted-defect detection on fixtures), `scripts/round-journal.mjs` (per project, ceilings only).
**What happens:** No artifact records, per finished or stopped run, the first-pass approval rate, cycles per ticket, rework count, rounds to drain, the stop cause or the top FC classes cited. None survives the project or compares one run with the last. `/app-plan` sets budgets from fixed defaults (12 rounds, 60 spawns), not from history.
**Why it matters:** Without this, the studio cannot tell whether a KB change, a model-tier bump or a new gate helped. It also cannot adapt plan size or budgets to its own track record.
**Fix:** At `/app-ship` and on any stop, append one line derived from the board to a durable studio-level `runs-summary.jsonl` (outside the plugin cache; see LN-1). `/app-plan` reads the last 5 lines to size the sprint and set the ceilings.

LN-7 [Medium] Cross-project learning is unsafe: additions from untrusted input are applied automatically to packs every project loads
**Where:** `commands/app-learn.md:29-33` (step 2 mines arbitrary app paths), `:41` and `:156` ("Additions are safe to auto-apply"). `skills/house-conventions/SKILL.md:54` (any agent may write a `LEARNING:` line). Only `skills/ic-workflow/SKILL.md:86` and `agents/code-reviewer.md:201` call `injection-scan`.
**What happens:** `LEARNING:` lines are written by agents that read brownfield repos they did not write, and the miner reports come from external apps. Both are folded straight into `knowledge/*.md`. `spawn-prompt` inlines those packs into every role in every future project (`KB_PACKS`, `spawn-prompt.mjs:119-131`). There is no injection scan on what gets harvested, no per-line provenance in the packs, and no revert path.
**Why it matters:** One poisoned or simply wrong "convention" from one app becomes a house rule for every app.
**Fix:** Run `injection-scan.mjs` over `docs/92-learnings.md` and the miner reports. Make additions a reviewed diff (the LN-1 patch or PR) instead of applying them automatically, and stamp each added line with `(src: <app>/<file:line>, <date>)`.

LN-8 [Medium] KB packs grow without limit and are loaded whole into every spawn
**Where:** `scripts/spawn-prompt.mjs:125-131` and `:217`, `commands/app-learn.md:41`.
**What happens:** Packs are counted whole in the word budget. iOS ICs already measure 5041 words against the 6600-word IC budget. `/app-learn` only appends, with no limit and no merge or retire step, and going over budget is "Not a refusal".
**Why it matters:** Each shipped app makes every later IC prompt bigger, which is the opposite of getting more efficient.
**Fix:** Add a per-pack word limit (for example 1500) to `team-doctor`. When a pack is over it, `/app-learn` must merge or replace existing lines rather than append.

LN-9 [Medium] `/app-eval` does not work from a project and its cases measure nothing
**Where:** `commands/app-eval.md:16`, `scripts/eval-lab.mjs:9` and `:17`, `eval/manifest.json`.
**What happens:**
- Run from a project, it prints `no evaluation manifest at …/eval/manifest.json` and exits 2.
- Pointed at the plugin manifest explicitly, it reports `EVAL LAB: FAIL — 0/7`, because the case commands are relative to the working directory.
- 5 of the 7 cases are only a `grep` for a phrase in a prompt file.

The real evaluation, `studio-eval.mjs` (planted-defect detection plus a false-positive rate), already runs in CI (`checks.yml:222`) and is not exposed as a command.
**Fix:** Delete `eval-lab.mjs`, `eval/manifest.json` and `/app-eval`. If a command is wanted, point it at `(cd "${CLAUDE_PLUGIN_ROOT}" && node scripts/studio-eval.mjs)`.

LN-10 [Low] The failure corpus describes the plugin's own internals but is applied to app diffs
**Where:** `knowledge/failure-corpus.md`, `agents/code-reviewer.md:29-37`, `skills/defect-hunting/SKILL.md:23`.
**What happens:** All instances in the 7 classes are plugin-development incidents (board CLI upcasing, `ship-gate` awk, hook `sed`). The code reviewer extracts about 593 words of Tells and runs them against every app diff. The classes are generic, but the examples steer reviewers toward studio tooling, not toward app bugs.
**Fix:** Once LN-4 collects real instances from app reviews, replace the plugin-only instance rows with app instances. Until then, have `code-reviewer` load the PF- headings only, and the FC Tells only on `[std+]` work.

**Top 3 blockers to autonomous, self-improving shipping:**
1. LN-2: review defects never feed later prompts, so every ticket rediscovers them at the cost of a review cycle.
2. LN-5: the budget brake fails open when the manager doesn't journal.
3. LN-1 with LN-4: learnings vanish at reinstall, and the recurrence metric reads clean while recurrences happen.

**Checked and genuinely fine:**
- Retry escalates the model one tier per review cycle, and the cycle cap force-moves the ticket to blocked (`board.mjs:849`). This is real adaptive behaviour.
- `run-doctor` detects orphaned and duplicate leases and names the active attempt IDs.
- `studio-eval.mjs` runs in CI and reports a false-positive rate against a clean fixture.
- `memory-curator` correctly refuses review by the proposer.
- The kill switch is honoured by both `round-journal check` and `spawn-gate`.

Scratch work is in `$TMPDIR/studio-audit-LN/`. Nothing in the repo was edited.
