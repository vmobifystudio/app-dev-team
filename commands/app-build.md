---
description: Run the sprint — launch developer agents in parallel, review each PR, gate to QA, surface bugs back into the loop
argument-hint: [ticket IDs, optional — defaults to all ready tickets]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent, Skill
---

# /app-build — Execute the sprint

Tickets (optional, default = all ready): $ARGUMENTS

**Resuming after a context compaction, or unsure where you are?** Nothing you remember is state.
Re-read this file, then run `orchestrator.mjs round` (step 0) and
`node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json`; the event log, the ledger and
`docs/team/reports/` say what happened. Never re-derive a verdict, a token or a base from memory.

Rare branches (legacy boards, the verify-done exit-2 causes, the cycle cap, high/critical risk, the
utility tier, runtime and journey gate edge cases, the QA ticket, journal fields) are in
`${CLAUDE_PLUGIN_ROOT}/skills/parallel-orchestrator/references/build-loop-branches.md`. Each step
below names the section when you need it; read nothing from it otherwise.

Before claiming any ticket, `QA-` included, run the unified dispatch gate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-preflight.mjs" \
  --root <project> --ticket <ID> --context docs/team/context-manifest.json \
  --schedule docs/team/schedule.json --capability docs/team/capabilities.json \
  --risk docs/team/risk-policy.json \
  --role <role> --operation write --path <changed-path> --file <changed-file> --change <summary>
```

It composes context freshness, scheduler admission (`--ticket` must be in the scheduler's own `ready`
set), capability allowlisting and blast-radius routing. A failed or unavailable check stops the
spawn and is reported to the manager.

## How this loop writes the board

Every status change is an append to `docs/31-board-events.jsonl` through one command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move <ID> <event> --by <role> [--detail "..."]
```

`docs/31-board.md` is regenerated from that log on every append. **Never edit a cell.**

| Step | Situation | Event |
|---|---|---|
| 2 | a developer picks the ticket up | `claimed` |
| 3 | developer returns `DONE: APP-NNN` | `done_reported` |
| 3 | `verify-done.sh` VERIFIED / REJECTED / CANNOT EVALUATE | `verified` / `rejected` / `verified_static` |
| 3 | routed to review | `review_requested` (`--detail "-> code-reviewer"`) |
| 3 | reviewer begins | `started` |
| 4 | `REVIEW VERDICT: APPROVE` / `REVIEW VERDICT: REQUEST CHANGES` | `approved` / `changes` |
| 4 | merge gate clears (you run it inline) | `merged` |
| 5 | QA verdict (QA writes it) | `qa_passed` / `qa_failed`, then `closed` (a `QA-` ticket: `merged` → `closed`) |
| any | stopped, for any reason | `blocked`, later `unblocked` |
| cap | founder grants one more review cycle | `reopened` (`--by founder`, run by the human) |

**Tokens.** Under `requireActorTokens` every gate event — `verified`, `verified_static`, `rejected`,
`approved`, `changes`, `merged`, `qa_passed`, `qa_failed`, `closed`, `reopened` — needs `--token`.
Agents get theirs from `compose`. Yours you mint **inline, in the same command** (shell variables do
not survive between Bash calls), as every orchestrator gate command below does:

```bash
--token "$(node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" actor mint --role tech-manager --ticket APP-NNN)"
```

Never mint for a role an agent should prove, never paste a token into another agent's prompt, never
mint a `founder` token. Below, `<TOKEN>` stands for that line.

**Exit `1` is a refusal, and a refusal is a finding.** The CLI prints why and what is legal from
here. Do not retry it, do not work around it, do not touch the Markdown: surface it verbatim in the
standup and fix the thing it names. Exit `2` means the log is missing or unreadable: **that is
CANNOT EVALUATE, not an empty board.** Stop the round.

## Steps

0. **Run every mechanical precondition as ONE command, before spawning anything.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.mjs" round
   ```

   It composes the **board doctor** gate, the **budget** ceiling (`round-journal.mjs check`), the
   **toolchain** check, the read-only worktree reap, and prints **what is legal now**. It is
   READ-ONLY.

   - Exit `0` → every precondition CLEAR; it prints the legal transitions per ticket. Continue.
   - Exit `1` → **BLOCKED. Spawn nobody this round.** It names the precondition: an incoherent board
     (repair it with `tech-manager`, then re-run), a reached ceiling or the emergency stop (raising a
     ceiling is the user's decision, never a workaround — ceilings come from `--max-rounds` /
     `--max-spawns` / `--max-retries` / `--max-spend-usd` or `APP_TEAM_MAX_*`), a declared tool at
     the wrong version, or the disk ceiling.
   - Exit `2` → **CANNOT EVALUATE. Also not a pass.** Usually no board yet (`/app-plan` first), or
     no `docs/team/project-profile.json`. Supply what it names.

   The context manifest taken at `/app-plan` stays FRESH across merges. Preflight says
   `STALE: source changed` → a spec moved under the plan: confirm the change with its owner, then run
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/team-bootstrap.mjs" --root . --context-only` and recompose
   the affected prompts.

   No event log but a hand-written `docs/31-board.md`? → `build-loop-branches.md` §Step 0.

   **The `GATE` lines in its output have a closed role list** — never route around them.
   `orchestrator explain <TICKET>` says why any transition is refused.

1. **Read state.** Step 0 printed the legal transitions and the `REGISTER` block. The one board
   read is `board.mjs show --json`, which step 2's `parallel-orchestrator` picks ready tickets from
   (`todo`, every `dependsOn` **merged**, `qa` or `done`) — run it once, there.
   - **The register — every bug and audit finding, with a status that is never blank.**

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . import-bugs --by tech-manager
     ```

     It folds `docs/51-bugs.md` into `docs/90-register.jsonl`; exit `2` before QA's first pass just
     means `docs/51-bugs.md` does not exist yet. Open items are a mid-sprint **report**, a **refusal**
     at ship. For every open `S1`/`S2` with no ticket, cut a `BUG-NNN-fix` row (`board.mjs add ... --depends <the original
     ticket>`) and link it:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . link BUG-007 --ticket BUG-007-fix --by tech-manager
     ```

     An item with **no ticket** is the one to act on: nothing on the board will ever pick it up.

1a. **Route the finished wave's assumptions into the ledger.** Each `ASSUMED, NOT RAISED` line in a
   returned agent's `Assumptions & open questions` becomes a real `question` row, filed on its behalf:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/team-message.sh" \
      --from <the agent> --to tech-lead --ticket APP-NNN --kind question \
      --summary "<the assumption, as a question>" --body "<what it decided and why>"
   ```

1b. **MID-SPRINT Q&A — answer last round's guesses before this round inherits them.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages-render.mjs" docs/team/messages.jsonl --board docs/31-board.md
   ```

   The `OPEN QUESTIONS` block **is** the batch — do not re-derive it. Empty, or exit 2 (no ledger yet,
   normal in round 1) → step 2. Otherwise spawn `tech-lead` **once** with the whole batch — never once
   per question or per ticket — and prove the batch answered something:

   ```bash
   BEFORE=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --count)
   # ... spawn tech-lead ONCE with the whole batch ...
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --was "$BEFORE"
   ```

   (`$BEFORE` does not survive between Bash calls: note the count it printed and pass it literally.)
   Exit `1` → **the batch answered nothing** (prose, not ledger rows): re-spawn `tech-lead` requiring
   one `answer` row per question it can settle and ONE `escalation` for the rest, and do not proceed
   to step 2. Contract: `skills/team-protocol/references/mid-sprint-qa.md`.

2. **Spawn developers in parallel — run the `parallel-orchestrator` skill.** It is the one copy of
   the launch procedure: preflight and claim each ticket, lease one slot **per ticket**
   (`<owner>-<n>`, up to the scheduler's cap), check file overlap, compose each prompt with
   `spawn-prompt.mjs compose`, run `spawn-gate.sh <slots>` (also the `.studio-stop` kill switch — you
   never clear it yourself), then launch in a **single assistant message** one spawn per ticket —
   `compose` takes exactly one `--ticket`, and a PreToolUse hook re-checks each prompt. Each IC
   branches from the integration branch `compose` prints, never from its slot's last HEAD. A
   refusal at any of those steps means **spawn nobody** for what it names.

   **Spawn by the ticket's `Owner` column — never from a hardcoded list.** The authority is
   `board-doctor` and the `BUILD_SPAWNABLE_OWNERS` set in `${CLAUDE_PLUGIN_ROOT}/scripts/lib/board.mjs`; `team-doctor.mjs`
   fails the build if this list and that set disagree: `ios-developer`, `android-developer`,
   `backend-developer`, `monetization-engineer`, `ux-architect`, `product-designer`,
   `product-manager`, `product-researcher`, `qa-engineer`, `data-analyst`, `devops-engineer`,
   `aso-specialist`, `web-developer`, `test-automation-engineer`, `verification-engineer`. **Do not
   copy this roster into any file `team-doctor` does not check** — an unchecked copy drifts.

   **`docs/02-team-roster.md` says which roles exist on this project** (`role-activation`). A ticket
   owned by an `off` role is a planning defect — surface it to `tech-manager` to re-own or close,
   naming the roster reason. A `conditional` role becomes spawnable the round its trigger is met;
   amend its roster row then. Spawn `backend-developer` only when backend is in scope per
   `docs/20-architecture.md`, `web-developer` when there is a browser surface. `security-reviewer`,
   `code-reviewer`, `release-manager`, `tech-lead` and `tech-manager` gate and coordinate — they never
   own a ticket (`owner_not_spawnable`).

3. **Streaming review.** As each developer agent returns `DONE: APP-NNN`:
   - **Check the report satisfies its contract BEFORE you believe any of it.** The SubagentStop
     hook has already saved it to `docs/team/reports/<ticket>-<UTC>.md` and sent an incomplete one
     back once. Run report-check on the newest (`[0-9]` after the ID, so `APP-001` never picks up
     `APP-001-analytics`):

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/report-check.mjs" --role <owner-role> \
       --report "$(find docs/team/reports -name 'APP-NNN-[0-9]*.md' | sort | tail -1)" --root .
     ```

     Exit `1` → **the DONE is not actionable.** Re-spawn the agent for the missing fields; **never
     fill them in yourself.** **`--root` is not optional**: it checks claims against git
     (`git show <branch>:<path>`), not just their presence; `FALSE CLAIM` names, e.g., a daily
     fragment that was never committed — re-spawn the agent to stage and commit it.
   - **Record the claim as a claim**, before checking anything — `review_requested` is refused
     without a `verified` after the last `done_reported`:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN done_reported --by <owner-role>
     ```
   - **Verify the claim.** The base is the integration branch, resolved from the project's git
     strategy — never a hardcoded `main`:

     ```bash
     BASE=$(sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh") \
       || { echo "$BASE"; echo "STOP: integration branch unresolved"; exit 2; }
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" --static
     ```

     **If `integration-branch.sh` exits 2, STOP the round** and surface its message (`$BASE` holds
     it) — do not verify, do not merge: any substitute base is a guess, and a wrong-branch merge is
     not recoverable. Resolve it the same way in every later Bash
     call (the variable does not survive between calls).

     **`--static` is the default per-ticket lane.** It verifies what a branch can answer — exists,
     has commits, changed files, the diff is this ticket's — and exits **2**, because the suite has
     not run. Record `verified_static`: it unlocks review, approval and the merge gate, refuses
     `closed`, and blocks `ship-gate.sh`; step 5's wave pass earns the real `verified`. Per-ticket
     `fast` tests → `build-loop-branches.md` §Step 3.

     **For a ticket whose deliverable is a document, not code, pass `--docs-only` instead of a test
     command** — tickets owned by `ux-architect`, `product-designer`, `product-manager`,
     `product-researcher`, `qa-engineer`, `aso-specialist`, `data-analyst`, or `verification-engineer`:

     ```bash
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" --docs-only
     ```

     Branch, commits and changed files are still verified; only the test requirement is lifted.

     The three outcomes — the one copy of this table:

     | Line 1 | Exit | Do |
     |---|---|---|
     | `VERIFIED` | 0 | `board.mjs move APP-NNN verified --by tech-manager --evidence <verify-done's "Evidence:" path> <TOKEN>` — refused without the record. `tests=unverified` → say so in `--detail` |
     | `REJECTED` | 1 | `board.mjs move APP-NNN rejected --by tech-manager --detail "<the blocking line>" <TOKEN>`, re-spawn the developer with the blocking lines verbatim. The row stays `in_progress`; a **developer** retry, not a review cycle — it does not count toward the cap |
     | `CANNOT EVALUATE` | 2 | `board.mjs move APP-NNN verified_static --by tech-manager --evidence <its --static record> <TOKEN>`. **Do not re-spawn the developer** — `build-loop-branches.md` §Step 3 for its two causes |
   - **Read `Shared surfaces touched`.** Two returning agents naming the same file, or both
     *creating* an abstraction for one concern → `tech-manager` **now**, before the merge gate, picks
     one shape; re-spawn the loser with the winner named.
   - **Verify `Assumptions & open questions` against the ledger.** Every question the agent says it
     raised must have its record on `docs/team/messages.jsonl`. A missing record is a report defect:
     file it yourself and say so in the standup. `ASSUMED, NOT RAISED` just needs
     routing (step 1a).
   - **Check the daily fragment exists** at `docs/daily/<today>-<role>-<ticket>.md` on the branch —
     that exact spelling (`team-protocol`'s canonical paths). Missing → ask that agent for it before
     moving the row; never write it on their behalf.
   - Route it to review — status, reviewer and ledger row in one write; the reviewer is read out of
     the `--detail` arrow:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN review_requested \
       --by <owner-role> --detail "-> code-reviewer"
     ```

     A refusal means no `verified` landed for the current `done_reported` — go back; do not route.
   - **The reviewer must not be the owner.** For a ticket owned by `code-reviewer` (or review of
     review work), route to `tech-lead`. The CLI refuses `approved` from the ticket's owner.
   - Spawn a `code-reviewer` for that branch immediately — do not wait for the other devs. Its
     prompt is `spawn-prompt.mjs compose --root . --ticket APP-NNN --role code-reviewer`, verbatim —
     no `--slot`: reviewers lease none and stay in the main checkout. It carries the saved DONE report, the branch tip, the base, the verdict contract, the `--bind`
     evidence/context paths and that agent's minted `Token:` line; the hook refuses a reviewer
     prompt without them. On a floor/light track pass `model: sonnet` (the Agent tool's `model`
     parameter). The same compose rule holds for every gate role — `tech-lead`,
     `security-reviewer`, `verification-engineer`, `release-auditor` and `--mode design-qa` lease
     no slot either; `qa-engineer` commits a branch, so it does. Reviewers run in parallel with each other and with still-running
     developers. It appends `board.mjs move APP-NNN started --by code-reviewer` when it picks the
     ticket up.

4. **Process reviewer verdicts.**
   - **Read the two routing fields on every verdict, `APPROVED` or not:**

     ```
     Constants routed to verification-engineer: <which, or "none in this diff">
     Rules routed to verification-engineer: <which, or "none in this diff">
     ```

     If either names anything, **spawn `verification-engineer` for that ticket before the merge
     gate** (`compose --role verification-engineer`), with the named constants and rules verbatim.
     Its `VERIFICATION: PASS` / `VERIFICATION: FAIL` gates the merge **alongside** the review
     verdict: `FAIL` blocks exactly as a `REQUEST CHANGES` does — write
     `docs/53-reviews/APP-NNN-cycle-N-verification.md` as a FAIL file (below) with the `VERIFICATION: FAIL`
     findings, record `board.mjs move APP-NNN changes --by tech-manager --verdict <that file>
     <TOKEN>`, and re-spawn the developer. A verdict missing either field goes back to the reviewer
     — a missing field is never "none". It fires only when the reviewer flags one; never spawn it
     per ticket "to be safe".

     **A FAIL file** — verification or design QA — has a fixed shape, because `--verdict` parses it:

     ```
     REVIEW VERDICT: REQUEST CHANGES
     Scope: <base>..<head>
     <the FAIL detail: VERIFICATION: FAIL or DESIGN QA: FAIL — <n> item(s), and each finding>

     ## Not checked
     <what this pass did not look at>
     ```

     Line 1 exactly, line 2 the scope. It counts toward the 2-cycle cap like any `changes`.
     Name it `APP-NNN-cycle-N-verification.md` or `APP-NNN-cycle-N-design-qa.md`, never the
     reviewer's own `APP-NNN-cycle-N.md` (R7-10).

   - **The `design-qa` gate — a pass, like code review, not a role.** Run it on every ticket whose
     branch changes a user-facing surface, in parallel with code review and before the merge gate,
     against `docs/12-flows.md` and `docs/14-components.md`:
     1. **Implementation versus design** — the built screen matches the composition.
     2. **Component consistency** — built from `docs/14-components.md`; no unrecorded one-off
        (`design-system`).
     3. **State completeness** — **every** state the flow inventory lists: empty, loading, loaded,
        error, offline, and any product-specific one.
     4. **Responsive behaviour** — smallest and largest supported size, largest font scale, no
        clipping or overlap.
     5. **Accessibility implementation** — `accessibility-gate`, run against the build.

     **Who runs it: `ux-architect`, or `code-reviewer` when `ux-architect` is off** — composed with
     `compose --ticket APP-NNN --role <that role> --mode design-qa`; its first line is `DESIGN QA:`.
     On the utility tier the reviewer runs it inside its review — no separate spawn.
     **Never `product-designer` on its own design** — the designer must not be the only agent
     approving its fidelity.
     Verdict `DESIGN QA: PASS` or `DESIGN QA: FAIL — <n> item(s)`; a `FAIL` is persisted as a FAIL file,
     recorded with `board.mjs move APP-NNN changes --by tech-manager --verdict <that file> <TOKEN>`,
     and the owner is re-spawned.
   - `REVIEW VERDICT: APPROVE` (and `VERIFICATION: PASS` if one was required) → the reviewer appends
     `board.mjs move APP-NNN approved --by code-reviewer --verdict docs/53-reviews/APP-NNN-cycle-N.md`
     with its own token — plus `--bind --evidence <path> --context <path>` when `.studio-policy.json`
     sets `requireApprovalBinding` (the `/app-init` default). The append is refused if the verdict
     file is missing, lacks `REVIEW VERDICT:`, contradicts the event, or lacks `Scope:` or
     `## Not checked` — have the reviewer finish the document (it stays in the main checkout,
     uncommitted — `docs/53-reviews/` is an operational path). **Then run the merge gate yourself,
     inline — do not spawn `tech-manager` for it:**

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/approval-check.mjs" --ticket APP-NNN --head "$(git rev-parse <branch>)"
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN merged --by tech-manager \
       --token "$(node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" actor mint --role tech-manager --ticket APP-NNN)"
     ```

     `approval-check` exit `1` → the approval does not cover the branch as it stands (a later commit,
     or never bound): request a fresh review, do not merge. `merged` refuses without a non-owner
     `approved` that satisfies the risk policy (no ticket-named branch → `--head <sha>`); exit 0 → row is
     `qa`. Refused with
     `missing: tech-lead` or `missing: security-reviewer` → `build-loop-branches.md` §Step 4
     (high/critical). **The gate does not `git merge`** — merges happen once per wave (step 5).
   - `REQUEST CHANGES` → `board.mjs move APP-NNN changes --by code-reviewer --verdict
     docs/53-reviews/APP-NNN-cycle-N.md` (the reviewer's own token), then re-spawn the original
     developer with `compose --role <owner> --retry <that file>` — not notes from your context. Cycles are the count of
     `changes` events; nobody edits a column.

     **Re-spawn one model tier up** (`--retry` prints it): `haiku → sonnet → opus`, capped at opus,
     from the agent file's `model:`. Pass it as the subagent tool's `model`
     parameter and name the tier in the standup. A `rejected` verify-done retry does **not**
     escalate.
   - **Cap: 2 review cycles, enforced at write time** — the 3rd `changes` is refused and becomes
     `blocked`. Stop that ticket and surface it to the user; only the founder's `reopened` grants
     another cycle (`build-loop-branches.md` §Step 4). The dependents the CLI names are now stranded;
     step 0 re-checks every round.

   **Utility tier** → `build-loop-branches.md` §Step 4 — utility tier.

4a. **Release the slot and reap the pool** when a ticket's agent has finished — on **every terminal
   outcome**, not only a merge (`rejected`, a cap-converted `blocked`, a `BLOCKED:` return, a crashed
   round):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" release --slot ios-developer-1
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply
   ```

5. **The wave integration pass — merge once, test once, push once.** Every ticket whose merge gate
   cleared sits at `qa` with its branch unmerged; this is the only place merges happen and the suite
   runs. A wave holding a `high`/`critical` ticket lands only when the runtime gate passes on it.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N> --base "$BASE"
   ```

   | Exit | Meaning | Do |
   |---|---|---|
   | `0` GREEN | merged tree passes | run the `board.mjs move ... verified --evidence <record> --token ...` lines it printed, as printed, then push (below) |
   | `1` FAIL/CONFLICT | wave does not advance | send back only the tickets it names, with the `move <ID> rework` lines it printed (below), then re-spawn their owners |
   | `2` CANNOT EVALUATE | no `full` scope, or the suite could not run | not a pass; every ticket keeps `verified_static`, `closed` stays refused |

   **The wave lands the commit `merged` recorded** (W7-1); a later commit is unreviewed, so the wave
   holds that ticket out as `MOVED SINCE MERGED`. Route back: `board.mjs move APP-NNN rework --by tech-manager
   --detail "wave <N>: …" <TOKEN>` (printed) → `in_progress`; re-spawn the owner with the failure, or
   the conflict to rebase (`git-pr-strategy` §6); steps 3–4 again. No ticket named → tech-lead.

   **The push is a second call on the same, already-green wave branch** — no re-merge, no re-test:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N> --base "$BASE" --push
   ```

   One push, one CI run; never trigger a workflow yourself. No `origin` → skipped, exit `0`
   (`NOT PUSHED: no origin`). Exit `1` is a push failure — re-spawn nobody, report it verbatim. Exit
   `2`: never recorded green, or moved since — re-run the wave. A non-green wave is normal
   (`merge-reconcile`: `AWAITING INTEGRATION`).

   **Then the runtime gate**, once per wave, before spawning `qa-engineer`, with the main checkout at
   the integration branch's tip (else CANNOT EVALUATE, W7-3):

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-gate.sh" --project-root . --record
   ```

   - Exit `0` → the app builds and launches. Name the evidence path in the standup.
   - Exit `1` → **the wave does not advance.** File an `S1` in `docs/51-bugs.md` (step 1 makes it
     `BUG-NNN-fix`); re-spawn the owner with the gate's output **verbatim**.
   - Exit `2` → **CANNOT EVALUATE, not a pass** (`RUNTIME GATE: CANNOT EVALUATE`). QA still runs;
     nothing records this build as launched; `/app-ship` re-runs the gate.

   **Then the journey gate** — the runtime gate proves the app is ALIVE, not that it WORKS:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journey-gate.mjs" --root . \
     --driver "${CLAUDE_PLUGIN_ROOT}/scripts/drivers/android.sh"   # or drivers/ios.sh, drivers/web.sh
   ```

   A `web-app` uses `web.sh` on the built, running app — setup: `build-loop-branches.md` §Step 5 —
   journey-gate drivers.

   - Exit `0` → a declared P0 journey passed: *the product does what it is for*. Name the evidence.
   - Exit `1` → **the wave does not advance**, as a runtime FAIL: the product is wrong.
   - Exit `2` → **CANNOT EVALUATE.** Print it under `JOURNEY GATE: CANNOT EVALUATE` and name the cause:
     - **No journey declared** → **rows may not move `qa → done` this wave.** Spawn `qa-engineer` to
       declare one (`docs/team/journeys/<journey-id>.json`, format:
       `${CLAUDE_PLUGIN_ROOT}/docs/team/journeys/README.md`), checked on its branch with
       `node "${CLAUDE_PLUGIN_ROOT}/scripts/journey-gate.mjs" --root <its slot> --list`.
     - **No driver available** → rows may advance on QA's verdict, but **nothing records this build's
       journeys as exercised**; the standup says so and `/app-ship` needs a waiver.

   Then run the QA pass **as a ticket**, not as an errand — on every tier, except a wave made only of
   `QA-` tickets:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add QA-<sprint>-w<n> --title "QA pass — wave <n>" --owner qa-engineer
   # dispatch-preflight for QA-<sprint>-w<n> (top of this file), then:
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move QA-<sprint>-w<n> claimed --by qa-engineer
   ```

   Spawn `qa-engineer` once, composed with `compose --ticket QA-<sprint>-w<n> --role qa-engineer`:
   the prompt lists each wave ticket, its acceptance criteria and token
   (`Token for APP-NNN: …`). qa-engineer-owned APP rows skip it: compose those `--role verification-engineer`. QA works on `qa/QA-<sprint>-w<n>`, exercises the criteria (driving the P0 journey per
   `runtime-gate` where the toolchain is present), files defects in `docs/51-bugs.md` (S1/S2 return
   via step 1), and **records a verdict per ticket** — unless its P0 journeys are new: verdicts
   follow landing (`build-loop-branches.md` §Step 5, first declarations):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN qa_passed --by qa-engineer \
     --token <its token for APP-NNN> --evidence docs/team/journey-result.json
   # or, for a ticket QA rejected — it stays in qa; the BUG-NNN-fix path: build-loop-branches.md §Step 5
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN qa_failed --by qa-engineer \
     --token <its token for APP-NNN> --detail "BUG-NNN"
   ```

   Check them (`board.mjs show`). **Close nothing yet** (W7-11): land the `QA-` ticket
   (below), re-run the journey gate, then — unless `No journey declared` — close what passed:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN closed --by tech-manager \
     --token "$(node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" actor mint --role tech-manager --ticket APP-NNN)"
   ```

   QA's `--evidence`: the journey-gate PASS or a full-suite record on the integration branch
   (`build-loop-branches.md` §Step 5). No `qa_passed` → no `closed`; none at all after `RUNTIME GATE: FAIL`.

   **The `QA-` ticket is docs-only** — `docs/50-test-plan.md`, `docs/51-bugs.md`, `docs/54-evidence/`, `docs/daily/`, `docs/team/journeys/<journey-id>.json`;
   anything else (any other doc, control files, build manifests, files outside `docs/`) takes the review
   path. Its return gets report-check, `done_reported`, `verify-done.sh <branch> "$BASE" --docs-only`
   and the fragment check; no `Branch:` is **REJECTED**. Review it inline (no `code-reviewer`), then
   `merged` and `closed` with `<TOKEN>` for the `QA-` ID — nobody QAs the QA pass. **Then** land its
   files (`wave-integrate` skips `QA-` tickets) with the fast-forward `closed` prints:
   `git checkout <integration> && git merge --ff-only qa/<QA-ID>` — `git rebase <integration>
   qa/<QA-ID>` first when it says the integration branch moved — then release QA's slot (step 4a).

6. **Daily report + board view.** Concatenate the per-agent fragments into the standup with a
   command — no `tech-manager` spawn for it — then render the board and print the terminal view:

   ```bash
   D=$(date +%F); { echo "## In flight and blocked"; node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show
     for f in docs/daily/"$D"-*.md; do [ -f "$f" ] && { echo "## $f"; cat "$f"; echo; }; done; } > docs/daily/"$D".md
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-render.mjs" docs/31-board.md --out docs/32-board-view.md
   ```

   Surface what the channel still owes, and **escalate the founder's half to the founder**:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --escalations
   ```

   Exit `1` → an escalation is open: **surface it to the user verbatim in this round's report**;
   never carry it to the next round.

6a. **Journal the round — one line, every round, before you loop** — to `docs/33-rounds.jsonl`,
   what happened to the loop (the event log records what happened to tickets).

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/round-journal.mjs" append --round <N> \
     --tickets APP-001,APP-002 --verdicts approved=1,changes=1 \
     --agents ios-developer=2,code-reviewer=1 \
     --spawns <how many agents you launched> --retries <re-spawns> \
     --refusals <CLI/gate exit-1s this round> --wall-clock-sec <seconds> \
     --verified-static <N from step 0's "VERIFIED STATIC — N ticket(s)" line; omit if it did not print>
   ```

   Print step 0's `BUDGET:` line in the standup. The fields, and when to pass `--spend-usd`:
   `build-loop-branches.md` §Step 6a.

7. **Loop** back to step 0 until the board has no ready `todo` rows and nothing in `review`/`qa`.

8. **Exit check — never declare a sprint done on an incoherent board.** Re-run the doctor. Print the
   sprint summary accounting for **every** non-`done` row — blocked, stranded and waiting tickets
   named with their reason; a ticket that exists is never absent from the summary. Suggest
   `/app-plan` (next sprint), `/app-ship` (release v1), or `/app-status` (inspect).

## Safety

- **Never spawn a writing agent without its own worktree** (or, failing that, serialized), and never
  without `spawn-gate.sh` having said so.
- **No repo-wide `git reset` / `stash` / `checkout -- .` / `clean` / `add -A` / `add .`** by any
  agent sharing a tree — the one copy of the list; `compose` puts it in every prompt. Need a clean
  tree? Copy to a temp dir (`agent-isolation` Rule 2).
- **Never spawn while the board doctor reports an anomaly.**
- **Never move a row to `review` on an unverified `DONE`.**
- **Never advance a wave across a `RUNTIME GATE: FAIL`, and never record a `CANNOT EVALUATE` as a
  launched build.**
- **Never merge a branch containing another ticket's files** — stop the round and check both branches.
- Never spawn more than one agent for the same ticket simultaneously, or two agents into one slot.
- Never auto-merge across a `REQUEST CHANGES`.
- Never re-spawn a developer past the 2-cycle cap without user input.
- **Spawn budget:** at most 6 developer retries per ticket across the sprint (review cycles plus
  rejected-DONE retries). Past that the ticket is `blocked` and goes to the user — a spec problem,
  not an effort problem.
- A developer returning `BLOCKED: APP-NNN` → surface the blocker verbatim, append
  `board.mjs move APP-NNN blocked --by <owner-role> --detail "<the blocker>"`, stop that ticket, and
  do not invent an answer. Read the readiness cascade the CLI prints — those dependents are now
  unclaimable.
- **Never hand-edit `docs/31-board.md`.** It is generated.
