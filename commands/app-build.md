---
description: Run the sprint — launch developer agents in parallel, review each PR, gate to QA, surface bugs back into the loop
argument-hint: [ticket IDs, optional — defaults to all ready tickets]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-build — Execute the sprint

Tickets (optional, default = all ready): $ARGUMENTS

Before spawning any ticket owner, run the unified dispatch gate:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-preflight.mjs" \
  --root <project> --ticket <ID> --context "$CONTEXT_MANIFEST" --schedule "$SCHEDULE_PLAN" \
  --capability "$CAPABILITY_MANIFEST" --risk "$RISK_POLICY" \
  --role <role> --operation write --path <changed-path> --file <changed-file> --change <summary>
```

This composes context freshness, scheduler admission, capability allowlisting, and blast-radius
routing. `--ticket` is checked against the scheduler's own `ready` set — a ticket the scheduler has
not marked ready fails preflight even if every other check would have passed, so a caller cannot
launch on its own belief that a ticket is ready. A failed or unavailable check stops the spawn and is
reported to the manager.

## How this loop writes the board

Every status change below is an append to `docs/31-board-events.jsonl` through one command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move <ID> <event> --by <role> [--detail "..."]
```

`docs/31-board.md` is regenerated from that log on every append. **Never edit a cell** — the next
render erases it and no rule in this plugin ever saw it. The loop's steps map to events exactly:

| Step | Situation | Event |
|---|---|---|
| 2 | a developer picks the ticket up | `claimed` |
| 3 | developer returns `DONE: APP-NNN` | `done_reported` |
| 3 | `verify-done.sh` VERIFIED / REJECTED | `verified` / `rejected` |
| 3 | routed to review | `review_requested` (`--detail "-> code-reviewer"`) |
| 3 | reviewer begins | `started` |
| 4 | `APPROVED` / `REQUEST CHANGES` | `approved` / `changes` |
| 4 | merge gate clears | `merged` |
| 5 | QA verdict | `qa_passed` / `qa_failed`, then `closed` |
| any | stopped, for any reason | `blocked`, later `unblocked` |

**Exit `1` is a refusal, and a refusal is a finding.** The CLI rejects the transition and prints why
and what is legal from here. Do not retry it, do not work around it, and do not touch the Markdown:
surface the refusal verbatim in the standup and fix the thing it names. Each refusal corresponds to
a state this board could previously be written into and the doctor could only report afterwards — a
review requested on an unverified DONE, an owner approving their own work, a merge with no non-owner
approval, a claim on a dependency that never merged. Exit `2` means the log is missing or unreadable:
**that is CANNOT EVALUATE, not an empty board.** Stop the round.

## Steps

0. **Run every mechanical precondition as ONE command, before spawning anything.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.mjs" round
   ```

   This replaces four separate steps that used to be four separate paragraphs: the **board doctor**
   gate, the **budget** ceiling, the **toolchain** check, and printing **what is legal now**. Every
   one of them was already a script with its own exit code. What was prose was the discipline of
   running all four, in order, every round — and that is exactly the kind of discipline this
   codebase has repeatedly proven does not survive contact with a long file. Dry run 3's skipped
   transition was not ignorance; it was load.

   It is READ-ONLY. It claims nothing, advances nothing, appends nothing.

   - Exit `0` → every precondition CLEAR, and it prints the legal transitions per ticket. Continue.
   - Exit `1` → **BLOCKED. Spawn nobody this round.** It names which precondition and why: an
     incoherent board (repair it with `tech-manager`, then re-run), a reached ceiling or the
     emergency stop (raising a ceiling is the user's decision, never a workaround you apply to keep
     going), or a declared tool at the wrong version.
   - Exit `2` → **CANNOT EVALUATE. Also not a pass.** Usually no board yet (`/app-plan` first), or
     no `docs/team/project-profile.json` so the toolchain is UNPROVEN. Supply what it names.

   **If a project has no event log yet but does have a hand-written `docs/31-board.md`**, migrate
   once before this step, then continue as normal:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" migrate docs/31-board.md --out docs/31-board-events.jsonl \
     && node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" render
   ```

   Announce how much it reconstructed as `inferred` (`ts: null`) — those are events the hand-written
   board never recorded, so `/app-status` metrics will be thin for tickets that predate the log. If
   migrate exits non-zero the board is too old to reconstruct: say `LEGACY BOARD: no event log`, use
   `board-doctor` as the authority for the rest of the run, and do not strand the project over it.

   **The `GATE` lines in its output are the ones with a closed role list.** Those are the steps that
   must not be routed around, and `orchestrator explain <TICKET>` says why any given transition is
   refused — including the ones you expected to be legal, which is the more useful half.

1. **Read state.**
   - `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json` — the derived state of every
     ticket, from the log. Find tickets where `status` is `todo` and every `dependsOn` ID is
     **merged** — that is, `qa` **or** `done`. (On the legacy path, read `docs/31-board.md`
     directly; the readiness rule is identical.)

     You do not have to get this exactly right, and that is the point: `claimed` is **refused** on a
     ticket whose dependency has no `merged` event, so a mis-read of readiness costs a refusal
     rather than a developer working on sand.

     A dependency is satisfied when its code is on the integration branch, not when QA has finished
     with it. Requiring `done` stalls every dependent behind a QA pass: observed live, a foundation
     ticket merged cleanly and both features that depended on it stayed unready, so the sprint had
     nothing to do while one QA cycle ran. QA failures already have their own mechanism — they
     become `BUG-NNN-fix` tickets in step 1 — so blocking dependents a second time buys nothing and
     serializes the whole board behind its slowest gate.
   - **The register — every bug and every audit finding, with a status that is never blank.**

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . import-bugs --by qa-engineer
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . check
     ```

     `import-bugs` folds `docs/51-bugs.md` into `docs/90-register.jsonl` through the parser
     `ship-gate.sh` already uses, so QA keeps writing the Markdown it always wrote and nothing is
     lost by nobody reading it. `check` exits 1 while anything still owes an answer. Here that is a **report** — open bugs
     mid-sprint are what a sprint is for — and at ship it is a **refusal**. For every open `S1`/`S2`
     with no ticket, cut a `BUG-NNN-fix` row and link it:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" --root . link BUG-007 --ticket BUG-007-fix --by tech-manager
     ```

     An item with **no ticket** is the one to act on: nothing on the board will ever pick it up.
     Why this is a command and not the sentence it replaced: `scripts/register.mjs` header.

1a. **Route the finished wave's assumptions into the ledger.** For every agent that returned last
   round, each `ASSUMED, NOT RAISED` line in its `Assumptions & open questions` field becomes a real
   `question` row, filed on that agent's behalf:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/team-message.sh" \
      --from <the agent> --to tech-lead --ticket APP-NNN --kind question \
      --summary "<the assumption, as a question>" --body "<what it decided and why>"
   ```

   An IC cannot block waiting for an answer inside its own run, so it declares and moves on
   (`team-protocol` §Why ICs mostly won't message). Declaring only helps if something later files
   and answers it — that is this step and the next.

1b. **MID-SPRINT Q&A — answer last round's guesses before this round inherits them.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages-render.mjs" docs/team/messages.jsonl --board docs/31-board.md
   ```

   The `OPEN QUESTIONS` block **is** the batch — do not re-derive it. Empty block, or exit 2 (no
   ledger yet, normal in round 1) → skip straight to step 2.

   Otherwise spawn `tech-lead` **once** with the whole batch — never once per question, never once
   per ticket. It emits one `answer` row per question it can settle, and **one** `escalation` to
   `tech-manager` covering everything it cannot. See `team-protocol` §Mid-sprint Q&A for the exact
   contract.

   **Then prove the batch answered something** — read the count before you spawn, pass it back after:

   ```bash
   BEFORE=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --json | tr -dc '0-9:,{}"a-z ' | sed -n 's/.*"open": *\([0-9]*\).*/\1/p')
   # ... spawn tech-lead ONCE with the whole batch ...
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --was "$BEFORE"
   ```

   Exit `1` → **the batch answered nothing.** `tech-lead` wrote prose instead of ledger rows and the
   next wave is about to inherit the same guesses: re-spawn it requiring one `answer` row per
   question it can settle and ONE `escalation` for the rest, and do not proceed to step 2. This was
   the sentence "re-render and confirm the count actually fell" with nothing checking it — the exact
   shape `report-check.mjs` exists to catch one step below.

   **Why this sits here and not later:** a question answered after the wave is spawned is answered
   too late — the developer has already decided. Measured across three dry runs and ten agent-runs,
   the live channel was used zero times, so every ambiguity was resolved by a guess and caught, if
   at all, in review. This step is where a guess becomes a decision before it becomes code.

2. **Spawn developers in parallel.** Use the `parallel-orchestrator` skill, which requires a
   **worktree per writing agent, leased before the spawn** (`agent-isolation`), and serializes any
   ticket pair that shares a file. Launch IC agents concurrently in a **single assistant message** —
   one Task invocation per owner, each passed its slot path and the full list of tickets they're
   working this round.

   **Lease one slot per OWNER, not one per ticket:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease \
     --owner ios-developer --tickets APP-001,APP-002 --pool 3
   ```

   The owner works its tickets **one after another in that one slot**, cutting `feat/APP-NNN-slug`
   per ticket and committing between — so branch-per-ticket is unchanged and every branch carries
   only its own files (`code-reviewer` check 9). `lease` refuses when the pool is full; that is the
   parallelism cap, and raising it is a decision, not a workaround. The unit of isolation is the
   **writer**, never the ticket: `agent-isolation` Rule 1 has the argument.

   **Claim each ticket before its agent is spawned**, so the board says who is working on what while
   they work rather than after they return:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN claimed --by <owner-role>
   ```

   A refusal here means the ticket was not actually ready — read the reason and spawn nobody for it.

   **Then run the isolation gate, and obey it.** Last command before the launch message — and it
   takes the **owners** you are about to spawn, because that is what now has a tree each:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ios-developer android-developer
   ```

   Exit `1` → **REFUSED: spawn nobody.** It names the tickets with no worktree and prints the
   `git worktree add` line for each; create them and re-run, or serialize the round. Exit `2` →
   worktrees are unavailable here, so serialize; a 2 is never a go-ahead. Exit `0` with a single
   ticket prints `SERIALIZED` — legal, and it must be said in the standup.

   **This gate is also the studio kill switch.** If `.studio-stop` exists at the repository root (or
   `APP_TEAM_STOP` is set in the environment), it refuses with `EMERGENCY STOP` and the operator's
   recorded reason. Spawn nobody, report what is unfinished, and stop the loop. **You never clear
   `.studio-stop` yourself** — an agent deciding the halt no longer applies is the halt not existing.
   An operator sets it with `echo "reason" > .studio-stop` and clears it with `rm .studio-stop`,
   with no code change and no restart.

   This is a script rather than a reminder because the reminder failed on the people who wrote it:
   two writers went into one checkout hours after that rule was hardened, one ran `git stash` +
   `git reset`, and 22 files of the other's work were lost (DR4-027). Isolation cannot be a
   convention the orchestrator remembers.

   **Spawn by the ticket's `Owner` column — never from a hardcoded list.** The authority on which
   owners this loop can spawn is `board-doctor` (Manual-fallback check 4) and the
   `BUILD_SPAWNABLE_OWNERS` set it shares with `scripts/lib/board.mjs`; `team-doctor.mjs` fails the
   build if this file and that set disagree, which is the only reason naming them here is safe:
   `ios-developer`, `android-developer`, `backend-developer`, `monetization-engineer`,
   `ux-architect`, `product-designer`, `product-manager`, `product-researcher`, `qa-engineer`,
   `data-analyst`, `devops-engineer`, `aso-specialist`, `web-developer`, `test-automation-engineer`,
   `verification-engineer`. **Do not copy this roster into any file `team-doctor` does not check** —
   the unchecked copy in `/app-audit` had already dropped the design and QA owners, so its
   accessibility and test-plan remediation tickets were filed to roles nothing spawned: never picked
   up, never blocked, never reported, and the loop drained around them and printed a successful
   sprint.

   **`docs/02-team-roster.md` says which of those roles exist on this project at all**
   (`role-activation`). A ticket owned by an `off` role is not a ticket to spawn quietly around: it
   is a planning defect — surface it to `tech-manager` to re-own or close, naming the roster reason.
   A `conditional` role becomes spawnable the round its trigger is met; amend its roster row then,
   so the flip is on the record.

   Spawn only what the project actually has this round: `backend-developer` when backend is in scope
   per `docs/20-architecture.md`, `web-developer` when the product has a browser surface, `ux-architect` / `product-designer` / `qa-engineer` when their flow, screen or test-plan work is
   ready. `security-reviewer`, `code-reviewer`, `release-manager`, `tech-lead` and `tech-manager`
   gate and coordinate — they never own a ticket, and the doctor rejects one that does
   (`owner_not_spawnable`).

3. **Streaming review.** As each developer agent returns `DONE: APP-NNN`:
   - **Check the report satisfies its contract BEFORE you believe any of it.** Save the agent's
     returned text and run:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/report-check.mjs" --role <owner-role> --report <saved report>
     ```

     Exit `1` → **the DONE is not actionable.** Re-spawn the agent asking for the missing fields
     specifically. **Do not fill them in yourself** — a field the orchestrator invents is a claim
     nobody made, recorded as though someone did.

     **Measured 2026-08-06, on the first agent ever spawned against this loop: it returned ONE of
     six contract fields.** It also reported "no git repo initialized" about a directory that is a
     git repository, made no commit, and reported DONE — so `verify-done.sh` came back REJECTED
     with "nothing was actually written" and the ticket parked at `in_progress`.

     `team-doctor` enforces that the role FILE declares those six fields. Nothing checked that an
     agent RETURNS them, which is FC-002 at the boundary where this studio meets its own workers.
     **Reading the report does not catch this**: the one that failed sounded complete, named its own
     skips and explained itself. A reader supplies the missing structure from imagination.

   - **Record the claim as a claim**, before you have checked anything:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN done_reported --by <owner-role>
     ```

     This is what makes the next step's outcome recordable at all: `review_requested` is refused on
     a ticket with no `verified` since its last `done_reported`, so an unchecked DONE structurally
     cannot reach a reviewer.
   - **Verify the claim before you believe it** (`board-doctor` skill). The base is the project's
     integration branch, resolved once from its own git strategy — never a hardcoded `main`, because
     the flagship model integrates on `develop` (`knowledge/git-workflow.md`) and merging features
     straight to `main` there is not recoverable by a later fix:

     ```bash
     BASE=$(sh "${CLAUDE_PLUGIN_ROOT}/scripts/integration-branch.sh") \
       || { echo "$BASE"; echo "STOP: integration branch unresolved"; exit 2; }
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" --static <branch> "$BASE"
     ```

     **`--static` is the default per-ticket lane.** It verifies the half a branch can answer — it
     exists, it has commits, it changed files, the diff is this ticket's — and exits **2**, because
     the suite genuinely has not run and CANNOT EVALUATE is the honest word. Record
     `verified_static`: it unlocks review, approval and the merge gate, refuses `closed`, and blocks
     `ship-gate.sh`. Step 5's wave pass runs the suite once on the merged tree and earns the real
     `verified`. The arithmetic behind this is in `scripts/verify-done.sh`.

     **Still run tests per ticket when `fast` is genuinely scoped** (`./gradlew :module:test`,
     `swift test --filter Unit`) **and** `build-env.sh --check` says the caches apply — then it costs
     seconds and buys the developer earlier feedback:

     ```bash
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" fast
     ```

     `fast` and `full` resolve from `docs/team/project-profile.json` (F6); never hardcode a command.
     If `fast` is really the whole matrix, it is not a fast scope — use `--static` and fix the
     profile.

     A scope the profile does not declare is **exit 2, with nothing substituted** — no default is
     invented, because a default test command makes "the tests ran" true of a command nobody chose.
     Projects with no profile keep passing a literal command; that path is unchanged.

     **If `integration-branch.sh` exits 2, STOP the round** and surface its message (it prints on
     stdout, so `$BASE` holds it) — do not run `verify-done.sh`, do not merge. Exit 2 means the
     integration branch could not be resolved, and every base you might substitute is a guess.
     Merging feature work into the wrong branch is not recoverable by a later fix, which is exactly
     why this no longer falls back to `main` on its own.

     Use that same `$BASE` for the merge gate in step 4 — one resolution per round, not one per
     call site.

     **For a ticket whose deliverable is a document, not code, pass `--docs-only` instead of a test
     command** — that is, tickets owned by `ux-architect`, `product-designer`, `product-manager`, `product-researcher`, `qa-engineer`, `aso-specialist`,
     `data-analyst`, or `verification-engineer`:

     ```bash
     sh "${CLAUDE_PLUGIN_ROOT}/scripts/verify-done.sh" <branch> "$BASE" --docs-only
     ```

     Branch, commits and changed files are still verified; only the test requirement is lifted.
     Without this the flag was unreachable — this loop always passed a test command — so a doc
     ticket either failed a test it structurally cannot have, or got waved through unverified.

     `REJECTED` → `board.mjs move APP-NNN rejected --by tech-manager --detail "<the blocking line>"`,
     then re-spawn the developer with the blocking lines verbatim. The ticket stays `in_progress`
     and is no longer reviewable until a fresh `done_reported` + `verified`. This counts as a
     **developer** retry, not a review cycle — `rejected` does not touch the `Cycles` count.
     `VERIFIED` → `board.mjs move APP-NNN verified --by tech-manager --detail "verify-done.sh green"`
     and continue. If it reports `tests=unverified`, say so in the daily fragment **and in the
     `--detail`**; never restate the agent's "all green" as confirmed.
     Exit `2` → **CANNOT EVALUATE**, not a pass. It has **two causes and they need different
     actions** — the script names which in its output, so read it rather than assuming:

     - *No test command was supplied for a code ticket.* Nothing verified the "all green" claim.
       Supply the project's test command and re-run, or `--docs-only` if the ticket really has no
       test. Re-running is the fix.
     - *A test command was supplied and the toolchain could not run it* — no SDK, no simulator, a
       missing wrapper. **Re-running cannot fix this**, and the work is not defective; it is
       unrunnable *here*. Do not leave the ticket stuck and do not fake a `verified`. Record what
       actually happened and let the review proceed on inspection:

       ```bash
       node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN verified_static \
         --by tech-manager --detail "<the toolchain reason, verbatim from verify-done>"
       ```

       The ticket can then be reviewed, approved and merged, and it carries
       `qa (static only) — NOT RUN: the executable test suite` until something runs it. It **cannot
       reach `done`**. Say `CANNOT EVALUATE` in the standup and name what never ran.

     This second branch is the whole point of the static lane: in the first end-to-end run,
     `code-reviewer` never ran **once** across an entire sprint, because a missing simulator blocked
     a path that also gated static inspection (DR4-002). An exit-2 handler that only knows how to say
     "supply a test command and re-run" leaves that lane unreachable in exactly the case it exists
     for.
   - **Read the `Shared surfaces touched` line.** If two returning agents name the same file, or
     both report *creating* a cross-cutting abstraction for the same concern, route it to
     `tech-manager` **now** — before the merge gate, while both agents still exist — to pick one
     shape and re-spawn the loser with the winner named.
   - **Verify the `Assumptions & open questions` line against the ledger.** Every question the agent
     says it raised must have its record on `docs/team/messages.jsonl`. A missing record is a defect in the
     report, not something to quietly fix: file the question yourself, note in the standup that the
     agent reported raising it and had not, and treat that report's other unverifiable claims with
     the same suspicion. `ASSUMED, NOT RAISED` is fine and just needs routing. (Observed live —
     a sincere, false "raised" line in the one artifact the standup aggregates; see `defect-hunting`
     on claims that read fine and are not true.)
   - **Check the daily fragment exists** at `docs/daily/<today>-<role>-<ticket>.md` on the branch —
     that exact spelling, per `team-protocol`'s canonical paths table; no other is recognised. It is
     the sole input to the standup and only 1 of 4 dry-run agents wrote one. Missing → ask that
     agent for it before moving the row; never write it on their behalf.
   - Route it to review. One command sets the status, the reviewer, and the ledger row — they were
     three separate writes, and the ledger row was the one that got forgotten:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN review_requested \
       --by <owner-role> --detail "-> code-reviewer"
     ```

     The reviewer is read out of that `--detail`, so the arrow is not decoration. A refusal here
     means no `verified` landed for the current `done_reported` — go back a bullet; do not route it.
   - **The reviewer must not be the owner.** For a ticket owned by `code-reviewer` (or any review of
     review work), route to `tech-lead` instead. The CLI enforces the half that matters at the point
     it matters: `approved` is refused when its author is the ticket's owner.
   - Spawn a `code-reviewer` agent for that branch immediately — do not wait for the other devs. Multiple reviewers can run in parallel, and they can run in parallel with still-running developers.
     When it picks the ticket up it appends `board.mjs move APP-NNN started --by code-reviewer`, so
     a review that was requested and never begun is visible while it is still fixable.

4. **Process reviewer verdicts.**
   - **Read the two routing fields on every verdict, `APPROVED` or not:**

     ```
     Constants routed to verification-engineer: <which, or "none in this diff">
     Rules routed to verification-engineer: <which, or "none in this diff">
     ```

     If either names anything other than `none in this diff`, **spawn `verification-engineer` for
     that ticket before the merge gate**, passing the branch, `$BASE`, and the named constants and
     rules verbatim. Its `VERIFICATION: PASS` / `VERIFICATION: FAIL` gates the merge **alongside**
     the review verdict: `FAIL` blocks the merge exactly as a `REQUEST CHANGES` would, and is
     re-worked the same way (re-spawn the developer, increment `Cycles`).

     If a verdict is missing both fields, ask the reviewer for them before merging — a verdict that
     does not say whether it found a constant is not a verdict you can act on, and treating a
     missing field as "none" is how this gate silently stopped applying.

     **Why this exists:** `code-reviewer` routes constants rather than executing them, and
     `verification-engineer` was only ever spawned by `/app-ship` — so a constant introduced in an
     ordinary ticket was executed by nobody, in any round, before it merged. `defect-hunting` §2
     ("never certify by reading — execute it") was cited across the plugin and performed nowhere
     inside the loop; a mis-calibrated threshold survived every review and every merge and was
     caught at ship time or never.

     **It fires only when the reviewer flags one.** Most tickets name no constant and cost nothing
     extra. Do not spawn it per-ticket "to be safe" — a gate that runs on everything is a gate
     someone turns off.

   - **The `design-qa` gate — a pass, like code review, not a role.** Run it on every ticket whose
     branch changes a user-facing surface, in parallel with the code review and before the merge
     gate. It answers five questions against `docs/12-flows.md` and `docs/14-components.md`:

     1. **Implementation versus design** — does the built screen match the composition, or did it
        drift silently during implementation?
     2. **Component consistency** — is it built from `docs/14-components.md`, or is there a new
        one-off that nobody recorded (`design-system`)?
     3. **State completeness** — **every** state the flow inventory lists for this screen exists:
        empty, loading, loaded, error, offline, and any product-specific one. A missing state is the
        most common finding here and the one users find first.
     4. **Responsive behaviour** — smallest supported size, largest, and the largest font scale,
        without clipping or overlap.
     5. **Accessibility implementation** — the `accessibility-gate` skill, run against the build
        rather than against the intention.

     **Who runs it: `ux-architect`, or `code-reviewer` when `ux-architect` is off.**
     **Never `product-designer` on its own design.** The designer who created the design must not be
     the only agent approving its fidelity — that is the same separation-of-duties rule as
     `release-auditor` versus `release-manager`, and it is the reason this is a gate rather than a
     line in the designer's own checklist.

     Verdict is `DESIGN QA: PASS` or `DESIGN QA: FAIL — <n> item(s)`. A `FAIL` blocks the merge
     exactly as a `REQUEST CHANGES` does and is re-worked the same way — re-spawn the ticket's
     owner, increment `Cycles` — with the verdict persisted alongside the review at
     `docs/53-reviews/APP-NNN-cycle-N.md`.
   - `APPROVED` (and `VERIFICATION: PASS`, if one was required above) → the reviewer appends
     `board.mjs move APP-NNN approved --by code-reviewer --verdict docs/53-reviews/APP-NNN-cycle-N.md`.
     **The path moved from `--detail` to `--verdict`, and that is the whole change**: `--detail` was
     free text nothing opened, so an approval could name a file that did not exist, or name nothing
     at all. `--verdict` is read, parsed and hashed onto the event — the append is refused if the
     file is missing, if it has no `REVIEW VERDICT:` line, if that line says `REQUEST CHANGES` while
     you are appending `approved`, if it has no `Scope: <base>..<head>`, or if it has no
     `## Not checked` section. A refusal here means the review is not recorded yet, not that the
     code is bad; read the message and have the reviewer finish the document.
     Then spawn `tech-manager` to run the Merge gate (see `agents/tech-manager.md`), passing the
     `$BASE` resolved in step 3. The gate **is** `board.mjs move APP-NNN merged --by tech-manager`,
     which refuses without a non-owner `approved`; on exit 0 the row is `qa`.

     **The gate no longer runs `git merge`, and that is the change.** It passes or refuses per
     ticket, exactly as before. The git merges happen ONCE, for the whole wave, in step 5 —
     `wave-integrate.mjs`. Per-ticket merging pushed the integration branch once per ticket (three
     CI runs for a three-ticket wave, none of them read), and handed every conflict back to a cold
     developer respawn for a rebase whose hunks the manager was already holding.
   - `REQUEST CHANGES` → `board.mjs move APP-NNN changes --by code-reviewer --verdict
     docs/53-reviews/APP-NNN-cycle-N.md`, then re-spawn the original developer **pointed at that
     file**, not at notes you are holding in context. You no longer have to remember to check the
     file exists — the append refuses without it, which is what "an unpersisted verdict is one
     compaction away from being lost" earns you once it is a mechanism instead of a paragraph.

     There is no `Cycles` column to increment any more. The count is the number of `changes` events,
     so it cannot drift from the ledger the way the hand-maintained column did.

     **Re-spawn one model tier up.** First attempt runs the role's default (its agent file's
     `model:`); every re-spawn after a `changes` runs the next tier — `haiku → sonnet → opus`,
     capped at opus. Pass it explicitly (the subagent tool's `model` parameter where the harness has
     one; otherwise state the tier in the prompt) and name the tier in the standup. A ticket that
     failed review is by definition harder than it looked, and this is the cheapest place to put
     effort where evidence already says it is needed. A `rejected` verify-done retry does **not**
     escalate — nothing was reviewed, so nothing said the work was hard.
   - **Cap: 2 review cycles, enforced at write time.** The 3rd `changes` is **refused**, and the CLI
     appends `blocked` in its place and prints the dependents that just stopped being claimable.
     That is not an error to work around: stop the loop for that ticket and surface it to the user
     with the full reviewer + developer history. Do not auto-retry beyond it.
   - A ticket going `blocked` here is exactly what strands its dependents — the CLI names them on
     the spot, and step 0 re-runs at the top of every round to catch the rest.

4a. **Release the slot and reap the pool.** When an owner has no tickets left in flight, release its
   lease and reclaim anything nothing is using:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" release --owner ios-developer
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply
   ```

   **Every terminal outcome, not only a merge** — `rejected`, a cap-converted `blocked`, a
   `BLOCKED:` return, a crashed round. The reaper derives liveness from the board and **never**
   `--force`s: a dirty worktree is reported and left alone, because that is somebody's unseen work.
   `orchestrator round` runs it read-only at step 0 and BLOCKS on the disk ceiling. Measured cost of
   the old merge-only rule: `scripts/worktree-reap.mjs` header.

5. **The wave integration pass — merge once, test once, push once.** Every ticket whose merge gate
   cleared is sitting at `qa` with its branch unmerged. This is where the git merges happen, and it
   is the only place the executable suite runs:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N> --base "$BASE"
   ```

   It merges every candidate `--no-ff` into `integration/wave-<N>` in its **own** worktree (never the
   shared tree, never an agent's slot), runs the project's `full` scope ONCE on the merged result,
   and prints what the outcome earns. Read its exit code:

   - Exit `0` **GREEN** → the merged tree passes. Run the `board.mjs move APP-NNN verified` lines it
     printed — that is what upgrades each ticket's `verified_static` and is the only thing that lets
     them reach `closed`. Then land it with **one** push:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N> --push
     ```

     One push, one CI run for the whole wave, which `ci-status.mjs` reads at the top of the next
     round (`orchestrator round`). **No agent ever triggers, re-runs or cancels a workflow.**
   - Exit `1` **FAIL or CONFLICT** → **the wave does not advance** and no ticket gets a real
     `verified`. A conflict aborts that one merge and the rest continue: resolve a textual one in the
     integration tree (`git-pr-strategy` §6), send a behaviour/contract one back as a ticket to the
     owner of that contract. For a failing suite, re-spawn only the owners its **candidate list**
     names — a candidate list is a filename heuristic, not a verdict. If no ticket's files appear at
     all, the wave broke something no single ticket touched: that is the composition failure a
     per-ticket build cannot see, and it goes to `tech-lead`, not a developer.
   - Exit `2` **CANNOT EVALUATE** → no `full` scope declared, or the suite could not run here. Not a
     pass. Every ticket keeps `verified_static`, `closed` stays refused, `ship-gate.sh` keeps
     blocking, and the wave branch is kept so the merged tree can be built where the toolchain is.
   - **A non-green wave is a normal outcome, not a stuck loop.** `merge-reconcile` reports those
     tickets as `AWAITING INTEGRATION` rather than as a board that is lying, so the next round starts
     normally. It did not, for one commit: see `scripts/merge-reconcile.mjs`.

   Then the runtime gate. **Once a wave of tickets is in `qa`, run the `runtime-gate` skill's script
   on the integration branch, before spawning `qa-engineer`**:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-gate.sh" --project-root .
   ```

   **Why here and not per-ticket after `verify-done.sh`:** one app build per wave instead of one per
   ticket, run on the merged tree — which is the only place "three individually-approved tickets and
   no composition root" is visible at all. A per-ticket run costs N builds to ask a question no
   single feature branch can answer.

   - Exit `0` → the app builds and launches. Name the evidence path in the standup and continue.
   - Exit `1` → **the wave does not advance.** No row moves `qa → done`. File it as an `S1` in
     `docs/51-bugs.md` (an app that does not build or launch is data-loss-tier by definition), so
     step 1 turns it into a `BUG-NNN-fix` ticket next round. Re-spawn the owning developer with the
     gate's compiler output **verbatim** — it printed it precisely so you would not have to
     paraphrase it.
   - Exit `2` → **CANNOT EVALUATE, which is not a pass.** Print its lines verbatim in the standup
     under `RUNTIME GATE: CANNOT EVALUATE`. QA still runs and rows may still advance on QA's own
     verdict, but nothing anywhere may record this build as having been launched — `/app-ship`
     re-runs the same gate and will ask again.
   - **A product type the script does not detect** (`backend-service`, `web-app`, `cli`, `library`)
     reaches exit `2` structurally, not accidentally. Record `N/A: runtime gate — product type
     <type> is outside runtime-gate.sh's detection` and run the equivalent for the type — service
     starts and answers a health check, page renders, `--help` exits 0, library builds and passes
     its suite — quoting the output. An N/A that replaces the check with nothing is a skip wearing
     a label.

   **Then the journey gate — because everything above proves the app is ALIVE, not that it WORKS.**

   ```bash
   # Pick the driver for the platform under test. `[--driver <path>]` used to be a LITERAL
   # placeholder here, which meant journey-gate was always invoked without one — so the drivers
   # described as "the seam the gate was built around" were unreachable, and every declared journey
   # was CANNOT EVALUATE for a reason nobody could see. A detector nobody calls is FC-002 with extra
   # steps; this is the call.
   #
   #   android  scripts/drivers/android.sh   drives adb + uiautomator; needs a device or emulator
   #   ios      scripts/drivers/ios.sh       launches and screenshots; step execution needs XCUITest
   #
   # With no device attached either driver returns CANNOT EVALUATE naming the missing thing, which
   # is the correct answer and NOT a pass.
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journey-gate.mjs" --root . \
     --driver "${CLAUDE_PLUGIN_ROOT}/scripts/drivers/android.sh"   # or drivers/ios.sh
   ```

   Six dry runs of this studio measured the same result: the gates caught **every** process defect
   and **zero** product defects. A date picker whose selection was discarded for
   `System.currentTimeMillis()`. A 24dp touch target where the spec said 56dp. A TalkBack
   announcement that stayed stale. Every one was found by a reviewer who went and looked, or by a
   human afterwards — and every one is fully compatible with `runtime-gate.sh` exit `0`, because an
   app that launches and sits there is alive.

   - Exit `0` → a declared P0 journey completed with its assertions holding. This is the only
     signal in the loop that means *the product does what it is for*. Name the evidence.
   - Exit `1` → **the wave does not advance**, same as a runtime FAIL. The product is wrong, not
     the harness — the gate distinguishes those, so do not re-spawn a developer against a broken
     driver.
   - Exit `2` → **CANNOT EVALUATE, which is not a pass.** Print it under
     `JOURNEY GATE: CANNOT EVALUATE` and say which of the two causes it was:
     - **No journey declared** → **rows may not move `qa → done` this wave.** This is a planning
       gap, not a tooling one: `ux-architect`'s screen-and-state inventory already names the ids, so
       declaring one is cheap, and its absence means nobody has written down what this product must
       do. Declare it and re-run. Letting the wave advance here is how a sprint reaches `/app-ship`
       with no P0 journey ever stated — and `/app-ship` will then ask the same question with more at
       stake (codex, PR #21).
     - **No driver available** → rows may advance on QA's own verdict, but **nothing may record this
       build as having had its journeys exercised**, and the standup carries the line verbatim.
       Drivers do not ship yet, so this is the expected path today; `/app-ship` re-asks and requires
       an explicit waiver rather than inheriting silence.

   Then run the QA pass **as a ticket**, not as an errand. Create the row first, so the wave's QA
   has an owner, a branch and a place on the board like any other work:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add QA-<sprint>-w<n> --title "QA pass — wave <n>" --owner qa-engineer
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move QA-<sprint>-w<n> claimed --by qa-engineer
   ```

   **The wave number is in the ID, not only the title.** Step 5 runs once per completed wave, so a
   fixed `QA-<sprint>` collides on the second one: `add` refuses the duplicate, and the existing row
   has already moved past `todo`, so `claimed` is refused too. Any sprint with more than one wave
   would then be unable to run the ticketed QA pass at all — the loop would fall back to QA as an
   errand, which is the untracked, unprovenanced shape this step was written to end (DR4-007).

   Then spawn `qa-engineer` once with that ticket ID to exercise the acceptance criteria; where the
   Axiom toolchain is present it drives the P0 journey per the `runtime-gate` skill rather than
   stopping at launch. QA writes new defects to `docs/51-bugs.md`. S1/S2 bugs come back into the
   loop in step 1 next round.

   **Its return goes through step 3 exactly like a developer's.** It is a DOC-profile ticket, so:
   `done_reported`, then `verify-done.sh <branch> "$BASE" --docs-only`, then the daily-fragment
   check, then review and the merge gate. A QA return with no `Branch:`, or a branch `verify-done`
   cannot find, is **REJECTED** — re-spawn QA to redo the pass on a branch. Do not accept the
   documents and move on: observed live, `50-test-plan.md` and `51-bugs.md` landed straight in the
   shared tree with no branch, commit, ticket or fragment, so the run's single best artifact had no
   provenance and was invisible to the board, the doctor, `verify-done` and the merge gate. Files
   appearing in the working tree is not evidence that a QA pass happened.

   Record QA's verdict per ticket, then close what passed:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN qa_passed --by qa-engineer
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN closed   --by tech-manager
   # or, for a ticket QA rejected — it stays in qa and is named in the summary
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN qa_failed --by qa-engineer --detail "BUG-NNN"
   ```

   `closed` is refused without a `qa_passed`, so `done` cannot be reached by a ticket QA never
   exercised. A `RUNTIME GATE: FAIL` means no row in the wave gets a `qa_passed` at all — the app
   does not launch, so nothing in it was exercised.

6. **Daily report + board view.** Collect the per-agent fragments at
   `docs/daily/<today>-<role>-<ticket>.md` and spawn `tech-manager` to concatenate them into the
   standup at `docs/daily/<today>.md` (both spellings from `team-protocol`'s paths table). Render the board so
   the state is visible rather than tabular:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-render.mjs" docs/31-board.md --out docs/32-board-view.md
   ```

   Print the terminal view in the standup. `docs/32-board-view.md` carries a Mermaid dependency
   graph that renders on GitHub — stranded and blocked tickets are outlined in red.

   Also surface what the channel still owes, and **escalate the founder's half to the founder**:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open
   node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" open --escalations
   ```

   An unanswered `question` is a `tech-manager` action item, not a thing to leave sitting. An
   **escalation** is not: `team-protocol` requires it to be *resolved or passed to the user in the
   same round*, and exit `1` from the second command means one is still open. **Surface those to the
   user verbatim in this round's report** — do not carry them to the next round.

   Until now an escalation was written to a ledger, counted by a renderer, and read by nobody: it is
   not a blocker, so the autonomous run never surfaced it.

6a. **Journal the round — one line, every round, before you loop.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/round-journal.mjs" append --round <N> \
     --tickets APP-001,APP-002 --verdicts approved=1,changes=1 \
     --agents ios-developer=2,code-reviewer=1 \
     --spawns <how many agents you launched> --retries <re-spawns> \
     --refusals <CLI/gate exit-1s this round> --wall-clock-sec <seconds>
   ```

   Then print the `BUDGET:` line from step 0a in the standup, so the spend is visible before it is a
   problem rather than at the moment it stops the run.

   `docs/31-board-events.jsonl` records what happened to **tickets**; `docs/33-rounds.jsonl` records
   what happened to the **loop** — rounds, spawns, retries, refusals. They are different questions
   and only the first was answerable, so nothing could say whether a run was converging or thrashing.
   Add `--spend-usd` only if the harness actually reported a number; otherwise leave it off and the
   field stays `null`, which every reader prints as "not measurable here".

7. **Loop** back to step 0 until the board has no ready `todo` rows and nothing in `review`/`qa`.

8. **Exit check — never declare a sprint done on an incoherent board.** Re-run the doctor one last
   time. Then print the sprint summary, which must explicitly account for **every** non-`done` row:
   blocked, stranded, and waiting tickets are named with their reason. A ticket that exists must
   never be absent from the summary. Suggest `/app-plan` (next sprint), `/app-ship` (release v1),
   or `/app-status` (inspect).

## Safety

- **Never spawn a writing agent without its own worktree** (or, failing that, serialized), and never
  spawn without `spawn-gate.sh` having said so — the rule was known, written and defended by the
  operator who then broke it. Measured cost:
  `docs/research/2026-07-29-dry-run-parallel-agent-collision.md`, and DR4-027.
- **No repo-wide `git reset` / `stash` / `checkout -- .` / `clean` / `add -A` / `add .`** by any
  agent sharing a tree — tell every agent so in its prompt. Need a clean tree to test? Copy to a
  temp dir. One of those commands cost 22 files of live work (`agent-isolation` Rule 2).
- **Never spawn while the board doctor reports an anomaly.**
- **Never move a row to `review` on an unverified `DONE`.**
- **Never advance a wave across a `RUNTIME GATE: FAIL`, and never record a `CANNOT EVALUATE` as a
  launched build.** Every other gate here checks that the process was followed; this is the only one
  that runs the artifact.
- **Never merge a branch containing another ticket's files.** That means a shared tree was used and
  the sibling ticket's branch is probably wrong too — stop the round and check both.
- Never spawn more than one agent for the same ticket simultaneously.
- Never auto-merge across a `REQUEST CHANGES`.
- Never re-spawn a developer past the 2-cycle cap without user input.
- **Spawn budget:** at most 6 developer retries per ticket across the whole sprint (review cycles
  plus rejected-DONE retries). Past that the ticket is `blocked` and goes to the user — a ticket
  that cannot converge in six attempts is a spec problem, not an effort problem.
- If any developer agent returns `BLOCKED: APP-NNN`, surface the blocker verbatim, append
  `board.mjs move APP-NNN blocked --by <owner-role> --detail "<the blocker>"`, and stop that ticket;
  do not invent an answer. Read the readiness cascade the CLI prints after it — those dependents are
  now unclaimable, and they are the tickets this loop has historically dropped in silence.
- **Never hand-edit `docs/31-board.md`.** It is generated. An edit survives until the next append,
  is read by nothing, and re-introduces exactly the drift between the table and the ledger that the
  event log exists to make impossible.
