---
description: Plan the next sprint — tech-manager turns backlog + impl specs into a parallelizable board
argument-hint: [sprint number or feature focus, optional]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-plan — Plan the next sprint

Focus (optional): $ARGUMENTS

## Steps

1. **Confirm prerequisites exist**: `docs/11-backlog.md` and **at least one**
   `docs/22-impl-spec-*.md`. Plan against whatever platforms have a spec.

   Requiring both an iOS *and* an Android spec fails every single-platform project —
   `requirements-intake` asks "iOS, Android, or both" — and every brownfield project, whose specs
   arrive as `/app-onboard`'s per-platform `docs/22-impl-spec-<platform>.md` snapshots. Both were
   then told to run `/app-init`, which greenfield had just run and which `/app-onboard` explicitly
   tells brownfield users not to run.

   If the backlog or *every* spec is missing, stop and name the missing file, then suggest
   `/app-init` for an empty directory or `/app-onboard` for a directory that already has code.
   Never suggest `/app-init` on a project that has an app in it.

1a. **Adopt the event log before adding anything to it.** The board is now generated from
   `docs/31-board-events.jsonl`; `docs/31-board.md` is its rendering. A project planned before this
   existed has the board and not the log, and `board.mjs add` on that project would create a
   one-ticket log and render **over** the hand-written board. So migrate first, once, and say so:

   ```bash
   if [ ! -f docs/31-board-events.jsonl ] && [ -f docs/31-board.md ]; then
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" migrate docs/31-board.md --out docs/31-board-events.jsonl \
       && node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" render \
       && echo "MIGRATED: hand-written board -> event log"
   fi
   ```

   Print what it reported: how many events it reconstructed, how many are `inferred` (`ts: null`,
   because the hand-written board never recorded them), and every `note:` line — a `Cycles` column
   disagreeing with the ledger is named there, and the migration takes the ledger.

   **If migrate exits non-zero, do not stop and do not retry it.** A board too old to parse (no
   Reviewer/Cycles columns, no ledger) has nothing to reconstruct from. Say
   `LEGACY BOARD: no event log — running the hand-written path` and continue; `board-doctor` is the
   backstop for that project exactly as it was before. Neither is an error state: a project with no
   board at all is the normal greenfield case, and step 2 creates its log from nothing.

2. **Spawn the `tech-manager` agent** with the `sprint-planner` skill. It produces
   `docs/30-sprint-plan.md`, and creates every ticket through the CLI — one call per ticket, never a
   hand-written table row:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add APP-001 \
     --title "..." --feature F-001 --owner ios-developer --depends APP-000 \
     --estimate M --spec "prd#F-001" --acceptance "Given ..., When ..., Then ..." --by tech-manager
   ```

   Each `add` re-renders `docs/31-board.md`, so the board exists as a side effect of the tickets
   existing. A duplicate ID is **refused** (exit 1) rather than silently written twice — read the
   refusal, it is telling you the ticket is already planned.

   On a project that fell through to the legacy path at step 1a, `tech-manager` writes the table by
   hand as before and runs `board-doctor` after.

3. **Spec-critic pass — remove the ambiguity before anyone builds on it.** Spawn `tech-lead` with
   the `spec-critic` skill. It reads the board and the impl specs, files one `question` row per
   ambiguous ticket in `docs/team/messages.jsonl`, and answers what it can in the same run — it wrote
   the specs, so most answers are one line — folding each answer back into the impl spec.

   Print the questions raised and the ones answered. Anything still open becomes a `tech-manager`
   action item under the unanswered-question rule in `team-protocol`; it does not block the sprint.

   This runs **after** the board exists and **before** `/app-build` spawns anyone. Measured across
   ten agent-runs, no IC ever raised a spec question live — they guess and move on, and a wrong
   guess costs a full review-and-rework cycle.

4. **Print the sprint goal, the per-track assignment, and dependency edges.** Show what's parallel and what's serial.

5. **Hand off.** When a human invoked `/app-plan` directly, ask "ready to launch the pod with
   `/app-build`?" and do not auto-launch.

   **When `/app-plan` was invoked by `/app-run` (its step 3), do not ask — print the plan and
   continue.** `/app-run` stops for exactly two human gates, scope-lock and ship, and scope was
   already approved at its Gate 1. A question here is an undocumented third gate that stalls an
   autonomous run for an approval the user has already given.
