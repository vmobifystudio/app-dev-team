---
description: Open the control room — a live page showing why work is stuck, what was never executed, and what belongs to nobody
allowed-tools: Read, Glob, Grep, Bash
---

# /app-dashboard — The control room

A **projection** of `docs/`, served on `localhost:4173`. It never writes state: where it acts, it
invokes the same validated CLI the agents use and shows you the command and its exit code.

## Steps

1. **Start it** from the project root:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/studio-dashboard.mjs" --project . --port 4173
   ```

   Print the URL it emits and stop. Do not summarise the panels — the page is the output, and a
   summary of a live page is stale the moment it is written.

   Flags: `--port N` if 4173 is taken · `--no-actions` for a strictly read-only session.

2. **Or export a static copy** to share with someone who will not run a server:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/studio-dashboard.mjs" --project . --export docs/32-board-view.html
   ```

   One self-contained file: the state is baked in, there is no server, and the action buttons are
   absent because a file on disk cannot invoke a CLI. It is a **snapshot** — it carries its
   generation timestamp in the header for exactly that reason. Regenerate it, never hand-edit it.

## What it shows, in this order

The order is the deliverable. On a blocked sprint a burn-down is a flat line that explains nothing,
so this leads with cause, not progress.

| # | Panel | The question it answers |
|---|---|---|
| 1 | **Why is nothing moving** | every blocked ticket **with its recorded reason**, every ticket stranded behind one, and every gate that returned CANNOT EVALUATE with what it could not evaluate |
| 2 | **Inspectable but not runnable** | work verified statically (`qa (static only)`) and what was never executed — plus "N awaiting review, 0 reviewers ever acted", the fact that would have caught DR4-002 in seconds |
| 3 | **Unowned artifacts** | a file a spec requires that does not exist and that no ticket names |
| 4 | **Work with no provenance** | files changed in the tree, and commits made since the board existed, belonging to no ticket |
| 5 | **Question → answer → delivery** | open questions, and answers that **name no artifact they were folded into** — a closed ledger is not delivery |
| 6 | **Board** | kanban and per-owner load, the same semantics as `board-render` |
| 7 | **Metrics** | cycle time, review pass rate, rework rate, gates fired. `n/a`, never `0%`, on an empty denominator |
| 8 | **Timeline** | the event log, most recent first. Forensics, deliberately last |

**Every panel states the population it swept.** A panel with nothing in it says either `CLEAR — `
followed by what it looked at, or `CANNOT EVALUATE` followed by what it could not read. It never
renders empty and lets you read that as all-clear.

## The three actions

Whitelist only. Anything else is refused by the server, not hidden by the page.

- **Unblock a ticket** — requires a reason, runs `board.mjs move <ID> unblocked --by <role> --detail <reason>`
- **Answer an open question** — runs `team-message.sh --kind answer`. Name the artifact you folded
  the answer into, or panel 5 will keep flagging it, correctly
- **Assign an unowned artifact** — records a `decision` on the team ledger naming the owning ticket

Each shows the command it ran and its exit code. **If the CLI refuses, the refusal is printed
verbatim** — a refusal is a finding, not an error to swallow.

Deliberately not actionable: re-prioritisation. Nobody wanted it once in a real run, and every
button here is one more thing that must stay in step with the CLI's rules.

## Reading it

- `/state` is plain JSON on the same port if you want to pipe it somewhere.
- The page refetches by itself: `fs.watch` on `docs/` with a 2s debounce over Server-Sent Events.
- No board yet → it says so. No event log → it says so, and every number derived from the log is
  marked CANNOT EVALUATE rather than shown as zero.

## Output

The URL, or the path of the exported file. Nothing else — the page is the report.
