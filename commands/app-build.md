---
description: Run the sprint — launch developer agents in parallel, review each PR, gate to QA, surface bugs back into the loop
argument-hint: [ticket IDs, optional — defaults to all ready tickets]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-build — Execute the sprint

Tickets (optional, default = all ready): $ARGUMENTS

Rare branches (legacy boards, the verify-done exit-2 causes, the cycle cap, utility tier, runtime and
journey gate edge cases, the QA ticket, journal fields) are in
`${CLAUDE_PLUGIN_ROOT}/skills/parallel-orchestrator/references/build-loop-branches.md`. Each step
below names the section when you need it; read nothing from it otherwise.

Before spawning any ticket owner, run the unified dispatch gate:

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
| 5 | QA verdict | `qa_passed` / `qa_failed`, then `closed` (a `QA-` ticket: `merged` → `closed`) |
| any | stopped, for any reason | `blocked`, later `unblocked` |
| cap | founder grants one more review cycle | `reopened` (`--by founder`) |

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

   On a clear round, **re-snapshot the context this round's agents will be given** before the first
   dispatch preflight — every wave merge moves HEAD, and a stale manifest makes `dispatch-preflight`
   refuse every spawn:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/team-bootstrap.mjs" --root . --context-only
   ```

   No event log but a hand-written `docs/31-board.md`? → `build-loop-branches.md` §Step 0.

   **The `GATE` lines in its output have a closed role list** — never route around them.
   `orchestrator explain <TICKET>` says why any transition is refused.

1. **Read state.**
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json`. Ready = `status` is `todo` and
     every `dependsOn` ID is **merged** (`qa` **or** `done`) — a dependency is satisfied when its code
     is on the integration branch, not when QA is finished. A mis-read costs only a refusal:
     `claimed` is refused on a ticket whose dependency has no `merged` event.
   - **The register — every bug and audit finding, with a status that is never blank.**

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . import-bugs --by tech-manager
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . check
     ```

     `import-bugs` folds `docs/51-bugs.md` into `docs/90-register.jsonl`; exit `2` before QA's first
     pass just means `docs/51-bugs.md` does not exist yet — say so and continue. `check` exits 1
     while anything owes an answer: mid-sprint a **report**, at ship a **refusal**. For every open
     `S1`/`S2` with no ticket, cut a `BUG-NNN-fix` row (`board.mjs add ... --depends <the original
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

   Exit `1` → **the batch answered nothing** (prose, not ledger rows): re-spawn `tech-lead` requiring
   one `answer` row per question it can settle and ONE `escalation` for the rest, and do not proceed
   to step 2. Contract: `skills/team-protocol/references/mid-sprint-qa.md`.

2. **Spawn developers in parallel — run the `parallel-orchestrator` skill.** It is the one copy of
   the launch procedure: claim each ticket, lease one slot per OWNER, check file overlap, compose
   each prompt with `spawn-prompt.mjs compose`, run `spawn-gate.sh <owners>` (also the `.studio-stop`
   kill switch — you never clear it yourself), then launch every owner in a **single assistant
   message**. A refusal at any of those steps means **spawn nobody** for what it names.

   **Spawn by the ticket's `Owner` column — never from a hardcoded list.** The authority is
   `board-doctor` and the `BUILD_SPAWNABLE_OWNERS` set in `scripts/lib/board.mjs`; `team-doctor.mjs`
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
   - **Check the report satisfies its contract BEFORE you believe any of it.** Save the returned
     text and run:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/report-check.mjs" --role <owner-role> --report <saved report> --root .
     ```

     Exit `1` → **the DONE is not actionable.** Re-spawn the agent asking for the missing fields.
     **Do not fill them in yourself.** **`--root` is not optional**: it checks claims against git
     (`git show <branch>:<path>`), not just their presence; `FALSE CLAIM` names, e.g., a daily
     fragment that was never committed — re-spawn the agent to stage and commit it. Reading the
     report does not catch this: a reader supplies missing structure from imagination.
   - **Record the claim as a claim**, before checking anything — `review_requested` is refused
     without a `verified` after the last `done_reported`:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN done_reported --by <owner-role>
     ```
   - **Verify the claim** (`board-doctor` skill). The base is the integration branch, resolved once
     per round from the project's git strategy — never a hardcoded `main`:

     ```bash
     BASE=$(sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh") \
       || { echo "$BASE"; echo "STOP: integration branch unresolved"; exit 2; }
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" --static <branch> "$BASE"
     ```

     **If `integration-branch.sh` exits 2, STOP the round** and surface its message (`$BASE` holds
     it) — do not run `verify-done.sh`, do not merge. Every base you might substitute is a guess, and
     merging into the wrong branch is not recoverable. Use that same `$BASE` for step 4.

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

     `REJECTED` → `board.mjs move APP-NNN rejected --by tech-manager --detail "<the blocking line>"`,
     then re-spawn the developer with the blocking lines verbatim. This is a **developer** retry, not
     a review cycle. `VERIFIED` → `board.mjs move APP-NNN verified --by tech-manager --detail
     "verify-done.sh green"`; if it reports `tests=unverified`, say so in the `--detail`. Exit `2` →
     **CANNOT EVALUATE**, never a pass; record `verified_static` with the reason verbatim, and **do
     not re-spawn the developer** — `build-loop-branches.md` §Step 3 for its two causes.
   - **Read `Shared surfaces touched`.** If two returning agents name the same file, or both report
     *creating* a cross-cutting abstraction for one concern, route it to `tech-manager` **now** —
     before the merge gate — to pick one shape and re-spawn the loser with the winner named.
   - **Verify `Assumptions & open questions` against the ledger.** Every question the agent says it
     raised must have its record on `docs/team/messages.jsonl`. A missing record is a report defect:
     file the question yourself, note in the standup that the agent claimed it and had not, and
     treat its other unverifiable claims with the same suspicion. `ASSUMED, NOT RAISED` just needs
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
   - Spawn a `code-reviewer` for that branch immediately — do not wait for the other devs. Reviewers
     run in parallel with each other and with still-running developers. It appends
     `board.mjs move APP-NNN started --by code-reviewer` when it picks the ticket up.

4. **Process reviewer verdicts.**
   - **Read the two routing fields on every verdict, `APPROVED` or not:**

     ```
     Constants routed to verification-engineer: <which, or "none in this diff">
     Rules routed to verification-engineer: <which, or "none in this diff">
     ```

     If either names anything, **spawn `verification-engineer` for that ticket before the merge
     gate**, passing the branch, `$BASE`, and the named constants and rules verbatim. Its
     `VERIFICATION: PASS` / `VERIFICATION: FAIL` gates the merge **alongside** the review verdict:
     `FAIL` blocks exactly as a `REQUEST CHANGES` does — write `docs/53-reviews/APP-NNN-cycle-N.md` as
     a FAIL file (below) with the `VERIFICATION: FAIL` findings, record
     `board.mjs move APP-NNN changes --by tech-manager --verdict <that file>`, and re-spawn the
     developer. A verdict missing either field goes back to the reviewer — a missing field is never
     "none". It fires only when the reviewer flags one; never spawn it per ticket "to be safe".

     **A FAIL file** — verification or design QA — has a fixed shape, because `--verdict` parses it:

     ```
     REVIEW VERDICT: REQUEST CHANGES
     Scope: <base>..<head>
     <the FAIL detail: VERIFICATION: FAIL or DESIGN QA: FAIL — <n> item(s), and each finding>

     ## Not checked
     <what this pass did not look at>
     ```

     Line 1 exactly, line 2 the scope. It counts toward the 2-cycle cap like any `changes`.

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

     **Who runs it: `ux-architect`, or `code-reviewer` when `ux-architect` is off.**
     **Never `product-designer` on its own design** — the designer must not be the only agent
     approving its fidelity (separation of duties, as `release-auditor` versus `release-manager`).
     Verdict `DESIGN QA: PASS` or `DESIGN QA: FAIL — <n> item(s)`; a `FAIL` is persisted as a FAIL file,
     recorded with `board.mjs move APP-NNN changes --by tech-manager --verdict <that file>`, and the
     owner is re-spawned.
   - `REVIEW VERDICT: APPROVE` (and `VERIFICATION: PASS` if one was required) → the reviewer appends
     `board.mjs move APP-NNN approved --by code-reviewer --verdict docs/53-reviews/APP-NNN-cycle-N.md`
     — plus `--bind --evidence <path> --context <path>` when `.studio-policy.json` sets
     `requireApprovalBinding` (the `/app-init` default). The append is refused if the verdict file is
     missing, lacks `REVIEW VERDICT:`, contradicts the event, or lacks `Scope:` or `## Not checked` —
     that means the review is not recorded yet; have the reviewer finish the document.
     **Then run the merge gate yourself, inline — do not spawn `tech-manager` for it:**

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/approval-check.mjs" --ticket APP-NNN --head "$(git rev-parse <branch>)"
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN merged --by tech-manager
     ```

     `approval-check` exit `1` → the approval does not cover the branch as it stands (a later commit,
     or never bound): request a fresh review, do not merge. `merged` refuses without a non-owner
     `approved` that satisfies the risk policy; on exit 0 the row is `qa`. Refused with
     `missing: tech-lead` → `build-loop-branches.md` §Step 4 (high-risk). **The gate does not run
     `git merge`** — the merges happen ONCE per wave, in step 5.
   - `REQUEST CHANGES` → `board.mjs move APP-NNN changes --by code-reviewer --verdict
     docs/53-reviews/APP-NNN-cycle-N.md`, then re-spawn the original developer **pointed at that
     file**, not at notes in your context. Cycles are the count of `changes` events; nobody edits a
     column.

     **Re-spawn one model tier up**: `haiku → sonnet → opus`, capped at opus, starting from the agent
     file's `model:`. Pass it explicitly (the subagent tool's `model` parameter, or state it in the
     prompt) and name the tier in the standup. A `rejected` verify-done retry does **not** escalate.
   - **Cap: 2 review cycles, enforced at write time** — the 3rd `changes` is refused and becomes
     `blocked`. Stop that ticket and surface it to the user; only the founder's `reopened` grants
     another cycle (`build-loop-branches.md` §Step 4). The dependents the CLI names are now stranded;
     step 0 re-checks every round.

   **Utility tier** → `build-loop-branches.md` §Step 4 — utility tier.

4a. **Release the slot and reap the pool** when an owner has no tickets left in flight — on **every
   terminal outcome**, not only a merge (`rejected`, a cap-converted `blocked`, a `BLOCKED:` return,
   a crashed round):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" release --owner ios-developer
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply
   ```

5. **The wave integration pass — merge once, test once, push once.** Every ticket whose merge gate
   cleared sits at `qa` with its branch unmerged. This is where the git merges happen and the only
   place the executable suite runs (`scripts/wave-integrate.mjs` header has the full account).

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N> --base "$BASE"
   ```

   | Exit | Meaning | Do |
   |---|---|---|
   | `0` GREEN | merged tree passes | run the `board.mjs move APP-NNN verified` lines it printed, then push (below) |
   | `1` FAIL/CONFLICT | wave does not advance | re-spawn only the owners its candidate list names; a textual conflict is **yours** to resolve here (`git-pr-strategy` §6); a behaviour/contract one goes to that contract's owner as a ticket |
   | `2` CANNOT EVALUATE | no `full` scope, or the suite could not run | not a pass; every ticket keeps `verified_static`, `closed` stays refused |

   **The push is a second call on the same, already-green wave branch** — no re-merge, no re-test:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N> --base "$BASE" --push
   ```

   One push, one CI run — never trigger, re-run or cancel a workflow yourself. No `origin` → skipped,
   exit `0`; say `NOT PUSHED: no origin`. Exit `1` here is a push failure, not a code failure —
   re-spawn nobody, report it verbatim. Exit `2` means the branch was never recorded green or moved
   since: re-run the wave. A non-green wave is a normal outcome — `merge-reconcile` reports it as
   `AWAITING INTEGRATION`.

   **Then the runtime gate**, on the integration branch, once per wave, before spawning `qa-engineer`
   (the merged tree is the only place "three approved tickets and no composition root" is visible):

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-gate.sh" --project-root . --record
   ```

   - Exit `0` → the app builds and launches. Name the evidence path in the standup.
   - Exit `1` → **the wave does not advance.** No row moves `qa → done`. File an `S1` in
     `docs/51-bugs.md` (step 1 turns it into `BUG-NNN-fix`) and re-spawn the owning developer with the
     gate's compiler output **verbatim**.
   - Exit `2` → **CANNOT EVALUATE, not a pass.** Print it under `RUNTIME GATE: CANNOT EVALUATE`. QA
     still runs, but nothing may record this build as launched. Product type outside the script's
     detection → `build-loop-branches.md` §Step 5.

   **Then the journey gate** — the runtime gate proves the app is ALIVE, not that it WORKS:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journey-gate.mjs" --root . \
     --driver "${CLAUDE_PLUGIN_ROOT}/scripts/drivers/android.sh"   # or drivers/ios.sh
   ```

   - Exit `0` → a declared P0 journey completed with its assertions holding — the only signal that
     *the product does what it is for*. Name the evidence.
   - Exit `1` → **the wave does not advance**, as a runtime FAIL. The product is wrong, not the
     harness (drivers: `build-loop-branches.md` §Step 5).
   - Exit `2` → **CANNOT EVALUATE.** Print it under `JOURNEY GATE: CANNOT EVALUATE` and name the cause:
     - **No journey declared** → **rows may not move `qa → done` this wave.** Spawn `qa-engineer` to
       declare one (`docs/team/journeys/<journey-id>.json`; `ux-architect`'s inventory names the ids)
       and re-run.
     - **No driver available** → rows may advance on QA's own verdict, but **nothing may record this
       build as having had its journeys exercised**; the standup carries the line verbatim and
       `/app-ship` requires an explicit waiver.

   Then run the QA pass **as a ticket**, not as an errand:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add QA-<sprint>-w<n> --title "QA pass — wave <n>" --owner qa-engineer
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move QA-<sprint>-w<n> claimed --by qa-engineer
   ```

   Spawn `qa-engineer` once with that ticket ID to exercise the acceptance criteria (driving the P0
   journey per `runtime-gate` where the Axiom toolchain is present). QA writes defects to
   `docs/51-bugs.md`; S1/S2 return via step 1. **Its return goes through step 3 exactly like a
   developer's** — a DOC-profile ticket: `done_reported`, `verify-done.sh <branch> "$BASE"
   --docs-only`, the fragment check, review, the merge gate — then straight to
   `board.mjs move QA-<sprint>-w<n> closed --by tech-manager` (nobody QAs the QA pass). A QA return
   with no branch is **REJECTED** (`build-loop-branches.md` §Step 5 — the QA ticket).

   Record QA's verdict per ticket, then close what passed:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN qa_passed --by qa-engineer
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN closed   --by tech-manager
   # or, for a ticket QA rejected — it stays in qa and is named in the summary
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN qa_failed --by qa-engineer --detail "BUG-NNN"
   ```

   `closed` is refused without a `qa_passed`. After a `RUNTIME GATE: FAIL` no row in the wave gets a
   `qa_passed` at all.

6. **Daily report + board view.** Spawn `tech-manager` to concatenate the per-agent fragments at
   `docs/daily/<today>-<role>-<ticket>.md` into the standup at `docs/daily/<today>.md`. Render the
   board (its Mermaid graph outlines stranded and blocked tickets in red) and print the terminal view:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-render.mjs" docs/31-board.md --out docs/32-board-view.md
   ```

   Surface what the channel still owes, and **escalate the founder's half to the founder**:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --escalations
   ```

   An unanswered `question` is a `tech-manager` action item. An **escalation** must be resolved or
   passed to the user in the same round: exit `1` from the second command → **surface those to the
   user verbatim in this round's report**; never carry them to the next round.

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
  without `spawn-gate.sh` having said so — the rule alone, known and written, did not stop it.
- **No repo-wide `git reset` / `stash` / `checkout -- .` / `clean` / `add -A` / `add .`** by any
  agent sharing a tree — tell every agent so in its prompt. Need a clean tree? Copy to a temp dir
  (`agent-isolation` Rule 2).
- **Never spawn while the board doctor reports an anomaly.**
- **Never move a row to `review` on an unverified `DONE`.**
- **Never advance a wave across a `RUNTIME GATE: FAIL`, and never record a `CANNOT EVALUATE` as a
  launched build.**
- **Never merge a branch containing another ticket's files** — a shared tree was used; stop the round
  and check both branches.
- Never spawn more than one agent for the same ticket simultaneously.
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
