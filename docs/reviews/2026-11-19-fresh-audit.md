# Fresh audit on main 33bfab2 — 2026-11-19 (five reviewer reports, verbatim)

Triage and the Sprint 7 task list: `2026-11-18-sprint-2.md` § Fresh audit on main 33bfab2.

## Lens W

**Lens W: workflow walk-through on main (33bfab2)**

On a single-branch (`main`) web-app project, following the commands literally reaches a ship candidate with exactly one undocumented commit (W7-4). The adopt path also works, but only from a real terminal (W7-6). The walk-through breaks in three places:
- any rework after `merged` (W7-1)
- any project that declares `develop` (W7-3)
- any brownfield project with no git-strategy doc that happens to have a `develop` branch (W7-2)

A fresh clone of the documented setup has no board left to adopt (W7-7).

All fixtures are under `/private/tmp/claude-502/audit-W/`:
- p1: main, web; wave FAIL path
- p2: `develop` declared; qa_failed → BUG-fix
- p3 / p3moved / p3clone / p3copy: happy path to a ship candidate, then moved, cloned and copied
- p4: no git-strategy doc plus a `develop` branch

The drivers are `setup.sh`, `plan.sh`, `ticket.sh` and `qa.sh` in the same folder. The repo was not modified.

**W7-1 | High | V** — Rework after `merged` has no legal route, and `wave-integrate` lands it unreviewed.
- **Wave FAIL path:** app-build step 5 says "re-spawn only the owners its candidate list names" for a FAIL, and the CONFLICT text says "a textual conflict is yours to resolve here". Either way the ticket is already at `qa`. From `qa` the only legal events are qa_passed, verified, qa_failed and blocked (events.mjs:135-137).
- **What `wave-integrate` merges:** the current branch tip (`c.branch`, wave-integrate.mjs:258), not the commit `merged` recorded.
- **p1 reproduction:** wave-2 FAIL. Fix commits went onto feat/APP-002-x and feat/APP-001-analytics-x. Wave 3 merged them, went GREEN, `verified` was accepted, and `--push` put them on main with "MERGE RECONCILE: CLEAR". QA passed them. Then `closed` refused: "gained 1 commit(s) after APP-001-analytics merged … they were never reviewed. Revert them, or reopen the ticket".
- **p3 reproduction (conflict):** APP-008 conflicted in wave 4 and was rebased and resolved. Wave 5 went GREEN, it was verified and pushed, then `closed` refused: "the commit recorded at merged … is not merged into main".
- **Result:** unreviewed code is on the integration branch. The only way out is blocked → founder `reopened`, which contradicts app-run's "a wave that does not go green is a normal outcome an autonomous run survives".
- → Fix: `wave-integrate` merges `merged_head` and refuses or flags a branch that moved since then. Add an orchestrator event that takes a ticket from `qa` back to `in_progress` for a wave FAIL or CONFLICT, so it goes through review again. Document that path in app-build step 5.
- CODE + DOC.

**W7-2 | High | V** — With no `docs/23-git-strategy.md`, two resolvers pick different integration branches.
- **Where they split:** `integration-branch.sh` falls back to `main` (lines 88-102). `integrationBase()` (integration.mjs:31-41) only trusts that script when it says "declared in", and otherwise prefers `develop`.
- **Which callers use which:**
  - `main`: compose, verify-done and wave-integrate.
  - `develop`: approval-check, `merged`, `closed` and the QA docs-only classifier.
- **p4 reproduction:** brownfield shape with a stale `develop` branch. The reviewer's honest `--bind` from the compose prompt is refused by approval-check: "range starts at 2a109f…, after where the branch leaves develop". `merged` is refused the same way. The QA- ticket's `verified` is refused: "branch changes non-document files against develop".
- → Fix: `integrationBase` uses `integration-branch.sh`'s answer whenever that script exits 0.
- CODE.

**W7-3 | High | V** — A project that declares `develop` is never set up correctly.
- **Ordering:** devops-engineer is told to verify with `integration-branch.sh` and that the branch "must also EXIST" (devops-engineer.md:96-101). It runs at app-init step 4, before `git init` at step 5, so the check can only fail. Nothing ever creates `develop`.
- **Commits land on the wrong branch:** app-init and app-plan commit to whatever is checked out, which is `main`.
- **With `develop` created by hand after init (p2):**
  - Developer and QA branches are cut from `develop`, which lacks the app-plan commit (manifests, project-profile, specs).
  - Before the first QA landing the main checkout is still on `main`, so the runtime gate ran there. It recorded PASS for head 23ecaae, a tree that does not contain the wave.
  - The QA landing line `closed` prints (`git checkout develop && git merge --ff-only qa/…`) removes `docs/team/*.json` from the working tree.
  - APP-001 `closed` was then refused ("project-profile.json (working tree) declares test commands {}"), and `orchestrator round` reported toolchain CANNOT EVALUATE.
- → Fix: in app-init step 5, after the first commit, create and check out the declared branch. Move devops's verification to after step 5. Run the wave runtime gate on the integration branch, or refuse when HEAD is not its tip.
- CODE + DOC.

**W7-4 | Med | V** — app-ship step 3b cannot exit 0 as written.
- **Cause:** step 1a appends the waiver to `decisions.md` and runs `founder-intent.mjs --write`. That rewrites the tracked `docs/00-founder-intent/MANIFEST.sha256`. Neither app-ship nor release-manager's commit list (release-manager.md:91-93) commits `docs/00-founder-intent/`.
- **p3 reproduction:** at 3b, runtime, journey and artifact all read STALE (dirty tree), and ship-gate reported approval binding UNKNOWN. After committing MANIFEST.sha256, `orchestrator ship` exited 0 with the journey WAIVED: a ship candidate.
- **Second trigger:** the waiver has to be rewritten with `— vX.Y.Z` once release-manager adds the version heading, which causes another `--write`.
- → Fix: release-manager commits `docs/00-founder-intent/decisions.md` and `MANIFEST.sha256` in the release commit, or step 1a commits them itself.
- DOC.

**W7-5 | Med | V** — `orchestrator round` and `board-doctor` never check the hash chain or the anchor.
- **p3moved reproduction:** after moving the project, `board.mjs show` and `move` exit 2 (anchor gone). `orchestrator round` still prints every precondition CLEAR, exits 0 and lists legal transitions, because orchestrator.mjs:67 only calls `parseEventLog`/`reduce`. `board-doctor` reports "Board is coherent. Safe to spawn".
- **Ship gate:** it does catch it, but misdiagnoses: "audit chain is BROKEN — edited, reordered or truncated. Run: node scripts/board.mjs verify". It never mentions `adopt`.
- → Fix: `round` runs `verifyChain` and `checkAnchor` and reports CANNOT EVALUATE naming `adopt`. Ship-gate tells a missing anchor apart from a broken chain.
- CODE.

**W7-6 | Med | V (text) / R (`!` has no TTY)** — The adopt instructions cannot be followed as printed.
- **Garbled line:** the refusal prints `node "<plugin>/scripts/board.mjs" board.mjs adopt`, a regex-replace leftover at board.mjs:1422.
- **`!` won't work:** it then recommends `! node "${CLAUDE_PLUGIN_ROOT}/…" adopt`. A Claude Code `!` command has no TTY, and `founderConfirms` (actor.mjs:359) refuses without one.
- **Own terminal won't work either:** in the founder's own terminal `${CLAUDE_PLUGIN_ROOT}` is unset. The same problem is in build-loop-branches.md §Step 4 (founder mint printed as `node "${CLAUDE_PLUGIN_ROOT}/…"` for "your own terminal").
- **Misleading prompt:** adopt asks "Type the ticket id to mint a single-use founder token". Adopt via a real pty worked, and the moved project then ran normally.
- → Fix: print the resolved absolute plugin path, drop the `!`, and give adopt its own prompt wording.
- CODE + DOC.

**W7-7 | Med | V** — Fresh clone: HANDBOOK:787-790 promises a path the documented setup cannot reach.
- **The claim:** a clone "refuses every board read" until the founder adopts the committed log.
- **The setup:** app-init step 5 gitignores `docs/31-board-events.jsonl`, `53-reviews`, `docs/team/evidence` and others.
- **p3clone reproduction:** the clone has no board. `round` says "there is no board yet; run /app-plan", which would re-plan finished work. Ship is CANNOT EVALUATE on board, runtime, journey and artifact.
- → Fix: decide whether the log is committed. If not, document how to carry the log over to a new checkout before adopt, and stop pointing a project that has history at `/app-plan`.
- DOC (plus the round message).

**W7-8 | Low | V** — Re-running a wave deletes the tree its own FAIL message promised to keep.
- **Cause:** `rmSync(WT)` at wave-integrate.mjs:221 runs before the "integration/wave-N already exists" check.
- **p1 reproduction:** `--wave 4 --push` on a FAIL wave deleted `.agent-wt/integration-wave-4`, leaving a prunable worktree.
- → Fix: move the `rmSync` after the existence check.
- CODE.

**W7-9 | Low | V** — wave-integrate's advice "Delete it deliberately (git branch -D integration/wave-N)" is blocked by the destructive-git hook in the main checkout.
- **Cause:** the hook counts untracked operational files as uncommitted work: `docs/90-register.jsonl` / `.md` (present after the first `import-bugs`) and `docs/team/release-candidates.jsonl`. app-init's .gitignore loop doesn't cover them and nothing commits them. Reproduced in p1 and p2: hook exit 2.
- → Fix: the hook's dirty test skips operational-paths.txt, or app-init gitignores or commits those files.
- CODE.

**W7-10 | Low | V** — app-ship step 1's evidence-check loop exits 1 on a CURRENT but CANNOT_EVALUATE (waived) journey result.
- **Effect:** the doc says "Exit 1 → re-run the gate", so a literal agent re-runs a waived journey gate forever (reproduced in p3copy).
- → Fix: the doc explains this case, or evidence-check returns a distinct exit for "current but not PASS".
- DOC.

**W7-11 | Low | V** — "No journey declared → rows may not move qa → done" is still prose only.
- **p1 reproduction:** APP-001 was qa_passed and closed while `journey-gate` was CANNOT EVALUATE with no declarations.
- **Ordering:** app-build step 5 closes the APP rows before the QA- ticket lands its journeys. QA can't validate a journey before it lands: my malformed declaration only showed up as journey-gate FAIL after it was on main.
- **Wrong path:** journey-gate points at `docs/team/journeys/README.md` in the project, which doesn't exist there (the README is in the plugin).
- → Fix: in step 5, land the QA- ticket, re-run the journey gate, then close. Tell QA to run `journey-gate --list` on its branch. Print the plugin path for the README.
- DOC.

**W7-12 | Low | V** — Printed next-step commands use a relative plugin path that doesn't exist from a project root: `node scripts/wave-integrate.mjs` at verify-done.sh:331 and merge-reconcile.mjs:188.
- → Fix: use `${CLAUDE_PLUGIN_ROOT}`.
- CODE.

Verified working as documented: preflight → claim → lease → compose → spawn-gate; report-check; `--static` → `verified_static` → review → `approved --bind` → `merged`; wave GREEN → `verified` → `--push` with no origin; QA- docs-only `verified`/`merged`/`closed` and the fast-forward landing; the `changes` → `--retry` cycle on the same branch; the high-risk tech-lead second approval and the runtime gate on the wave; qa_failed → BUG-fix → re-QA → `closed` (once W7-3 was worked around); the waiver read as WAIVED by readiness.

**Verdict for lens W:** reaching Gate 2 and a ship candidate works only on a single-branch project where no wave fails or conflicts. W7-1, W7-2 and W7-3 each strand tickets or land unreviewed code under documented, ordinary conditions, and should be fixed before the real agent run.

## Lens G

I found 18 issues in the review and gate machinery on main (33bfab2): 6 High, 10 Medium and 2 Low. Seventeen are verified by running them (V). One (G7-7) comes from reading the code plus the repo's own test, not a separate run (R). Nothing in the repo was changed; all fixtures are under `/private/tmp/claude-502/audit-G/`, with the main lifecycle fixture in `/private/tmp/claude-502/audit-G/fx.sh`.

Format per finding: ID | Severity | V/R | description and reproduction | → fix | CODE or DOC.

**G7-1 | High | V | QA docs-only fast path: a file rename hides code deleted or moved.**
- `docsOnlyDiff` uses `git diff --name-only` (scripts/lib/evidence.mjs:254). Git's rename detection lists only the new path of a rename.
- Repro: on `qa/QA-1`, `git mv src/auth/login.ts docs/50-test-plan.md` and commit. `docsOnlyDiff(g, HEAD, {qa:true})` returns `{ok:true, files:['docs/50-test-plan.md']}`, and the deleted `src/auth/login.ts` is never seen.
- Effect: the QA- ticket passes `verified`/`merged`/`closed` with no review and removes code from the integration branch.
- The same blind spot gives a normal ticket a `--docs-only` verified (no tests run), and it affects the `files_changed` census at evidence.mjs:486 and :507.
- → Pass `--no-renames` (or use `--name-status` and check both sides) wherever a file list feeds a gate. | CODE

**G7-2 | High | V | `qa_passed` accepts a re-run on the ticket's own unintegrated branch.**
- `verifyQaEvidence` → `verifyTestEvidence` with `afterTs` makes the check non-exact. `boundToTicket` (evidence.mjs:272) then accepts `head === tip`, and nothing requires the run to sit on, or contain, the integration branch.
- Repro (fixture f1): after `merged`, with develop untouched (no wave), run `verify-done.sh feat/APP-1-x develop fast` → `move APP-1 qa_passed --evidence <that record>` → accepted.
- This contradicts agents/qa-engineer.md:105 ("`verify-done.sh <integration branch> …` run after the merge").
- The journey path is weaker still (R): `verifyJourney` (evidence.mjs:416) never checks `mergedTs`, so a journey PASS taken on the tip before review also satisfies `qa_passed`.
- → For `qa_passed`, require `rec.head` to be on or contain the integration branch (or be the wave record), and require journey `evaluated_at` to be after `merged`. | CODE

**G7-3 | High | V | `integrationBase` trusts an uncommitted, unguarded doc, so `closed` reaches done with code that never reached develop.**
- integration.mjs:30-38 runs integration-branch.sh in the caller's git toplevel. That script reads the working-tree `docs/23-git-strategy.md`.
- The guard allows a subagent to Write it or `echo >` it (verified, rc=0).
- Repro (f1): `closed` is refused ("not merged into develop"). Then `printf 'Integration branch: feat/APP-1-x\n' > docs/23-git-strategy.md` → `closed` → `APP-1 closed -> done`, while develop still holds only `init`.
- The same swap empties the `mergeRisk` diff (merge-base = tip, so no escalation) and redirects wave landing.
- Run from a worktree, the toplevel is that branch's checkout, so its own version of the doc is read.
- → Read the declaration from the committed doc on the main checkout (or freeze the integration branch on the board at the first gate event, like test commands). Refuse a declared branch that matches a ticket branch, and guard the doc for subagents. | CODE

**G7-4 | High | V | Risk escalation at `merged` is blind to renames and to non-ASCII paths.**
- `mergeRisk` routes `git diff --name-only mb tip` (board.mjs:1254).
- Repro, rename: policy `^src/auth/` = high, needs security-reviewer. A branch that does `git mv src/auth/login.ts src/login.ts` plus an edit records `merge_risk {diff:"low", because:"src/login.ts"}` and merges with no security approval. The control (same edit in place) is refused.
- Non-ASCII paths: git quotes them by default (`"src/auth/sessi\303\263n.ts"`), so `^src/auth/` never matches. Verified on git's output; the board calls the same function.
- wave-integrate.mjs:265 has the same blindness when picking runtime tiers.
- → `--no-renames -z` (or `-c core.quotePath=false`), and route both sides of a rename. | CODE

**G7-5 | Medium | V | `routeFiles` keeps only one rule's requirements when several rules share the top tier.**
- scripts/lib/risk.mjs:23-30.
- Repro: rules `src/billing` high (security-reviewer approval) and `db/migrations` high (migration-plan). A diff touching both returns only `required_evidence:['migration-plan']`, `approvals:[]`, so the security-reviewer approval is silently dropped. `route()` does the same for one file matching two same-tier rules.
- → Take the union of approvals and evidence over every matched rule at the winning tier (or over all matched rules). | CODE

**G7-6 | Medium | V | The wave lands the ticket branch's current tip, not the commit recorded at `merged`.**
- wave-integrate.mjs:263 merges `c.branch` and never compares it to `merged_head`.
- Repro (f5): after `merged`, commit `src/evil.txt` on feat/APP-1-x → `wave-integrate --wave 3 --push` → GREEN, develop fast-forwarded, `git show develop:src/evil.txt` prints `UNREVIEWED`.
- `closed` refuses afterwards (`landedAfterMerge`), but only while the branch exists, and the unreviewed code is already on develop and pushed.
- → Merge `merged_head` (the sha), or hold the ticket out of the wave when tip ≠ `merged_head`. | CODE

**G7-7 | High | R | Journey PASS coverage is never checked.**
- The board's `verifyJourney` and readiness `gateEntry` accept any journey-gate PASS.
- journey-gate.mjs:197 honours `--only <id>` and `--journeys <any dir>`. The result records neither the selection, the journeys directory, nor the sha of each declaration.
- The repo's own PR46-11 test accepts a PASS with `journeys: []` (test.sh ~11849).
- Effect: a QA re-running one fixed journey with `--only` (a careless, likely move) produces a `qa_passed` for every ticket and a readiness PASS for ship.
- → Record the selection, directory and declaration shas in the result. Board and readiness should require the full P0 set from the committed `docs/team/journeys/`, with no `--only`. | CODE

**G7-8 | High | V | The guard's wrapper list is stale.**
- contract-hooks.mjs:389 lacks `timeout gtimeout stdbuf flock caffeinate ionice chrt doas setsid script`.
- PR46-2 added most of these to the destructive-git hook only.
- All allowed for a subagent (rc=0): `timeout 30 rm -rf docs/team/evidence`, `stdbuf -oL cp /etc/hosts docs/team/risk-policy.json`, `flock /tmp/l rm -rf …`, `caffeinate -i rm …`, `setsid rm …`, `script -q /dev/null rm …`.
- Ran for real: `stdbuf -oL rm -f docs/team/evidence/x.json` and the `script` form both deleted the file.
- → Share one wrapper table, with value flags and leading operands, between both hooks; add `setsid` and `script`. | CODE

**G7-9 | Medium | V | Guard cd tracking still moves the guard on a `cd` the shell never applies.**
- contract-hooks.mjs:762-771. Each of these is allowed (rc=0); the real shell stays in the project, verified with `pwd`:
  - `if [ -d /nonexistent ]; then cd /tmp; fi; rm -f docs/team/evidence/x.json`
  - `while false; do cd /tmp; done; rm …`
  - `case x in y) cd /tmp;; esac; rm …`
  - `f() { cd /tmp; }; rm …` (function body treated as run)
  - `cd /tmp | true; rm …` and `true | cd /tmp; rm …` (a pipeline runs cd in a subshell)
  - `cd /tmp & rm …` (background)
  - `pushd /tmp; popd; rm …` (popd not modelled)
  - `cd /var/root; rm …` (directory exists but permission denied)
  - `cd() { :; }; cd /tmp; rm …`
- → Treat a cd inside if/while/case/function/pipeline/`&` as uncertain (add to `alts`). Model popd. Require X_OK on the target for "sure". | CODE

**G7-10 | Medium | V | The destructive-git hook did not get PR46-1's uncertain-cd fix.**
- It runs in the main session too. On a dirty tree these are allowed (rc=0); `git stash` alone is blocked (rc=2):
  - `false && cd /tmp; git stash` (also the careless form `[ -d build ] && cd build; git clean -fdx`)
  - `if false; then cd /tmp; fi; git stash`
  - `f() { cd /tmp; }; git clean -fdx`
  - `pushd /tmp; popd; git stash`
  - `cd /var/root; git reset --hard`
  - `script -q /dev/null git reset --hard`, `setsid git stash`
  - `git read-tree -u --reset HEAD`, `git checkout-index -f -a`
- `joindir` and `seg()` move the dir on any cd segment (block-shared-tree-destructive-git.sh:258-262; WRAP at :392).
- → Mirror the alts logic (an uncertain cd keeps the old dir as a candidate), add `setsid`/`script` to WRAP, and classify `read-tree -u`/`checkout-index -f` as D. | CODE

**G7-11 | Medium | V | The git hook parses the declared branch differently from integration-branch.sh.**
- `declared_for` (hook:412) does not strip a trailing `.` or `/`. integration-branch.sh does (W2-22).
- Repro: with `Integration branch: main.` the script resolves `main`, the hook reads `main.`. Then `git merge --no-ff feat`, `git update-ref refs/heads/main feat` and `git branch -f main feat` on main are all allowed (rc=0); with `Integration branch: main` all three are blocked (rc=2).
- The hook also reads the unguarded working-tree doc (same root cause as G7-3).
- → One parser shared by both: call integration-branch.sh, or copy its trailing-strip `sed`. | CODE

**G7-12 | Medium | V | The guard fails open when the payload cwd is outside a studio project.**
- contract-hooks.mjs:633 calls `projectRoot(payload.cwd)` and allows everything when it is not found.
- Repro: cwd `/tmp`, `rm -rf /private/tmp/claude-502/audit-G/gp/docs/team/evidence` → rc=0; the Write tool on `<project>/docs/team/risk-policy.json` from cwd `/tmp` → rc=0. From the project cwd both are refused (rc=2).
- → Derive the root from each absolute target path (git common dir plus the board log), not only from cwd. | CODE

**G7-13 | Medium | V | `adopt` re-trusts any mismatched log, not just a missing anchor, and the founder confirms blind.**
- `cmdAdopt` (board.mjs:1408) anchors whenever the anchor check fails. The refusal text in events.mjs:309-314 recommends `adopt` for every mismatch, including "lines were deleted".
- Repro: claimed and blocked events appended, then the log rolled back to the committed version → `board show` refuses → `adopt` through a pty typing ADOPT → `adopted — 1 chained line(s)`; the `blocked` event is gone.
- The prompt reads "Founder override for ADOPT. Type the ticket id to mint a single-use founder token", and shows nothing about what is lost or appended.
- → Limit `adopt` to an absent anchor (or require a flag naming the mismatch). Print the anchor's count against the log's and the events beyond or missing. Give adopt its own prompt text. | CODE

**G7-14 | Medium | V | A subagent can run `adopt`.**
- The guard refuses any `board.mjs actor` subcommand from a subagent (contract-hooks.mjs:821) but not `board.mjs adopt`.
- `(echo ADOPT; sleep 2) | script -q /dev/null node board.mjs adopt` succeeds from a non-TTY caller (verified). The guard returns rc=0 for `node …/board.mjs adopt`, the `script` form and the `python3 pty` form.
- Faking a TTY is an accepted bound; the asymmetry with `actor` is not.
- → Refuse `board.mjs adopt` for subagents, as `actor` is. | CODE

**G7-15 | Low | V | `adopt`'s printed recovery does not work.**
- Without a TTY it prints `node "<plugin>/scripts/board.mjs" board.mjs adopt` (the regex at board.mjs:1422 mangles the mint text).
- It then says to run `! node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" adopt` in Claude Code. That `!` bash mode has no TTY (the code's own message says agent Bash never has one), and `CLAUDE_PLUGIN_ROOT` is unset in the founder's own terminal.
- → Print one correct command for a real terminal with the resolved plugin path, and drop the `!` form. | CODE+DOC

**G7-16 | Medium | V | In a fresh clone `integrationBase` returns a branch that does not resolve.**
- integration-branch.sh exits 0 when the declared branch exists only as `origin/develop`, and integrationBase then returns `develop`.
- Repro: clone of f5 → `integrationBase` = `develop`, but `rev-parse --verify develop` = null.
- Effect: `closed` says "not merged into develop" for merged code, `mergeRisk` refuses "cannot diff", `docsOnlyDiff` says "shares no history", and `currentTestProfile` falls back to the working-tree profile.
- This breaks the fresh-clone case PR #46's own `adopt` was written for. Separately, a strategy doc that declares nothing makes the board fall back develop→main→master while wave-integrate refuses.
- → Return a ref that resolves (`origin/<name>`) or '' with a refusal, and keep the board's fallback consistent with the script's exit 2. | CODE

**G7-17 | Low | V | The wave's dirty check ignores index-hidden edits.**
- wave-integrate.mjs:312-314 checks only `git status`. `runTestEvidence` also checks `indexHides`.
- Repro: test command `git update-index --assume-unchanged src/a.txt; echo changed > src/a.txt; echo "Executed 1 tests…"` → `WAVE RESULT: GREEN`. Without the update-index → CANNOT EVALUATE.
- → Add `indexHides(WT)` to `waveDirty`. | CODE

**G7-18 | Low | V | More writers the guard does not know.**
- Allowed against `docs/team/risk-policy.json` (rc=0): `python3 -m json.tool in out`, `base64 -d -i x -o <guarded>`, `uudecode -o`, `plutil -convert json -o`, `cmake -E copy x <guarded>`, `npx prettier --write <guarded>` (`npx` is skipped as a wrapper, so `npx rimraf …` passes too).
- This is the accepted enumerated-writer bound, but prettier/eslint `--fix` over the tree is a careless, likely move.
- → Add these, and treat an `npx`/`bunx` package with `--write`/`-o`/`--output` as a writer. | CODE

**Checked and holding:**
- Wave suite edits to tracked files and HEAD moves give CANNOT EVALUATE.
- Runtime evidence required below high is read from `merged` and blocks the wave.
- Broken-chain logs are refused by `adopt`.
- The QA allowlist rejects 23-git-strategy, 60-releases, 53-reviews and founder intent, except through G7-1's rename.
- The Write/Edit/MultiEdit/NotebookEdit guard handles `//`, `./`, `..` and case-folded spellings.
- The current destructive-git hook no longer false-blocks quoted text or heredocs. The installed plugin cache (3.1.0) still does, so it needs the reinstall already planned.
- The destructive-git hook's awk could not be run under mawk here (none installed). Reading it found nothing mawk-unsafe, and the Ubuntu CI run exercises it.

**Verdict for lens G:** no — a literal or careless subagent can still reach `qa_passed` without the merged tree (G7-2) or with one journey (G7-7), reach done with unintegrated code (G7-3), merge auth code at low risk (G7-4), land unreviewed commits through the wave (G7-6), skip the QA review (G7-1), and switch off the whole write guard with `timeout`/`stdbuf` (G7-8).

## Lens R

Lens R (roles and prompts) is done: 13 findings, 1 High, 6 Med, 6 Low. The normal path works end to end. I ran the commands each spawn prompt hands an agent, through IC, code-reviewer, tech-lead, verification-engineer, QA, merge, wave and close, on a fixture with `requireActorTokens` and `requireApprovalBinding` on. The bugs are in the side paths. Fixture: `/private/tmp/claude-502/audit-R/p`. Paths below are relative to the repo root.

**Prompt registry is in sync.** `node scripts/prompt-registry.mjs check` gives CLEAR with 30 entries. I re-hashed every `agents/*.md` against its `content_hash` and found no drift and no missing role. `scripts/team-doctor.mjs` reports the team definition as coherent.

**Other commands checked.** All other script commands written into `agents/*.md` (messages, register, incident-ledger, memory-curator, scans, repo-controls, integration-branch, project-profile, ship-gate, release-candidate, approval-check, version-consistency) take the arguments the role files give them.

ID | Sev | V/R | Finding | → Fix | Type
---|---|---|---|---|---
R7-1 | High | V | **A qa-engineer-owned ticket that is not a `QA-` ticket can never close.** `qaWave` in `scripts/spawn-prompt.mjs` puts every non-`QA-` row at `qa` into the QA prompt, including rows qa-engineer owns, and prints `qa_passed --by qa-engineer`. The board refuses that under `NOT_ON_OWN_TICKET` (`scripts/lib/capabilities.mjs`: "Have verification-engineer write it instead"). There is no route for that: `compose --role verification-engineer` gives the "Verify ticket" template with no `qa_passed` command, and `agents/verification-engineer.md:132` says it writes no board event. So the ticket sits at `qa`, `closed` is refused, and ship-gate blocks on "tickets still in flight". Repro: APP-030 "Test plan for checkout", owner qa-engineer, taken through verified → approved → merged → wave verified, then QA-2-w2 compose; the printed command exits 1. This is a real path: `commands/app-audit.md:105-108` files qa-engineer-owned test-plan tickets, and `skills/sprint-planner/SKILL.md:241` plans "qa-engineer ← write test plan". | Leave qa-owned rows out of `qaWave` and compose a verification-engineer QA-verdict variant (mint its token, print `qa_passed --by verification-engineer`). Or let qa-owned docs-only tickets go merged→closed like `QA-` tickets. | CODE
R7-2 | Med | V | **The CTO's ADR command is refused on every ticket.** `agents/cto.md:110` gives `messages.mjs artifact ADR --by cto … --ticket APP-NNN`. On a fresh ticket (APP-060) it exits 1 with `chain_too_deep: would involve 5 roles (max 4)`. Cause: `scripts/lib/messages.mjs:543-549` counts the artifact's declared readers as roles in the chain, and ADR has cto plus 4 readers. Without `--ticket`, or with `--by tech-lead` (who is also a reader), it succeeds. | Don't count artifact readers toward chain depth, or cut ADR readers to 3. | CODE
R7-3 | Med | V | **`review-pattern-scan.mjs` never fires on a verdict the board accepts.** It parses the old format (`## REQUEST CHANGES: <ticket>`, `## Blocking`, `### N.`; lines 68/73). The board now requires `REVIEW VERDICT: REQUEST CHANGES` with a `Blocking:` line (`agents/code-reviewer.md:223-240`). Two current-format verdicts on APP-101 and APP-102, both blocking on `app/Store.swift:42`, give "0 REQUEST CHANGES verdict(s) across 2 review file(s)". `agents/tech-lead.md:88` and `orchestrator round` depend on this scan. | Parse `REVIEW VERDICT:` / `Ticket:` / `Blocking: <file:line>` across every `docs/53-reviews/*.md`. | CODE
R7-4 | Med | V | **QA evidence bundles can't be committed.** `agents/qa-engineer.md:143-169`, `agents/test-automation-engineer.md:53` and the QA allowlist (`scripts/lib/evidence.mjs:222`) all say bundles go in `docs/54-evidence/<journey>-<build>.md` on the QA branch. But `commands/app-init.md:90` gitignores `docs/54-evidence/` (that line came from the C3W-12 fix), and `git add` refuses: "paths are ignored". The bundles stay in the QA slot and are lost when it is reaped. release-auditor (checklist item 4) then marks every test claim unverified, and unverified critical journeys are a FAIL. | Gitignore only the script-written `docs/54-evidence/runtime/` and `journeys/`, and keep bundles tracked. Or move bundles out of the QA branch, docs and allowlist together. | CODE+DOC
R7-5 | Med | V | **Verification-engineer gets nothing to check after a REQUEST CHANGES verdict.** `composeVerify` reads `docs/53-reviews/<ID>-cycle-<row.cycles>.md`, but `changes` has already bumped `cycles`, so it opens the next cycle's file, which doesn't exist. `commands/app-build.md:274-280` says to read the routing fields on every verdict, approved or not. Repro: APP-002 cycle-0 REQUEST CHANGES with "Constants routed… BYE_DELAY=300"; the VE prompt says "names nothing routed". | Take the latest code-reviewer `approved`/`changes` event's `verdict_path` from the log instead of recomputing it from `cycles`. | CODE
R7-6 | Med | V | **Artifact owners are told not to edit the document their ticket is for.** The IC template (`composeIc`) tells every role "Read … the impl spec your role file names" and "Do not edit the specs". That includes ux-architect, product-designer, product-manager and data-analyst, whose tickets *are* `docs/12-flows.md`, 13/14, 11-backlog and 52-analytics. Repro: APP-040 "Flows for checkout", owner ux-architect, `--spec docs/12-flows.md` prints both lines. A literal agent returns BLOCKED or breaks its own instruction. | For the artifact tier, say "edit only the document(s) your ticket's Spec names; no other spec". | CODE
R7-7 | Med | R (hooks V) | **ICs aren't told how to stay in their slot, and nothing stops them leaving it.** The IC prompt gives a relative slot path (`.agent-wt/ios-developer-1`, as `worktree-slot lease` prints it) and a bare `git checkout -b feat/…` line. Nothing in the prompt, `ic-workflow` or `agent-isolation` says to prefix each Bash call with `cd <slot> &&` or use `git -C`. That matters because subagent Bash cwd resets to the session cwd, i.e. the main checkout. Checked with payloads carrying an ios-developer `agent_id` and the main checkout as cwd: `block-shared-tree-destructive-git.sh` allows `git checkout -b feat/APP-010-x main`, and `block-cross-worktree-write.sh` allows a Write into `<main>/src/`. So an agent that follows the prompt literally switches and commits on the orchestrator's checkout. | Print the absolute slot path and the command as `git -C <abs slot> checkout -b …`, plus one line "every Bash call runs `cd <abs slot> && …`". Optionally make the hook refuse a subagent switching branches in the main checkout. | CODE+DOC
R7-8 | Low | V | **security-reviewer's fallback `--context` is refused.** `agents/security-reviewer.md:54-55` says to use `docs/20-architecture.md` when the prompt gives no Context. `approved --bind --context docs/20-architecture.md` is refused: "not a context-manifest/v2". `agents/tech-lead.md:112` gives the correct fallback, `docs/team/context-manifest.json`. | Use tech-lead's wording. | DOC
R7-9 | Low | V | **`ASO: CANNOT EVALUATE` is expected but never defined.** `commands/app-ship.md:294` expects that line. `agents/aso-specialist.md` only defines `ASO READY` and `ASO BLOCKED`, and `GATE_HEADERS` (`scripts/lib/contract.mjs`) has no `ASO:`. A stop message `ASO: CANNOT EVALUATE — … (APP-010 …)` makes `persist-ic-report` block with "missing DONE" (exit 2). | Add `ASO:` to `GATE_HEADERS` and the CANNOT EVALUATE form to the role file. | CODE+DOC
R7-10 | Low | R | **The verification/design-QA FAIL file overwrites the reviewer's APPROVE file.** `commands/app-build.md:283` has the orchestrator write it to `docs/53-reviews/APP-NNN-cycle-N.md`. That is the reviewer's APPROVE file, whose `verdict_path` and `verdict_hash` are on the `approved` event, so the audit trail ends up pointing at a REQUEST CHANGES document. `agents/verification-engineer.md:130` already writes `…-cycle-N-verification.md`. | Name FAIL files `…-cycle-N-verification.md` / `…-cycle-N-design-qa.md`. | DOC
R7-11 | Low | V | **Any decision on a ticket blocks later unrelated questions on it.** Any `decision` (a WAIVER, a PDR, a CEO decision) closes the whole ticket thread. After `artifact WAIVER … --ticket APP-004`, the question `agents/release-manager.md:266` prescribes ("Sign-off on APP-004…") exits 1 with `reopen_without_evidence`. The same applies to security-reviewer's prescribed question at `agents/security-reviewer.md:210`. | Don't treat artifact registrations as thread decisions, or limit the reopen check to the decided subject. | CODE
R7-12 | Low | V | **The crash-free rate is a fraction but the doc doesn't say so.** `agents/release-manager.md:197` says `--crash-free-rate <measured>`. The script requires a value from 0 to 1; dashboards show percent, and 99.5 exits 2 (it fails safe). | Write "as a fraction, e.g. 0.995". | DOC
R7-13 | Low | R | **Small mismatches between the verification-engineer prompt, its role file and the registry.** The prompt's contract asks for `## Not checked`; `agents/verification-engineer.md` uses `## Could not verify`. The prompt mints and inlines a token, but the role file says it writes no board event. Separately, the prompt registry only versions `agents/*.md`: the templates in `spawn-prompt.mjs` and `lib/contract.mjs`, which are most of what an agent actually reads, change without a version bump. | Align the headings, and drop the token for the per-ticket verify spawn. Add a registry entry hashing the templates. | DOC+CODE

**Verdict for lens R:** the main pipeline is sound and every role's commands run, but R7-1 permanently strands a ticket class that `/app-audit` creates, and R7-2 through R7-7 are prompts or tools that quietly do the wrong thing.

## Lens S

I found 13 problems in the skills and commands. Three are High: one blocks every Android/SwiftPM release, and two let an agent change records that the commands say only the orchestrator or founder may change.

**How I checked.** I built a web-app project in `/private/tmp/claude-502/audit-S/proj` and ran every command block as written. The path covered app-init's bootstrap, `/app-plan`, and two full `/app-build` rounds:
- One medium-risk ticket and one high-risk ticket. The high-risk one needed the tech-lead's second approval and the runtime gate on the wave.
- The QA ticket, its fast-forward merge onto main, and the push with no `origin` remote.

I also ran the commands in `/app-recover`, `/app-status`, `/app-audit`, `/app-ship` (only `orchestrator ship` and its prerequisite commands), `/app-memory`, `/app-incident`, `/app-risk`, `/app-schedule`, `/app-context`, `/app-capabilities`, `/app-eval`, `/app-impact`, `/app-manager-*`, `/app-dashboard` and `/app-control-room`, plus the scripts the skills cite.

**What checked clean:**
- All 32 skill and 27 command frontmatters are valid.
- `hooks.json` and the plugin manifests point at real files, and the metadata and version checks pass.
- Every script path the skills and commands cite exists (the only miss is `your-gate.sh`, an intentional placeholder in mutation-testing).
- Every `--flag` they cite is parsed by its script.
- The main build loop works end to end.

**Findings:**

S7-1 | High | V | Build caches make the project tree look dirty, which blocks the release. `scripts/build-env.sh` (sourced by `verify-done.sh:203` and `runtime-gate.sh:105`) points Gradle and SwiftPM at `.studio-cache/` in the main checkout. Its header says that folder is "gitignored so it can never be committed", but nothing ignores it: it is not in `scripts/lib/operational-paths.txt` or in app-init's step 5 `.gitignore` list. Reproduced in the fixture: with a `.studio-cache/` folder present, `orchestrator.mjs ship` reports "WORKING TREE DIRTY", approval binding UNKNOWN and the runtime result STALE; after `rm -rf .studio-cache` the dirty flag clears. The first Gradle or SwiftPM run creates the folder, so every Android or SwiftPM project hits this. → Add `.studio-cache` to `operational-paths.txt` and to app-init's `.gitignore` loop (and to the brownfield path, see S7-6). | CODE

S7-2 | High | V | Any agent can release a "Risky" audit ticket that is waiting for the founder. `/app-audit` step 4 and `/app-run --yolo` say Risky tickets are born `blocked needs-approval:` and that "deferral is the board refusing the claim, not an agent remembering not to". But `board.mjs move AUDIT-001 unblocked --by web-developer --detail "approved by the founder"` was accepted under `requireActorTokens` with no token, and `claimed` then becomes legal. The guard hook (`hooks/guard-gate-writes.sh`) let the same command through for a subagent with `--by tech-manager` (exit 0). So founder approval is just text. → Require a founder token (or the inline tech-manager token, like `reopened`) for `unblocked` on a `needs-approval:` block; until then, say in `app-audit.md` that the deferral is not enforced. | CODE

S7-3 | High | V | Any agent can rewrite a ticket's invariants, acceptance criteria, files and owner without a token. `corrected` has no token or role check (only `--test-profile` is protected, `board.mjs:1075`); `app-plan.md:112` presents it as tech-manager's route. Repro: a high-risk ticket created with `--invariant "secret never logged; wiped on signout"`, then `move APP-003 corrected --by web-developer --invariant "n/a"` → exit 0, invariants now `['n/a']`. The guard hook allows the same command from a subagent. The owner can therefore swap the invariants the reviewer checks and the acceptance criteria QA tests (both flow into `compose` prompts). → Treat `corrected` as a gate event (tech-manager token under `requireActorTokens`), or at least refuse it from the ticket's own workers. | CODE

S7-4 | Med | V | `/app-recover` step 1 misreads run-doctor. It says "Exit 0 → no attempt is live. Continue." But `run-doctor.mjs` exits 0 with "RUN DOCTOR: CLEAR — 4 attempt(s), 1 active" while a fresh claim holds a 15-minute lease. It only exits 1 once the lease expires. It also never prints the run or attempt IDs for a live lease. The suggested `run-ledger.mjs abandon --attempt <n>` needs the `ATT-<uuid>` ID (`--attempt 1` → "no active attempt 1"). `--root .` is silently ignored; the ledger is read from the current directory. → Fix the doc to "0 active → continue; N active → a lease is live, do not replace", and have run-doctor list the active `run_id`/`attempt_id`. | DOC (+small CODE)

S7-5 | Med | V | Previous finding W2-18 is still open on main. `app-build.md:425` says that with no journey declared, "rows may not move qa → done this wave". In the fixture the journey gate exited 2 (no declarations), yet QA's `qa_passed --evidence <wave test record>` and `closed` were both accepted. `compose --role qa-engineer` even hands QA that wave record as its evidence. → Have `closed`/`qa_passed` require a journey record once `docs/team/journeys/` exists or the profile declares a UI, or drop the prose rule. | CODE or DOC

S7-6 | Med | R | Existing-app projects never get the operational `.gitignore`. Only `/app-init` step 5 writes it (`.agent-wt/`, the board files, `docs/53-reviews/`, actor files). `/app-onboard`, `/app-audit`, `brownfield-onboarding` and `/app-run`'s brownfield branch have no such step. `agent-isolation/references/orchestrator.md:37` says "on an existing project add it before the first spawn", but no step does. `/app-plan` 4a's `docs/*.md` loop will then commit `docs/31-board.md` and `docs/32-board-view.md`. → Move the `.gitignore` loop (plus `.studio-cache`) into a shared step that `/app-onboard` also runs. | DOC

S7-7 | Low | V | On existing apps, audit tickets are added before the risk policy exists. `/app-run` runs `/app-audit` step 3 (`board.mjs add AUDIT-NNN`, no `--file`) before `/app-plan` 1b's `team-bootstrap`. The Risky "migrate store" ticket was stored with `risk: null` (dispatch-preflight on the same file says `high`), so the invariant check before review never applies. Merge-time diff escalation still demands the extra approvals. → Run `team-bootstrap` at the top of `/app-audit` step 3, and pass `--file` in its `add` examples. | DOC

S7-8 | Low | V | `skills/sprint-planner/SKILL.md:144` tells agents to verify with `verify-done.sh <branch> <integration-branch> "<test cmd>"`. verify-done says the board refuses a record from a caller-chosen command and records it static-only. → Use `fast` or `full`. | DOC

S7-9 | Low | V | `/app-learn` step 3 runs `team-doctor.mjs --json`. From a project directory it exits 2 with "run me from the plugin root", so the recurrence check never runs. → `cd "${CLAUDE_PLUGIN_ROOT}" && node scripts/team-doctor.mjs --json`. | DOC

S7-10 | Low | V | Two command defaults point at files a project never has. `/app-manager-harness` defaults to `eval/manager-scenario.json` (exit 2 from a project; it passes with the plugin's own path). `/app-impact` needs `docs/team/impact-map.json`, which no command, role or bootstrap writes, so it always exits 2. → Use `${CLAUDE_PLUGIN_ROOT}/eval/...`, and document or bootstrap the impact map. | DOC

S7-11 | Low | V | Memory "review" is not separated from the proposer. `memory-curator.mjs review --by tech-lead` promoted tech-lead's own proposal. `propose` is accepted with no `--by` (app-learn's own snippet omits it) and with a `--source` file that doesn't exist. This contradicts "only a named reviewer can promote" and the HANDBOOK's "explicit curator review". No prompt consumes memory yet, so impact is low. → Refuse review by the proposer, and require `--by` on propose. | CODE

S7-12 | Low | R | `app-ship.md` step 1a contradicts itself: "Do not re-run `ship-gate.sh` by hand", then the waiver bullet says "Then re-run `ship-gate.sh`", then "re-run `orchestrator ship`, not the gate alone". → Keep only `orchestrator ship`. | DOC

S7-13 | Low | V | Printed next steps point at the wrong place. `journey-gate.mjs:192/237` and `criterion-check.mjs:46` send agents to a project-relative `docs/team/journeys/README.md`, which exists only in the plugin. verify-done's static output prints `node scripts/wave-integrate.mjs` without `${CLAUDE_PLUGIN_ROOT}`. → Print the plugin-rooted paths. | CODE

Verdict for lens S: the commands and skills match the scripts, and the main build loop runs as written. The real gaps are the `.studio-cache` dirty tree (S7-1), the two unprotected write paths behind `unblocked` and `corrected` (S7-2, S7-3), and `/app-recover`'s misreading of run-doctor (S7-4).

## Lens C

Lens C found 12 problems on main (33bfab2): 4 High, 4 Medium and 4 Low. The worst is a script every agent is told to run before working, which refuses every developer and every reviewer.

**Test suite status:** my full run of `sh scripts/test.sh` (in a clone, not your repo) had not finished when I wrote this. It had passed the ship-gate, board and security sections with 0 failures so far. Your real repo was not modified (`git status` is clean).

**How I tested:** everything was run against fixture projects and a clone under `/private/tmp/claude-502/audit-C/`. V means I reproduced it by running it, R means I read the code only.

C7-1 | High | V | `scripts/test.sh` edits the plugin's own tracked files in place and puts them back only when the run finishes normally. It does this to `scripts/board.mjs` (lines 2584–2603 and 7347–7353), `scripts/runtime-gate.sh` (2240–2256), `agents/code-reviewer.md` (1716–1723) and `control-room/state.mjs` (7040–7053). The only cleanup on exit (line 91) deletes `$TMP`. Reproduced in a clone: I sent SIGTERM to a full run while the mirror test had its change in place. Afterwards `git status` showed ` M scripts/board.mjs` plus a stray `board.mjs.bak`, and `claimLease` was left as `return { ok: true }` — so board claims stop recording the lease's run_id. A timeout, Ctrl-C or a CI cancel leaves the plugin broken. Two runs at the same time in one checkout are worse. This session has many agents that may run the suite. Both runs write the same `.bak` file, so one run can save the other's damaged copy as its "backup" and restore it for good, and the other run sees false failures meanwhile. (Mechanism read, not reproduced.) `mutate.sh` already does this correctly by working on a copy. → Run every mirror test against a copy (copy the scripts into `$TMP` and run from there), or at minimum restore all five files and re-check `git status` in the exit trap. | CODE

C7-2 | High | V | `scripts/context-preflight.mjs` refuses every IC and every reviewer. The instructions run it first: `skills/ic-workflow/SKILL.md:16` puts it before step 0 (create branch), and `agents/code-reviewer.md:47` marks it `[all]`.
- In a freshly leased slot it reports `BLOCKER: detached HEAD` (slots are created detached by `worktree-slot.mjs`).
- In a slot it also reports `BLOCKER: ... docs/31-board.md is missing`. That file is an operational path, written only in the main checkout and never committed. It also reads the board view rather than the event log.
- After `git checkout -b` in the slot, the board-missing blocker remains.
- In the main checkout, where the reviewer works, it reports `BLOCKER: writing on protected branch main is not allowed` on any project whose integration branch is main.

All of these exit 1. The composed prompt says "If you are blocked, flag the blocker and stop", so an agent that follows the rules returns BLOCKED on every ticket. Separately, if `--ticket` comes first (`context-preflight.mjs --ticket APP-001`), the ticket ID is taken as the project root (exit 2). → Read the ticket through `board.mjs show --json` from the main project. Treat a detached HEAD in `.agent-wt/*` as expected before step 0. Only block writes on the integration branch for roles that write, and never for reviewers. Parse arguments with `lib/args.mjs`. | CODE (plus ic-workflow wording)

C7-3 | High | V | `scripts/worktree-slot.mjs` reads the lease file without the lock (`readState`). It then checks the pool limit and whether the ticket is already leased, picks a slot name and creates the worktree. Only the final write is locked (`writeState`, line 110). Reproduced: 4 leases started at once with `--pool 2`, each with a different owner. All four printed `LEASED ... pool 1 of 2`, four worktrees were created, and the lease file records only one. The pool limit is bypassed. The lost leases mean the "already leased elsewhere" check can't see them, so the same ticket can be leased twice. Unrecorded slots never show in `release`. → Wrap the whole lease and release sequence in `withFileLock(STATE, ...)`, including the worktree creation, as `board.mjs` does. | CODE

C7-4 | High | V | The verification-engineer prompt loses the constants and rules a reviewer routed to it whenever the verdict was REQUEST CHANGES. The reviewer writes `docs/53-reviews/<ID>-cycle-<N>.md` using the cycle count at review time (`spawn-prompt.mjs` `composeReview`). Its `changes` event then raises the count (`lib/events.mjs:502`). `composeVerify` reads `<ID>-cycle-<cycles>.md`, which is now one cycle too high. `commands/app-build.md:272–280` says to spawn the verification-engineer for routed items on every verdict, "APPROVED or not". Reproduced: a chained log ending in `changes` (cycles 1), and `APP-001-cycle-0.md` routing `MAX_RETRY=3`. The composed prompt says "The reviewer's verdict file names nothing routed — certify ... as you find them", and `MAX_RETRY` is absent. → In `composeVerify`, read the newest `<ID>-cycle-*.md` whose number is at most the current cycle count, or the file cited by the latest `approved`/`changes` event. | CODE

C7-5 | Medium | V | The integration branch can be misread, and the board then falls back to a branch nobody declared.
- `scripts/integration-branch.sh` `read_declared` takes the first line anywhere in the doc matching `integration branch <: = — – - | is>`. Prose such as "Features merge into the integration branch — never straight to main." placed before `Integration branch: main` makes the script read the branch as `never` (or `protected` for "The integration branch is protected..."). It then exits 2.
- `lib/integration.mjs` `integrationBase` treats exit 2 by quietly falling back to `develop`, `main`, `master`. Reproduced: the doc declares `main`, a `develop` branch exists, and the script says CANNOT RESOLVE while `integrationBase` returns `develop`.
- The board's `closed`/merge-risk/approval/evidence checks (`board.mjs:766,1046,1131,1136,1234,1251`, `lib/evidence.mjs`, `lib/approval.mjs`) then compare against a branch nobody declared. Meanwhile `wave-integrate`, `worktree-slot` and `spawn-prompt` refuse outright. This is the same split PR #46 was meant to close.

→ Anchor the parser to a line that starts with `Integration branch:`. In `integrationBase`, fall back only when there is no strategy doc. When the doc exists but can't be resolved, return '' (fail closed). | CODE

C7-6 | Medium | V | The spawn word budget measures less than an agent actually loads, so it understates real context and still warns on ordinary tickets. `spawn-prompt.mjs` `reportBudget` counts the prompt, the role file and the SKILL.md list. It leaves out the House KB packs that role files make mandatory and that the house-conventions skill says to load. For iOS that is `ios-conventions.md` 739 + `stack-defaults.md` 826 + `README.md` (tiers) 506 words.
- Measured: an iOS IC with no spec reports 3162 words; with the ~1.5k-word spec excerpt it reports 4689 and warns "OVER BUDGET". The real minimum is about 6.7k, before any Axiom skill — roughly 1.7 times the 4k target.
- devops-engineer reports 4378 and is over budget even with no spec, and its mandatory `context-preflight` is missing from `MANDATORY_SKILLS`.
- So the warning fires on most tickets with a real spec while still understating the true load.

→ Add the role's mandatory packs to the static map, and either raise the IC budget to match reality or cut the role and skill text. | CODE

C7-7 | Medium | V | When the spec excerpt is cut at its word limit, it loses all line breaks. `specExcerpt` does `w.slice(0, left).join(' ')`. The truncated section (typically the PRD, which comes after the platform spec) arrives as one long line, and tables, lists, acceptance criteria and code blocks are flattened. Seen in the composed prompt: "## APP-001 login The login screen must ... […truncated]". A code fence cut in half can also confuse the fences that follow. The order also spends the budget on the impl spec first and truncates the PRD acceptance text, which is the product's authority. Separately, the section split `^(?=#{1,6} )` also splits on `# comment` lines inside shell code blocks. → Truncate by lines, close any open fence, and put the PRD's acceptance section first. | CODE

C7-8 | Medium | V | The `board.mjs adopt` refusal prints a broken command. With stdin not a terminal, the message reads "a founder token is minted only..." and then `node "<plugin>/scripts/board.mjs" board.mjs adopt`. That has `board.mjs` twice and fails with an unknown command; the culprit is the regex replace at `board.mjs:1422`. The message also tells the founder to use `! node ... adopt` inside Claude Code. That works only if `!` commands get a real terminal, which the mint message itself implies they don't — "in your own terminal ... then `!` ... move" — and I did not test it. Two related problems:
- `adopt` (log lock) and `actor mint --role founder` (token-registry lock) can sit up to 10 minutes on terminal input while holding the lock. Meanwhile every other mint by `compose` or `wave-integrate` fails after 5s with exit 2 and the advice "a process died holding the lock; remove the file".
- Removing that lock file would let two writers in at once.

→ Write a dedicated message for adopt. Ask for confirmation before taking the lock and check again inside it. Say "founder confirmation pending" rather than "remove the file". | CODE

C7-9 | Low | V | Writers to the board lock wait a fixed 5s. Reproduced: 24 concurrent `board.mjs move ... claimed` gave 13 exit 0 and 11 exit 2 "could not acquire ... within 5000ms". Each claim holds the lock about 0.45s because it starts `run-ledger.mjs` inside it. Twenty-four `add`s all succeeded and the chain stayed intact, so nothing was corrupted — only refused. Realistic parallelism (3–4 agents) is fine, but a slow `merged`/`verified` holding the lock, such as `git diff --binary` on a large repo, lowers that ceiling. → Scale the timeout (e.g. 30s), since the reaper already distinguishes live from dead holders. | CODE

C7-10 | Low | R | `scripts/messages.mjs:80–109` has its own lock (a directory plus a pid file). It reaps on "pid not alive" alone, with no minimum age. That is the scheme `lib/atomic.mjs` documents as broken: two waiters that both read a dead owner can each delete the lock and both enter. `run-ledger.mjs:30–50` has a third lock with no stale reaping, so a SIGKILLed holder blocks every claim until someone deletes the file by hand. → Use `withFileLock` everywhere. | CODE

C7-11 | Low | R | `test.sh` `assert_has` uses `grep -q -- "$2"`, so needles are regexes. Any `.`, `[` or `*` in a needle matches more loosely than the label claims. `assert_exit_within` kills only the subshell (`kill -9 "$job"`), so a hung command keeps running for the rest of the suite. Separately, `ship-gate.sh:457–459` uses `\b` inside `grep -E`, which is a GNU/BSD extension that POSIX `grep -E` does not guarantee. → Use `grep -qF` by default, kill the whole process group, and replace `\b` with `([^A-Za-z]|$)`. | CODE

C7-12 | Low | R | `spawn-prompt.mjs` checks the slot path only as a warning. With no `--slot`, the default is `.agent-wt/<role>`, which no lease has created since slots became `<owner>-<n>`. `compose` still prints the prompt, telling the IC its project root is a directory that doesn't exist; only stderr warns. Also, `tokensFor` treats an unparseable `.studio-policy.json` as "no tokens" while `board.mjs` refuses it with exit 2. The spawned agent then hits a token refusal instead of the orchestrator seeing the real cause. → Make a missing slot or an unreadable policy an exit 2 in `compose`. | CODE

**Checked and fine:**
- 24 concurrent `board.mjs add` all succeeded and left the chain intact.
- The reviewer's scratch `git worktree add/remove --force` is not blocked by the guard hook.
- `mutate.sh` works on a copy and checks the real tree on exit.
- `verify-done.sh` handles its exit status correctly.
- IC, reviewer and tech-lead prompts are within budget when there's no spec excerpt and no KB pack (C7-6 covers the full picture).

**Side note for the guard reviewer (not my lens):** the installed 3.1.0 guard hook blocked two of my fixture commands in `/private/tmp`. One was an ordinary `git branch -M main`. The other was `git add .` in a directory that didn't exist yet when the hook ran, which the hook judged against some other tree with "1 uncommitted path(s)".

Verdict (lens C): the core locking of the board itself holds up, but the lease file, the context preflight and verification-engineer routing fail under normal use, and the test suite can leave the plugin's own code modified.
