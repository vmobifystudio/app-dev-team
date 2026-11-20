# agent-isolation — the orchestrator's half

Loaded from `agent-isolation` SKILL.md by whoever **spawns** writing agents (the `/app-build` main
session via `parallel-orchestrator`). An IC does not need this file.

## Rule 1 — one worktree per WRITING AGENT, always

Before spawning any agent that writes, lease its slot — one spawn per ticket, so one lease per
ticket:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner ios-developer --tickets APP-001
```

Slots are keyed `<owner>-<n>` (`.agent-wt/ios-developer-1`, `.agent-wt/ios-developer-2`, …) up to
the scheduler's cap, so one platform can run several ICs at once; use the path `lease` prints. The
agent is given that path as its **project root** and never leaves it, and cuts its branch **from the
integration branch** (`git checkout -b feat/APP-001-short-slug <integration branch>`, the base
`compose` prints) — never from whatever the slot last held, or a reused slot's second branch carries
the first ticket's commits (`code-reviewer` check 9). Disk is bounded by the cap, not the backlog.

**Verifiers and auditors get one too.** "Read-only" describes the intent, not the guarantee.

Cleanup — on **every** terminal outcome (`rejected`, a cap-converted `blocked`, a `BLOCKED:` return,
a crashed round), not only after a merge; a merge-only rule leaks a tree per failure:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" release --owner ios-developer-1   # the slot name lease printed
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply
```

`worktree-reap.mjs` derives liveness from the board (`in_progress`/`review`) and **never** runs
`--force`: a worktree with uncommitted changes is reported loudly and left where it is. Build caches
live **outside** the slots (`${CLAUDE_PLUGIN_ROOT}/scripts/build-env.sh` → `.studio-cache/`), so reaping never throws away a
warm build.

`.agent-wt/` **must be in `.gitignore`** — `/app-init` adds it for new projects; on an existing
project `/app-onboard` step 4a adds it (with the other operational paths) before the first spawn, or every agent's `git status` shows it as untracked noise and
invites a blanket `git add`.

## Shared-tree writes — the test is collision, not location

| Artifact | Where | Why |
|---|---|---|
| all source and test code | **worktree only** | two agents on one file is the corruption case |
| `docs/daily/<today>-<role>-<ticket>.md` | **worktree**, committed on the branch | reaches `main` at merge; name the worktree-relative path when you spawn |
| `docs/53-reviews/APP-NNN-cycle-N.md` | shared tree — **safe** | unique per (ticket, cycle) and must outlive a rejected branch |
| `docs/31-board.md` | shared tree — **generated, CLI-only** | `board.mjs` regenerates it from `docs/31-board-events.jsonl` on every event; mutate with `board.mjs move`, never an editor |
| `docs/31-board-events.jsonl`, `docs/team/messages.jsonl` | shared tree — **append-only, via their CLI** | `board.mjs` / `team-message.sh` validate then append; their Markdown views are generated |

A shared write is safe when **no other agent can write that same path**. Anything else is
worktree-only.

If the project genuinely cannot use worktrees (not a git repo, or a tool that needs the canonical
path), writing agents **must be serialized** — one at a time, each branching in the repo root and
committing before the next starts — and the daily fragment says so and why.

## The gate, not your memory

Before the launch message:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ios-developer-1 android-developer-1
```

It takes the **slot names** you leased (`ios-developer-1 android-developer-1`), because the slot is
keyed by the writer. Exit 1 = REFUSED, spawn nobody; it
names which owners lack a worktree and prints the command to create each. Exit 0 with one owner =
the serialized path, stated in the output so it reaches the standup. See `parallel-orchestrator`
step 3a.

## Orchestrator checklist

Before a parallel launch:

- [ ] `spawn-gate.sh <the slot names>` exits 0 — the gate said so, not your belief
- [ ] Each writing agent has its own leased worktree (`.agent-wt/<owner>-<n>`)
- [ ] Each agent's prompt names **its worktree path** as the project root, not the repo root
- [ ] No two agents are assigned the same file (if unavoidable, serialize those tickets)
- [ ] Agents are told: explicit-path staging only, no repo-wide destructive command, confirm the
      mutation landed

After each agent returns:

- [ ] `verify-done.sh` before believing `DONE` (Rule 4)
- [ ] `git diff --cached --numstat` on the branch shows only that ticket's paths
- [ ] Slot released and the pool reaped on every terminal outcome
