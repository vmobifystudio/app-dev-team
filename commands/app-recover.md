---
description: Recover an interrupted run — reconcile the ledger, the board, the worktrees and the wave, then restart from a known state
argument-hint: [run id, optional — defaults to the newest non-terminal attempt]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# /app-recover — recover an interrupted run

Run / attempt: $ARGUMENTS

**This is the highest-stress command in the studio and it used to be eleven lines of prose invoking
nothing.** A run dies mid-flight with worktrees leased, tickets claimed, a wave half-merged and a
lease nobody released — and the instruction was to go and look. Every one of those states already has
a script that can answer it definitively; none of them was called. Meanwhile `/app-run-status` calls
`run-doctor`, `orchestrator round` calls four checks, and the command for the worst moment called
zero.

Work the four questions in order. **Each is a command, and each has a three-way answer.** Do not skip
to step 5 because an earlier step "looked fine" — a run that died is precisely the state in which
looking fine is cheap.

## 1. What was running, and is anything still holding a lease?

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-doctor.mjs" --root .
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-ledger.mjs" list --root .
```

- Exit `0` → no attempt is live. Continue.
- A live lease → **do not start a replacement.** Either the attempt is still running somewhere, or
  it died holding the lease. Establish which before writing anything:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/run-ledger.mjs" abandon --run <id> --attempt <n> \
    --detail "<what actually happened — an interruption is a fact, not an inference>"
  ```

  `abandon` is a terminal record and the ledger is append-only. **Never edit or re-anchor it by
  hand**: a broken chain is evidence, and repairing it destroys the only account of what happened.

## 2. Does the board still describe reality?

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
node "${CLAUDE_PLUGIN_ROOT}/scripts/merge-reconcile.mjs" --root .
```

`merge-reconcile` is the one that matters here, and **read its wording carefully** — it now
distinguishes two states that look identical from the outside:

- `AWAITING INTEGRATION` → merge-gated, carrying `verified_static`, wave not yet run. **Nothing is
  wrong.** Go to step 4 and land the wave.
- `BLOCKED — claims integrated code that is NOT in <base>` → a ticket says its code shipped and git
  disagrees. That is a real inconsistency and the likeliest thing a crash leaves behind. Correct the
  record by appending, never by editing:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move APP-NNN corrected --by tech-manager \
    --detail "the run died between the merge gate and the merge; the branch is not integrated"
  ```

A ticket stuck at `in_progress` whose agent is gone is **not** repaired by pretending it finished:
`board.mjs move APP-NNN blocked --by tech-manager --detail "run <id> died mid-ticket"`, and let the
next round re-claim it.

## 3. What is still holding disk, and is anyone's work in it?

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" list --root .
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root .
```

Read before you reap. A crashed run is the one case where a worktree may hold **uncommitted work
nobody has seen** — the reaper refuses to remove a dirty tree and reports it as `ORPHAN*`, and that
report is the point. Open those trees, decide what the work was, and commit or discard it
deliberately. Only then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" release --owner <role>   # per stale lease
```

Never `git worktree remove --force` by hand. One `git stash` in a shared tree already cost 22 files
of live work (DR4-027); doing it during a recovery, when nobody knows what was in flight, is the same
move with worse information.

## 4. Was a wave half-landed?

```bash
git branch --list 'integration/wave-*'
```

A wave branch that survives a crash holds real merges. **It is not garbage** — `wave-integrate.mjs`
keeps it deliberately on every non-green outcome so the merged tree can be inspected. Either finish
it or discard it, explicitly:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/wave-integrate.mjs" --root . --wave <N>   # re-run; it refuses
                                                                              # to reuse a wave number
git branch -D integration/wave-<N>   # only once you know what it holds
```

Re-running the same wave number is **refused**, on purpose: merging on top of a previous run's result
and reporting it as a fresh integration is how a half-landed wave becomes an invisible one. Either
delete the branch knowingly or use the next number.

## 5. Restart from a known state

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/orchestrator.mjs" round --root .
```

Only when it exits `0` is the studio recovered. A replacement attempt carries forward the same ticket
and a **fresh** context manifest — the old one described a world that no longer exists.

Then resume with `/app-build` (mid-sprint) or `/app-run` (autonomous).

## What this command must never do

- **Never clear `.studio-stop`.** If an operator halted the studio, a crash is not evidence that the
  halt no longer applies.
- **Never fabricate a terminal record** to make the ledger tidy. `abandon` says what happened;
  anything else says what would have been convenient.
- **Never advance a ticket to make the board coherent.** Repair is by appending a correction, and a
  correction that moves a row is a lie with better manners.
