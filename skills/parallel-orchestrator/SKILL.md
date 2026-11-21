---
name: parallel-orchestrator
description: On an app-dev-team project, use to launch the round's IC agents in parallel via the subagent tool (Task/Agent) once the board has ready tickets. Run by the /app-build orchestrator (the main session) as its step 2; holds the rules for safe concurrent agent execution.
---

# Parallel orchestrator

The one copy of the launch procedure, run from `/app-build` step 2 by the main session once
`orchestrator.mjs round` (step 0) is clear and the board has ready `todo` tickets. `/app-build` owns
everything before and after the launch — the round preconditions, verifying each `DONE`, the merge
gate, the wave pass and the journal — and holds the one copy of the verify-done outcomes, the model
ladder and the token form. Rare branches: `references/build-loop-branches.md`. The commands below
already enforce `agent-isolation`'s orchestrator half; read
`skills/agent-isolation/references/orchestrator.md` only for a project that cannot use worktrees.

## Procedure

1. **Pick the ready tickets** from `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json`:
   `todo`, every `dependsOn` merged (`qa` or `done`) **and its wave landed** — a dependency whose
   wave is still `AWAITING INTEGRATION` is not on the integration branch the IC branches from. A ticket behind a `blocked` dependency is never
   ready and never reported by this rule — that is the doctor's `stranded` check at step 0. Spawn a
   designer, researcher or QA owner only when its ticket is ready — never "to get ahead".

1a. **Preflight, then claim, then spawn** — every ticket, `QA-` tickets included. Run
   `dispatch-preflight` (`/app-build` top) first; claim only on CLEAR. Preflight checks the
   scheduler's `ready` set, which only holds `todo` tickets, so a ticket claimed first is
   `in_progress` and is refused. Then one append per ticket:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-001 claimed --by ios-developer
   ```

   `claimed` is **refused** on a ticket whose dependency never merged. Spawn nobody for it and say why
   in the standup. Claiming first also closes the window in which two orchestrators hand out the
   same ticket.

2. **One spawn per ticket, one slot per spawn.** Never batch an owner's tickets into one prompt —
   `compose` takes exactly one `--ticket`, and two agents never share a slot. Slots are keyed
   `<owner>-<n>`, up to the scheduler's cap, so one platform can run several ICs at once. An owner
   with more ready tickets than free slots: the rest wait for a slot to free, in a later round.

2a. **Lease the slot for each ticket:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner ios-developer --tickets APP-001
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner ios-developer --tickets APP-004
   ```

   Use the slot path each `lease` prints (`.agent-wt/ios-developer-1`, `-2`). `lease` refuses when
   the pool is full — that is the scheduler's cap (`scheduler.mjs cap`); raising it is a decision
   about how much of the machine the studio may use, not a workaround.

2a-i. **Every agent's prompt carries the destructive-command ban** — `git reset`, `git stash`,
   `git checkout -- .`, `git clean`, `git add -A` / `.` / `commit -a` (`agent-isolation` Rules 2, 5;
   the hook enforces it).

2b. **Check for file overlap, not just feature independence.** List the files each ticket is likely
   to touch (impl spec, the ticket's `--file` set). Any pair sharing a file is **serialized**.

3. **Compose each agent's prompt with `spawn-prompt.mjs` — do not hand-write it.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-prompt.mjs" compose \
     --root . --ticket APP-NNN --role <owner> --slot <the path lease printed>
   ```

   Use its stdout as the spawn message **verbatim**: ticket, board entry, spec excerpts, the slot
   path as the project root, the integration branch the IC cuts its branch from
   (`git checkout -b feat/APP-NNN-slug <integration branch>` — never from the slot's last HEAD), the
   minted `Token:` line, and **the output contract inlined as literal text**. A prompt that *points
   at* the contract gets back reports missing every field — measured, same model and role. The
   PreToolUse hook `require-spawn-contract.sh` re-verifies every spawn naming a board ticket; a
   prompt it refuses was not composed.

   Gate roles are composed the same way, one ticket each: `--role code-reviewer` (`--mode design-qa`
   for the design-QA pass, also for `ux-architect`), `tech-lead` (second approval),
   `security-reviewer` (per-ticket review; required on `critical`), `verification-engineer`,
   `release-auditor`. A `QA-` ticket's compose lists every ticket of the wave with its acceptance
   criteria and mints one `qa-engineer` token per listed ticket (`Token for APP-NNN: …`).

3a. **Run the isolation gate, last, and obey it.**

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ios-developer-1 ios-developer-2 android-developer-1
   ```

   It takes the **slot names** you leased, because that is what has a tree each, and its exit code
   decides the launch:

   - `0 GO` → spawn. With one slot it prints `SERIALIZED` — the legal one-writer path, valid only
     while the writer stays alone. Say so in the standup.
   - `1 REFUSED` → **spawn nobody.** It names the slots missing a worktree and prints the
     `git worktree add` line for each. Create them and re-run, or serialize the round.
   - `2 CANNOT EVALUATE` → not a git repo. Serialize; never treat a 2 as a go-ahead.

   **It is also the studio kill switch.** If `.studio-stop` exists at the repository root (or
   `APP_TEAM_STOP` is set), it refuses with `EMERGENCY STOP` and the recorded reason: spawn nobody,
   report what is unfinished, stop the loop. **You never clear `.studio-stop` yourself.** An operator
   sets it with `echo "reason" > .studio-stop` and clears it with `rm .studio-stop`.

4. **Launch in a single message.** Multiple subagent (`Task`/`Agent`) invocations in the same
   assistant message, one per ticket, each given its own slot path. Sequential launches give up the
   parallelism.

5. **Stream the reviews — do not wait for the batch.** Each `DONE` goes through `/app-build` step 3
   as it lands, against the base `integration-branch.sh` resolves. verify-done has three outcomes — `VERIFIED`, `REJECTED` (re-spawn the developer),
   `CANNOT EVALUATE` (record `verified_static`, **do not re-spawn**) — and the per-ticket default is
   `--static`, which is always the third. Spawn a `code-reviewer` for each passing branch in the next
   message; reviewers run in parallel with each other **and** with still-running developers.

6. **Escalate the model on a retry** after `REQUEST CHANGES`: `haiku → sonnet → opus`, capped at
   opus, passed as the subagent tool's `model` parameter (`/app-build` step 4). A `rejected`
   verify-done retry is *not* an escalation: nothing was reviewed, so nothing said the work was hard.

## Warm managers (optional — the portable default is respawn)

Where the harness supports named agents plus `SendMessage`, `tech-manager` and `tech-lead` may
**persist across a sprint** instead of being respawned cold each round. The only condition that
makes this safe: **all durable state stays in files** — the event log, the ledger, the board, the
fragments, the round journal. A warm manager is a cache, never a source; kill it and the next cold
respawn reads the same files and continues. With no named agents, respawn per round is the
portable baseline every other step assumes.

## Anti-patterns

- Sequential launches when parallel is safe; parallel launches when two tickets share a file.
- One prompt carrying several tickets, or a second ticket in a slot still holding the first.
- Editing `docs/31-board.md` to record a result — it is generated from the log.
- Retrying past a refusal — exit 1 from `board.mjs` is a rule catching something; fix what it names.
- Believing a `DONE` you did not verify, or spawning against a board you did not check.
- Spawning without running `spawn-gate.sh` — isolation you remembered is not isolation you checked.
- Re-spawning after `REQUEST CHANGES` at the tier that just failed.

## Worked example

```
APP-001 todo ios-developer       APP-003 todo backend-developer
APP-002 todo android-developer   APP-004 todo ios-developer
APP-005 todo ios-developer (depends on APP-001)

[same message]  Agent(ios-developer, APP-001, ios-developer-1) · Agent(ios-developer, APP-004, ios-developer-2)
                · Agent(android-developer, APP-002, android-developer-1) · Agent(backend-developer, APP-003, …-1)
[as each DONE verifies]  Agent(code-reviewer, feat/APP-00N-...)
```

APP-005 is not launched until APP-001 merges; then it gets a fresh slot, branched from the
integration branch, in parallel with whatever else is ready.
