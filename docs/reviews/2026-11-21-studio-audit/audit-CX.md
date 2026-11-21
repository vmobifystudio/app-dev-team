# Audit CX — context management and communication (main f62f5a1, 2026-11-21)

CX-1 [High] A question an IC sends from its worktree lands in the worktree's own copy of the ledger. Nobody sees it, and it is deleted when the slot is reaped.
**Where:** `scripts/team-message.sh:67` (`ROOT=$(git rev-parse --show-toplevel)`). Compare `board.mjs` and `context-preflight.mjs:39-41`, which both resolve the main checkout through `--git-common-dir`.
**What happens:** In a scratch project I leased `.agent-wt/android-developer-1-1` and ran `team-message.sh --from android-developer --to tech-lead --ticket APP-102 --kind question …` from inside it. It printed `SENT: MSG-0001`, then `ledger -> …/.agent-wt/android-developer-1-1/docs/team/messages.md`, then "keep working while you wait". In the main checkout, `messages.mjs open --count` returned `CANNOT EVALUATE — no ledger`. Also, `docs/team/messages.jsonl` is not in app-init's `.gitignore` list (`commands/app-init.md:86-92`, only `messages.md` is), so the slot copy can get committed onto a ticket branch.
**Why it matters:** Every IC runs in a slot, so every question it sends this way is lost. Mid-sprint Q&A (`app-build` step 1b) reads the main ledger and finds nothing. The IC's report then says "sent MSG-0001" while the main ledger has no such row, and `app-build:242-245` tells the orchestrator to re-file it by hand.
**Fix:** In `team-message.sh`, resolve `ROOT` as `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`, the same way board.mjs does. Also add `docs/team/messages.jsonl` to the app-init ignore list.

CX-2 [High] There is no working way for a dev to ask tech-lead a question mid-ticket and get an answer. A real `BLOCKED` goes to the founder, and an answer never reaches the agent that asked.
**Where:** `skills/team-protocol/SKILL.md:59-74`, `commands/app-build.md:535-538`, `skills/team-protocol/references/mid-sprint-qa.md`, `scripts/spawn-prompt.mjs` (it never reads `messages.jsonl`; grep confirms), `skills/ic-workflow/SKILL.md:26-30,96`.
**What happens:**
- team-protocol tells the IC: "it cannot wait for an answer inside its own run". So it either assumes or blocks.
- `app-build` Safety handles `BLOCKED` by surfacing it to the user, appending `blocked` and stopping the ticket. It does this even when `Need:` names tech-lead. Nothing routes it to tech-lead.
- tech-lead only answers in the next round's batch (step 1b), after the asker has already returned DONE. The answer must fold into a spec (`--artifact`; I reproduced the `REFUSED (obligation_missing)` without one).
- No composed prompt carries the answer: not the IC retry or rework prompt, and not the reviewer prompt, which therefore cannot check that the answer was followed.
- The agent gets three different block procedures:
  - ic-workflow:30 says write the blocker to the fragment, "then exit" (with no contract block).
  - ic-workflow:96 says "write a blocker and stop".
  - The composed prompt says "flag the blocker and stop" and return the `BLOCKED:` block.
  - team-protocol says ask a question and keep working.
**Why it matters:** Every spec ambiguity ends in one of two ways. Either it is guessed silently (the `ASSUMED, NOT RAISED` row gets answered after the code is built, and only the open count is checked, not whether the code matches the answer), or it needs the founder, which the brief forbids. Everything goes through the orchestrator, and the answer still does not reach the code.
**Fix:**
1. In app-build Safety, handle a `BLOCKED` whose `Need:` names tech-lead, ux-architect or product-manager without the founder: spawn that role once with the question. It answers with an `answer` row plus a committed spec edit. Then continue the IC, either with `SendMessage` to its agent id (the harness supports this, and the IC keeps its warm context) or by re-composing.
2. In `composeIc` and `composeReview`, inline the `answer`/`decision` rows for that ticket from `messages.jsonl`, about 10 lines.
3. Change ic-workflow:30 and :96 to "return the `BLOCKED:` block".

CX-3 [High] When an IC is re-spawned on a ticket whose branch already exists, the prompt tells it to `git checkout -b` that branch again, and it drops the reason for the re-spawn.
**Where:** `scripts/spawn-prompt.mjs:386-432`. Only `--retry` (review) and `rework` (wave) are handled. Callers: `app-build.md:237` (REJECTED: "re-spawn the developer with the blocking lines verbatim"), `:192` (report-check INCOMPLETE), `:535` (BLOCKED then later `unblocked`).
**What happens:** I made the branch `feat/APP-101-repo` and recorded `claimed`, `done_reported`, `rejected --detail "no commits"`, then composed. The prompt said `git -C <slot> checkout -b feat/APP-101-<short-slug> main` and did not mention the rejection. I got the same result after `blocked` followed by `unblocked`. Meanwhile parallel-orchestrator step 3 says to use compose output "verbatim", so the "blocking lines verbatim" from app-build:237 have nowhere to go.
**Why it matters:** These are the most common retries. The re-spawned agent either hits "branch already exists" or picks a new slug. A new slug leaves the ticket with two branches, and every branch lookup after that refuses as ambiguous. This is the same defect class as PR47-5, still open on the three other retry paths.
**Fix:** In `composeIc`, whenever `ticketBranch(ROOT,row.id).branch` already exists, use the "check out your existing branch" start (generalise the rework branch at :405), and inline the detail of the latest `rejected` or `blocked` event. That is about 6 lines.

CX-4 [High] `/app-run` has no resume path. When it is re-entered, it treats the in-progress studio project as a brownfield app.
**Where:** `commands/app-run.md:14` ("Wrap this command in `/loop`"), `:34-50` (step 1 detection), and `skills/brownfield-onboarding/SKILL.md:17-25`, which detects an app from `settings.gradle*`, `app/build.gradle` or `docs/`, then step 2 rewrites `docs/20-architecture.md` and `docs/10-prd.md` "describing what exists". Only `app-build.md:11-14` has a compaction or resume note. app-run has none (grep).
**What happens:** I checked this by walking the command text, not by spawning an agent. A `/loop` iteration, or a re-read after compaction, starts again at step 1. The project now contains the studio's own `app/` and `docs/`, so the detection picks "Existing app → brownfield", which runs `/app-onboard` and `/app-audit`. Those reverse-engineer and overwrite the PRD and architecture. Gate 1 approval is persisted (`app-init.md:238`, `docs/00-vision.md ## Scope lock`), but app-run never checks it.
**Why it matters:** The orchestrator holds about 14k words of command text alone (app-run 1873, app-init 2391, app-plan 1590, app-build 4498, app-ship 4052) before any ticket. Compaction is effectively certain on a real run, and the documented `/loop` mode re-enters on every iteration.
**Fix:** Add a step 0 to app-run: if `docs/31-board-events.jsonl` exists, this is a run in progress, so do not run step 1 or 2. If `## Scope lock` is in `docs/00-vision.md` and the board has rows, go to step 4 (`/app-build` from its step 0); if there are no rows, go to step 3. Also add the same "nothing you remember is state" header that app-build has.

CX-5 [Medium] The orchestrator's context grows by roughly 5k tokens per ticket per cycle, and the loop's budget counters live only in that context.
**Where:** `commands/app-build.md:495-505` (round-journal `--spawns/--retries/--refusals` are counted from memory), `:146-151` (`$BEFORE` has to be remembered literally), `scripts/orchestrator.mjs:428` (and similar narrative text in report-check and verify-done output).
**What happens:** Measured in the scratch project, for one ticket and one review cycle:
- the IC compose output is 893 words, read once from stdout and written again as the Agent prompt;
- the reviewer prompt is 412 words, or about 650 with the DONE report, and is also paid twice;
- verify-done prints 140 words, report-check prints 135 on failure, and the returned DONE plus verdict is about 550.
That is about 3.9k words, or about 5.2k tokens. Every round also prints `orchestrator round` (291 words, including a history paragraph, "Across every recorded run, 11 of 19 tickets…", each round) and `board show --json` (about 75 words per ticket, re-read each round). A 20-ticket sprint lands around 140k tokens plus about 25k of command and skill text, so it compacts. After compaction the spawn, retry and refusal counts that feed `round-journal check`, the only economic brake, are reconstructed by guesswork.
**Why it matters:** Compaction is likely to land mid-loop. The budget ceiling then rests on counts the orchestrator has to make up after the fact.
**Fix:**
1. Have the SubagentStop hook append one line per app-dev-team agent stop to `docs/team/spawns.jsonl`, and have `round-journal check` count spawns and retries from it instead of `--spawns`.
2. Have `messages.mjs open --was` read the previous round's count from that log, so `$BEFORE` does not have to be remembered.
3. Move the history paragraphs in repeated CLI output behind `--verbose`.

CX-6 [Medium] Reports are structured, but nothing drives the next step from them. Each DONE costs about 8 manual orchestrator steps, and one check is done twice.
**Where:** `commands/app-build.md:181-269`. Line 246 checks the daily fragment again by hand, which `report-check --root` (`scripts/report-check.mjs:97-112`) already verifies with `git show`.
**What happens:** For each DONE the orchestrator hand-runs:
- report-check;
- `done_reported`;
- integration-branch plus verify-done;
- the outcome table, which picks `verified`, `rejected` or `verified_static`;
- a Shared-surfaces read;
- a grep of the ledger for each assumption;
- the fragment check;
- `review_requested`;
- the reviewer compose.
Every step is skip-prone, and every step's output lands in orchestrator context.
**Why it matters:** This is the busiest path in the loop, and it is manual. It is the same "convention, not mechanism" failure C10 fixed for spawns.
**Fix:** Add one `orchestrator.mjs intake <ID>` that runs report-check, `done_reported`, verify-done, the matching verify event and `review_requested`, prints the assumptions to route and the reviewer compose command, and exits 1 with the exact re-spawn compose on any refusal. Delete app-build:246-248.

CX-7 [Medium] The context manifest does not hash the files ICs actually build from. And tech-lead's answers are written into specs that the slots cannot see.
**Where:** `scripts/team-bootstrap.mjs:233-234`. The candidates are vision, PRD, backlog, architecture, flows and principles. They do not include `22-impl-spec-*`, `13-design-tokens`, `14-components`, `40-api` or `52-analytics`. Related: `app-build.md:96-99`, `agents/tech-lead.md:24-25` ("fold the answer into `docs/22-impl-spec-*.md`"; no step commits it).
**What happens:** I ran team-bootstrap, then appended a Q&A answer line to `docs/22-impl-spec-android.md`. `context-manifest verify` returned `FRESH`, and `dispatch-preflight` returned `CLEAR`. The reviewer's `--bind --context` binds to this same manifest. Separately, compose builds its excerpt from the main checkout's working tree, so it would show the uncommitted answer. But the slot is branched from the committed base, and its "authoritative full file" does not contain the answer.
**Why it matters:** The freshness check, and the "context reviewed" part of the approval binding, cover nothing an IC codes against. On top of that, the excerpt and the full file can disagree.
**Fix:** Add the five files above to the candidates. In mid-sprint-qa, have tech-lead commit the spec edit to the integration branch, then run `team-bootstrap --context-only`. Otherwise, delete the context leg from dispatch-preflight and `--bind`.

CX-8 [Medium] The spec excerpt works at section level, so a shared acceptance-criteria section or feature table puts every ticket's criteria into every IC prompt.
**Where:** `scripts/spawn-prompt.mjs:186-206`.
**What happens:** On the medication-companion docs, APP-101 (F-001) got 586 excerpt words out of an 893-word prompt. That included all 7 `[AC-00n]` lines, 6 of which belong to other features, and the whole feature table, all under the heading "only the sections that name this ticket". The ux-architect prompt shows the same thing (557 of 824 words).
**Why it matters:** Each IC spends extra tokens, and the prompt invites scope creep into sibling tickets' acceptance.
**Fix:** Inside a matched section, keep the heading plus only the table rows, list items and `[AC-…]` lines that match a token. Keep prose paragraphs whole.

CX-9 [Medium] The prompt registry is over-engineered: its fields are written and never read, and its policy flag cannot be satisfied on an app project.
**Where:** `docs/team/prompt-registry.json:3-9,…` and `scripts/prompt-registry.mjs`, `scripts/team-doctor.mjs:295-335`, `scripts/ship-gate.sh:262-263`, `commands/app-init.md:162-164`.
**What happens:**
- `version`, `rollback_version` and `eval_suite` are read by nothing except the script and test.sh (grep).
- `validated_on` is just the sync date, set without any eval run.
- `requirePromptRegistry` is a project policy flag, but app-init itself says a project has no `agents/` directory, so it can never pass.
- The registry's precedence order (constitutional, project, ticket, role, retrieved) contradicts context-manifest's and `/app-context`'s (constitutional, role, project, ticket, retrieved; `commands/app-context.md:32`).
- Every edit to `spawn-prompt.mjs` or a role file forces a sync commit, or team-doctor fails.
**Why it matters:** It costs time and tokens and catches no real failure.
**Fix:** Delete it: `prompt-registry.mjs`, the JSON, the `requirePromptRegistry` branch and team-doctor §2e. Git history already versions prompts.

CX-10 [Medium] Delete the manager harness and failover scripts, which are ceremony; app-run tells the orchestrator to run the harness.
**Where:** `commands/app-run.md:116-117`, `scripts/manager-harness.mjs`, `scripts/manager-failover.mjs`, `commands/app-manager-harness.md`, `commands/app-manager-failover.md`.
**What happens:**
- The harness replays the fixed `eval/manager-scenario.json` through a toy reducer and compares the result with itself. It always returns PASS and says nothing about the real session.
- Failover looks for `role: tech-manager` attempts in `runs.jsonl`, but only owners' ticket claims are ever written there. In the scratch project it returned `{"decision":"FAILOVER",…"manager has no active attempt"}`, and it always will.
**Why it matters:** It looks like a handoff or recovery mechanism but isn't one. The real recovery is the files plus the app-build resume header.
**Fix:** Delete both scripts and both commands, and app-run:116-117.

CX-11 [Low] Instructions that are stale or contradict the composed prompt.
**Where and what:**
- `commands/app-build.md:521-522` and `skills/parallel-orchestrator/SKILL.md:53-55` say compose puts the destructive-git ban in every prompt. It doesn't: I grepped all 8 composed prompts and found none. The hook enforces the ban, so delete the claim.
- `agents/android-developer.md:32`, `ios-developer.md:35` and `backend-developer.md:44` say "Your repo is `/android`" (and `/ios`, `/backend`). The prompt says the slot is the root, and every Android dry run puts `app/` at the repo root. Delete the line.
- `skills/ic-workflow/SKILL.md:26` says the IC is given "its entry in `docs/31-board.md`", which is gitignored and missing in a slot. The prompt carries the row, so change the text to say that.
- `skills/context-preflight/SKILL.md`:
  - Step 3 has every spawn read architecture, principles and git strategy, while the prompt says to read only what the ticket touches.
  - Its "Return: `PREFLIGHT:`…" section competes with the DONE contract.
  - Fix: make step 3 "what your prompt names", and its output "a NOTE in your daily fragment".
- `scripts/spawn-prompt.mjs:138-139` counts `team-protocol` (1196 words) as mandatory for security-reviewer and release-auditor, but their role files say it is conditional (`release-auditor.md:18`, `security-reviewer.md:19`). That overstates their budget. Remove it from MANDATORY_SKILLS.

CX-12 [Low] The destructive-git hook blocks text that only mentions `git add -A`, even inside a heredoc.
**Where:** `hooks/block-shared-tree-destructive-git.sh`. RESUME claims heredocs are tokenised.
**What happens:** From the plugin tree, `cat > $TMPDIR/…/setup.sh <<'EOF' … git add -A … EOF` was BLOCKED ("repo-wide destructive git command") even though the command only writes a file elsewhere.
**Why it matters:** It costs any agent or auditor a retry whenever it writes a script that merely mentions the banned command.
**Fix:** Skip heredoc bodies when tokenising.

## Measured spawn loads

Words: prompt + role file + mandatory skills + KB packs = total. The part repeated identically on every spawn is everything except the prompt.

| Role | Prompt | Role file | Skills | KB packs | Total | Repeated share |
|---|---|---|---|---|---|---|
| android-developer | 893 | 525 | 2689 | 1519 | 5626 | 84% |
| ux-architect | 824 | 864 | 1409 | 739 | 3836 | 78% |
| devops-engineer | 336 | 1813 | 2689 | 1920 | 6758 | 95% |
| code-reviewer | 412 | 2275 | 1751 | 739 | 5177 | 92% |
| tech-lead | 435 | 1286 | 1236 | 739 | 3696 | 88% |
| security-reviewer | 422 | 1685 | 1858 | 1094 | 5059 | 92% |
| verification-engineer | 212 | 1440 | 3045 | 739 | 5436 | 96% |
| release-auditor | 70 | 811 | 3408 | 1094 | 5383 | 99% |

Every load is within its budget. Multiply by about 1.35 for tokens.

## Top 3 blockers to an autonomous end-to-end ship
1. CX-1 and CX-2: dev to tech-lead Q&A does not work. Questions vanish into slot ledgers, a `BLOCKED` goes to the founder, and answers never reach the code.
2. CX-3: every common re-spawn (verify-done REJECTED, report-check INCOMPLETE, unblocked) re-runs `checkout -b` on an existing branch, which splits the ticket into ambiguous branches.
3. CX-4: `/app-run` re-entered after compaction or through `/loop` re-detects its own project as brownfield and overwrites the plan.

## Checked and genuinely fine
- All 8 compose templates inline their contract, and `spawn-prompt verify` passes each one.
- The SubagentStop hook persists IC and gate reports under `docs/team/reports/`, which survives compaction.
- The reviewer prompt carries the DONE report, branch tip, bound range, verdict path and record commands verbatim.
- The `--retry` and rework prompts inline the verdict or failure verbatim and land on the existing branch.
- Refusing an `answer` that names no artifact is a good rule: it forces answers into the specs.
- The app-build resume header ("nothing you remember is state") is the right model.
- The per-spawn word budget is printed on every compose and is accurate.

Scratch work is in `$TMPDIR/studio-audit-cx/`: the project is `proj/` and the composed prompts are in `out/`. The setup script is (session scratchpad). I made no edits to the repo.
