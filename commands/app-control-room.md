---
description: Open the full control room — five screens (Mission Control, Communications, Board, Team, Founder Inbox) in the browser
allowed-tools: Read, Glob, Grep, Bash
---

# /app-control-room — The five screens

The **product** interface. A React app in `control-room/`, with its own dependencies, served by a
Node-stdlib data plane. It is a **projection**: nothing on it writes state.

For the zero-dependency diagnostic dashboard — the one that works when this build is broken — use
`/app-dashboard`. Both exist permanently and neither replaces the other.

## Steps

1. **Build it once** (only needed after a fresh clone or a UI change):

   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}/control-room" && npm install && npm run build
   ```

   If this fails, say so and point the user at `/app-dashboard`. The plugin is correct with the UI
   absent; a broken frontend build is never a reason a project cannot be inspected.

2. **Start it** from the project root:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/control-room/server.mjs" --project . --port 4174
   ```

   Print the URL it emits and stop. Do not summarise the screens — the page is the output, and a
   summary of a live page is stale the moment it is written.

   Flags: `--port N` if 4174 is taken · `--no-actions` for a strictly read-only session.

   With `dist/` absent the server still runs: `/state` is live and the page it returns names the two
   commands that build the UI. It never serves a blank page.

## The five screens

| Screen | The question it answers |
|---|---|
| **Mission Control** | phase · **why work is not moving, first** · active agents · budget position · latest verification · release readiness. There is no burn-down: on a blocked sprint a burn-down is a flat line that explains nothing |
| **Communications** | channels and per-ticket threads as a readable conversation, with the structured metadata beside each message (ticket, requirement, decision, artifact updated, verification required). Open questions loudest, flagged when the ticket already shipped. Answers that **name no artifact** are called out — a closed ledger is not delivery |
| **Board** | kanban, per-owner load, NEEDS ATTENTION with the reason, and `qa (static only)` carried visibly in the cell a human reads |
| **Team** | the activated roster: every role, its trigger, what it is working on, and what is `off` **with its reason**. A deactivated role is recorded, never silently absent |
| **Founder Inbox** | decisions required, each with its context, the recommendation **quoted from the log**, and the action. Where nobody recorded a remedy it says so — this page never invents advice |

**Every section states the population it swept**, and is one of `attention`, `clear`, `info` or
`unavailable`. `clear` is a claim that requires its inputs: with an unreadable log every
log-derived section reads **CANNOT EVALUATE**, never "clear" and never silently empty.

## The three actions

The same whitelist as `/app-dashboard` — literally the same module, `scripts/lib/actions.mjs`.
Anything else is refused by the server, not hidden by the page.

- **Unblock a ticket** — requires a recorded reason
- **Answer an open question** — name the artifact you folded the answer into
- **Assign an unowned artifact** — records a `decision` on the team ledger

Each shells out to `scripts/board.mjs` or `scripts/team-message.sh` and shows the command and its
exit code. **If the CLI refuses, the refusal is printed verbatim.**

## Which one to open

| Situation | Use |
|---|---|
| Day-to-day: following threads, reading the roster, working the founder inbox | `/app-control-room` |
| The build is broken, `npm install` fails, or you are diagnosing the toolchain | `/app-dashboard` |
| You need one shareable file to attach to a ticket | `/app-dashboard --export` |

## Output

The URL. Nothing else — the page is the report.
