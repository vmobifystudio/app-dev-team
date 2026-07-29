---
description: Rank every registered app project by attention needed — where should the next hour go?
argument-hint: [--registry <path>] [--limit N]
allowed-tools: Read, Glob, Grep, Bash
---

# /app-portfolio — Where should the next hour go?

`/app-status` and `/app-dashboard` answer *"what is happening in this project"*. A studio shipping
several apps has a different problem: **which of them is quietly stuck**. That is not the busy one —
the busy one is being looked after.

## Steps

1. **Run it.** Anywhere; it does not care about the current directory.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/portfolio.mjs" $ARGUMENTS
   ```

   Print its output verbatim. Do not re-rank it in prose and do not summarise a project as "fine" —
   the score is the deliverable and the reasons are printed beside it.

2. **Exit codes are the contract**, same as every other gate here:

   | Code | Meaning |
   |---|---|
   | 0 | a portfolio was reported — including any `UNREADABLE` rows, which are reported, not skipped |
   | 1 | bad usage |
   | 2 | **CANNOT EVALUATE** — no registry, an unreadable registry, or a registry naming no projects |

   On exit 2, show the message and stop. An empty portfolio is never "nothing needs attention".

3. **Machine-readable:** `--json` emits the whole model — the same fields, unranked prose removed —
   for anything that wants to render it elsewhere.

## The registry

One project path per line. `#` comments and blank lines are ignored, `~` is expanded, and relative
paths resolve against the registry file's own directory.

```
# ~/.app-dev-team/projects.txt
~/apps/tipjar
~/apps/notes
~/clients/acme/reader
```

Default location: `$APP_TEAM_REGISTRY`, else `~/.app-dev-team/projects.txt`. Override per run with
`--registry <path>`.

The registry is the studio's, not a project's — it lives outside every repo on purpose, because a
list of a studio's apps checked into one of those apps is a list that goes stale in the other N-1.

## What it reports per project

Everything is read through `lib/board.mjs` and `lib/events.mjs` — the same parsers as
`board-render`, `board-doctor`, `ship-gate` and the dashboard — plus `round-journal.mjs` for the
budget. There is no portfolio-specific reading of anything.

| Field | From | Why it is here |
|---|---|---|
| lifecycle | board / event log | the **least**-advanced thing still true, not the most |
| blocking | blocked tickets + their recorded reason, and todos stranded behind one | the answer to "why is nothing moving" |
| awaiting | tickets parked in `review` or `qa` | not stuck today; nothing moves them without a person |
| static | `qa (static only)` — merged or in review asserting a suite that **never ran** | the fact a sprint must not close on |
| bugs | `docs/51-bugs.md` | open S1/S2 stop a release; open S3/S4 belong in the notes |
| questions | `docs/team/messages.md` | an unanswered question is a developer guessing |
| budget | `docs/33-rounds.jsonl` via `round-journal.mjs check` | rounds/spawns/retries against their ceilings |

## The ranking rule

```
attention = (what is waiting for a person) × (1 + days since the last event, capped at 8)
```

Weighted: open S1 30 · open S2 15 · blocked or stranded 12 · static-only 10 · open question 6 ·
awaiting review/qa 4 · unplanned 20 · budget ceiling reached 20 · an UNKNOWN count 8.

Two properties are the whole design:

- **It ranks by attention, not activity.** Every term in the sum is something *waiting for a human*.
  Commits, velocity and ticket throughput are deliberately absent: a project moving fast is a project
  someone is already on.
- **The idle multiplier is why a blocked project with nobody on it outranks a busy one.** Three days
  blocked beats twice the blockers landed this morning, which is the correct call for an hour of
  attention and the wrong one for a status report. This is a status *triage*.

`UNKNOWN` costs points. An unknown count is not a zero count, and if not knowing were free it would
be the cheapest way to look healthy.

## Degrading honestly

A project whose board cannot be read prints as **`UNREADABLE — <why>`** and sorts **above every
scored project**. It is never omitted and never counted as healthy.

This is the failure mode the whole codebase exists to prevent, and a portfolio view is the easiest
place in the system to commit it: **a project silently missing from a list reads as "nothing to worry
about"**. So: a missing path, a corrupt event log, a board with no Status column and a registered
directory with no board at all are each `UNREADABLE` with the reason attached, at the top.

## Not wired into the dashboard

Deliberately. `studio-dashboard.mjs` is a single-project server whose panels, state assembly and
client renderer are built around one `--project` root; a multi-project panel means touching all
three. The coupling is left loose instead: `portfolio.mjs --json` is the whole model in one object,
and a future dashboard panel is a fetch away whenever a second project makes that worth the diff.

## Output

The ranked list, verbatim, and nothing else.
