---
name: parallel-orchestrator
description: Use to launch the round's IC agents in parallel via the subagent tool (Task/Agent) once the board has ready tickets. Run by the /app-build orchestrator (the main session) as its step 2; holds the rules for safe concurrent agent execution.
---

# Parallel orchestrator

The one copy of the launch procedure, run from `/app-build` step 2 by the main session once
`orchestrator.mjs round` (step 0) is clear and the board has ready `todo` tickets. `/app-build` owns
everything before and after the launch — the round preconditions, verifying each `DONE`, the merge
gate, the wave pass and the journal. Its rare branches live in `references/build-loop-branches.md`.
For the isolation rules you enforce here, read `agent-isolation` and
`skills/agent-isolation/references/orchestrator.md`.

## Procedure

1. **Pick the ready tickets** from `node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json`:
   `todo`, every `dependsOn` merged (`qa` or `done`). A ticket behind a `blocked` dependency is never
   ready and never reported by this rule — that is the doctor's `stranded` check at step 0.

1a. **Claim before you spawn** — one append per ticket; it is also the readiness check:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-001 claimed --by ios-developer
   ```

   `claimed` is **refused** on a ticket whose dependency never merged. Spawn nobody for it and say why
   in the standup. Claiming first also closes the window in which two orchestrators hand out the
   same ticket.

2. **Group by owner.** One agent invocation per owner, batched: each owner gets all its ready tickets
   in one prompt.

2a. **Lease one slot per writing agent:**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner ios-developer --tickets APP-001,APP-004 --pool 3
   node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner android-developer --tickets APP-002 --pool 3
   ```

   The owner works its tickets **one after another in that slot**, one `feat/APP-NNN-slug` branch per
   ticket. `lease` refuses when the pool is full — that is the parallelism cap; raising `--pool N` is
   a decision about how much of the machine the studio may use, not a workaround.

2a-i. **Tell every agent, in its prompt, that destructive commands are banned** repo-wide:

   ```
   git reset (--hard or otherwise)   git stash   git checkout -- .
   git clean                          git add -A / git add . / git commit -a
   ```

   Stage by explicit path; need a clean tree → copy the repo to a temp dir; HEAD moved → stop and
   report (`agent-isolation` Rules 2 and 5).

2b. **Check for file overlap, not just feature independence.** List the files each ticket is likely
   to touch (impl spec, the ticket's `--file` set). Any pair sharing a file is **serialized**.

3. **Compose each agent's prompt with `spawn-prompt.mjs` — do not hand-write it.**

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-prompt.mjs" compose \
     --root . --ticket APP-NNN --role <owner> --slot .agent-wt/<owner>
   ```

   Use its stdout as the spawn message **verbatim**: ticket, board entry, spec pointers, the slot path
   as the project root, and **the output contract inlined as literal text**. A prompt that *points
   at* the contract instead of containing it gets back reports missing every field — measured, same
   model and role. `spawn-prompt.mjs verify --role <owner> --prompt <file>` confirms the labels are
   there.

3a. **Run the isolation gate, last, and obey it.**

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ios-developer android-developer
   ```

   It takes **OWNERS**, because that is what has a tree each, and its exit code decides the launch:

   - `0 GO` → spawn. With one owner it prints `SERIALIZED` — the legal one-writer path, valid only
     while the writer stays alone. Say so in the standup.
   - `1 REFUSED` → **spawn nobody.** It names the owners missing a worktree and prints the
     `git worktree add` line for each. Create them and re-run, or serialize the round.
   - `2 CANNOT EVALUATE` → not a git repo. Serialize; never treat a 2 as a go-ahead.

   **It is also the studio kill switch.** If `.studio-stop` exists at the repository root (or
   `APP_TEAM_STOP` is set), it refuses with `EMERGENCY STOP` and the recorded reason: spawn nobody,
   report what is unfinished, stop the loop. **You never clear `.studio-stop` yourself.** An operator
   sets it with `echo "reason" > .studio-stop` and clears it with `rm .studio-stop`.

4. **Launch in a single message.** Multiple subagent (`Task`/`Agent`) invocations in the same
   assistant message, one per owner, each given its slot path and its full ticket list. Sequential
   launches give up the parallelism.

5. **Stream the reviews — do not wait for the batch.** Each `DONE` goes through `/app-build` step 3
   as it lands: `report-check`, `done_reported`, then `verify-done.sh` against the base from
   `integration-branch.sh` (resolved once per round, never a hardcoded `main`; exit 2 stops the
   round). It has **three** outcomes:

   | Line 1 | Exit | Do |
   |---|---|---|
   | `VERIFIED` | 0 | `board.mjs move APP-NNN verified --by tech-manager`, then `review_requested` |
   | `REJECTED` | 1 | The row stays. Re-spawn that developer with the blocking lines verbatim |
   | `CANNOT EVALUATE` | 2 | `board.mjs move APP-NNN verified_static --by tech-manager --detail "<what could not run>"`, then `review_requested`. **Do not re-spawn the developer — there is no failure to fix** |

   `verified_static` keeps review alive for a ticket blocked only by its environment: it unlocks
   `review_requested`, `approved` and `merged`, refuses `closed`, and `ship-gate.sh` blocks on it.
   Spawn a `code-reviewer` for each passing branch in the next message; reviewers run in parallel
   with each other **and** with still-running developers.

6. **Escalate the model on a retry.** First attempt: the role's default tier (its agent file's
   `model:`). A re-spawn after `REQUEST CHANGES` runs **one tier up**, capped at the top:

   ```
   haiku → sonnet → opus → opus
   ```

   Pass it explicitly (the subagent tool's `model` parameter, or say so in the prompt) and note it in
   the standup. A `rejected` verify-done retry is *not* an escalation: nothing was reviewed, so
   nothing said the work was hard.

## Warm managers (optional — the portable default is respawn)

Where the harness supports named agents plus `SendMessage`, `tech-manager` and `tech-lead` may
**persist across a sprint** instead of being respawned cold each round. The only condition that
makes this safe: **all durable state stays in files** — the event log, the ledger, the board, the
fragments, the round journal. A warm manager is a cache, never a source; kill it and the next cold
respawn reads the same files and continues. With no named agents, respawn per round is the
portable baseline every other step assumes.

## Anti-patterns

- Sequential launches when parallel is safe; parallel launches when two tickets share a file.
- Editing `docs/31-board.md` to record a result — it is generated from the log.
- Retrying past a refusal — exit 1 from `board.mjs` is a rule catching something; fix what it names.
- Believing a `DONE` you did not verify, or spawning against a board you did not check.
- Spawning without running `spawn-gate.sh` — isolation you remembered is not isolation you checked.
- Re-spawning after `REQUEST CHANGES` at the tier that just failed.

## Worked example

```
APP-001 todo ios-developer       APP-003 todo backend-developer
APP-002 todo android-developer   APP-004 todo ios-developer (depends on APP-001)

[same message]  Agent(ios-developer, APP-001) · Agent(android-developer, APP-002) · Agent(backend-developer, APP-003)
[as each DONE verifies]  Agent(code-reviewer, feat/APP-00N-...)
```

APP-004 is not launched until APP-001 merges; then it goes to ios-developer in parallel with
whatever else is ready.
