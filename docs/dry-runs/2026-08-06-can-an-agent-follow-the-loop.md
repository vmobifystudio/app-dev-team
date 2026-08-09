# Targeted experiment — can an AGENT follow the loop a careful hand can?

**Committed before the run.** One hypothesis, one ticket, one stopping condition.

## The question

Every finding on 2026-08-06 came from driving the CLI by hand. H1 proved the pipeline is completable
*by someone who knows every rule*. That is not the same claim as "the team works", and conflating
them is how six previous runs produced anecdotes.

`agents/ios-developer.md` declares an output contract that `/app-build`'s gates parse:
`Worktree:`, `Mutation confirmed:`, `Daily fragment:`, `Assumptions & open questions:`,
`Second-path check:`, `Shared surfaces touched:`. `team-doctor` enforces that the FILE declares
those fields. Nothing has ever checked that an agent RETURNS them.

## Hypothesis

**H4: an `ios-developer` agent, given a ready ticket and its own role file, returns the six
contract fields and leaves the branch in a state `verify-done.sh` accepts.**

If H4 holds, the loop is followable and the remaining risk is orchestration.
If H4 fails, the contract is aspirational — `team-doctor` checks the instruction exists and nothing
checks compliance, which is FC-002 at the boundary where the studio meets its own workers.

## Method

One bootstrapped scratch project. One ticket. One agent, given exactly what `/app-build` step 2
would give it. No coaching, no correction mid-run.

## Stopping condition

The agent returns, or the first refusal with no documented remedy. One agent only — this measures
contract compliance, not throughput.

## Result

Recorded below after the run, whatever it says.

---

## Result — H4 FAILS. The contract was enforced against the file, never against the agent.

One `ios-developer` agent, one ready ticket, no coaching. It ran 10 tools in 52 seconds.

**What it got right:** the fix itself was correct — `greet` returned a static `"Hello"`, it wrote
`f"Hello {name}"`, matching PRD F-001. It claimed and done_reported through the CLI (both legal),
and wrote a daily fragment at the canonical path. It named what it skipped.

**What failed:**

| | |
|---|---|
| Contract fields returned | **1 of 6** — only `Worktree:` |
| `verify-done.sh` | **REJECTED** — "no commits… nothing was actually written" |
| Its claim "no git repo initialized in this worktree" | **False** — `git rev-parse` returns true |
| Board | parked at `in_progress`, unable to advance |

It wrote the right code, left it uncommitted, and reported DONE. The very next gate cannot pass.

**The gates worked.** `verify-done` rejected it; the board would not advance. What failed is the
HANDOFF, and the handoff was the half nobody was checking: `team-doctor` enforces that the role FILE
declares six fields; nothing checked that an agent RETURNS them. FC-002 at the boundary where this
studio meets its own workers.

**Reading the report does not catch this.** The report sounded complete, explained its reasoning and
named its own skips. A reader — human or model — supplies the missing structure from imagination.
That is exactly why the fix is a command with an exit code.

## Confounder, stated

The spawn prompt said "work directly in the project root — no separate worktree required". That is a
confounder for the *worktree* decision and I own it. It is **not** a confounder for the false claim
about git, nor for failing to commit: nothing in the prompt suggested either.

## Fixed

`scripts/report-check.mjs`, wired into `/app-build` step 3 before the DONE is believed. Its tiers
are kept identical to `team-doctor`'s so a role cannot owe one contract to the doctor and another to
the loop. The verbatim failing report is now a regression fixture.

**It refuses to let the orchestrator fill the fields in.** A field the orchestrator invents is a
claim nobody made, recorded as though someone did.

## What H4 changes about the overall picture

H1–H3 established that the machinery works and that the loop could not start. H4 establishes that
even with a ready ticket and clear preconditions, **the agent handoff is where the pipeline actually
breaks** — and it broke on the first agent ever measured against it.
