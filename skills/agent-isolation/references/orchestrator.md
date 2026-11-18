# agent-isolation — the orchestrator's half

Loaded from `agent-isolation` SKILL.md by whoever **spawns** writing agents (the `/app-build` main
session via `parallel-orchestrator`). An IC does not need this file.

## Rule 1 — one worktree per WRITING AGENT, always

Before spawning any agent that writes, lease its slot:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" lease --owner ios-developer --tickets APP-001,APP-002
```

The agent is given that path — `.agent-wt/ios-developer` — as its **project root** and never leaves
it. It cuts `feat/APP-001-short-slug`, commits, then cuts `feat/APP-002-short-slug` from the same
base and commits: **one branch per ticket, unchanged**.

**The slot is keyed by the WRITER, never the ticket.** `parallel-orchestrator` spawns one agent per
owner, batched, and names one worktree path in its prompt; a per-ticket key gave an owner of three
tickets three worktrees and one path that did not exist, and every branch then carried its siblings'
files (`code-reviewer` check 9). One agent working its tickets one after another in its own tree
corrupts nobody. Disk is bounded by the scheduler's cap rather than by the backlog.

**Verifiers and auditors get one too.** "Read-only" describes the intent, not the guarantee.

Cleanup — on **every** terminal outcome (`rejected`, a cap-converted `blocked`, a `BLOCKED:` return,
a crashed round), not only after a merge; a merge-only rule leaks a tree per failure:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-slot.mjs" release --owner ios-developer
node "${CLAUDE_PLUGIN_ROOT}/scripts/worktree-reap.mjs" --root . --apply
```

`worktree-reap.mjs` derives liveness from the board (`in_progress`/`review`) and **never** runs
`--force`: a worktree with uncommitted changes is reported loudly and left where it is. Build caches
live **outside** the slots (`scripts/build-env.sh` → `.studio-cache/`), so reaping never throws away a
warm build.

`.agent-wt/` **must be in `.gitignore`** — `/app-init` adds it for new projects; on an existing
project add it before the first spawn, or every agent's `git status` shows it as untracked noise and
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
path), writing agents **must be serialized** — one at a time, each committing before the next
starts — and the daily fragment says so and why.

## The gate, not your memory

Before the launch message:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/spawn-gate.sh" ios-developer android-developer
```

It takes the **owners**, because the slot is keyed by the writer. Exit 1 = REFUSED, spawn nobody; it
names which owners lack a worktree and prints the command to create each. Exit 0 with one owner =
the serialized path, stated in the output so it reaches the standup. See `parallel-orchestrator`
step 3a.

## Orchestrator checklist

Before a parallel launch:

- [ ] `spawn-gate.sh <the owners>` exits 0 — the gate said so, not your belief
- [ ] Each writing agent has its own leased worktree (`.agent-wt/<owner>`)
- [ ] Each agent's prompt names **its worktree path** as the project root, not the repo root
- [ ] No two agents are assigned the same file (if unavoidable, serialize those tickets)
- [ ] Agents are told: explicit-path staging only, no repo-wide destructive command, confirm the
      mutation landed

After each agent returns:

- [ ] `verify-done.sh` before believing `DONE` (Rule 4)
- [ ] `git diff --cached --numstat` on the branch shows only that ticket's paths
- [ ] Slot released and the pool reaped on every terminal outcome
