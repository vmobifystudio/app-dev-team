# AI App Studio — the handbook

*What this is, what it believes, how it actually works, and where it is honest about not working.*

**Version:** post-revamp (`revamp/phase-r-fixes`) · **Date:** 2026-07-29
**Scale:** 29 roles · 27 skills · 13 commands · 20 scripts · 9 knowledge packs · TBD assertions

---

## Part 1 — What this is

A team of AI specialists that takes an app from an idea to a shipped build, or takes an existing
codebase and closes the gap between it and your standards. It runs inside Claude Code as a plugin.

The thing that distinguishes it from "an AI that writes an app" is not that it has more agents. It
is that **it does not trust its own agents, including about whether they did the work.**

Most of this document is about that distrust — where it is enforced, how, and what happened every
time it was absent.

---

## Part 2 — The ideology

Six beliefs. Each was paid for by a failure, and each is enforced by something executable rather
than by prose.

### 2.1 A claim is not a fact until something executes it

An agent that says `DONE` may not have created the branch. An agent that says `tests: all green`
may not have run them. A reviewer that says `APPROVED` may have left no record. None of these are
lies in the human sense — they are what a language model produces when the shape of the answer is
"success."

So every claim has a check that can contradict it. `verify-done.sh` looks for the branch, the
commits, the changed files and the test result. The merge gate refuses without an approval **event**
from someone other than the owner. The runtime gate builds the app and asserts the process is still
alive after launch, because `simctl launch` returns success for a program that crashes 200 ms later.

### 2.2 A rule that cannot fail is worse than no rule

Worse, not equal — because it consumes the attention a real rule would have earned. This is the
single most expensive class of defect in this system's history.

Live examples, all found by breaking the code and watching whether anything noticed:

- A `skill_missing` check whitelisted to eleven names that all existed.
- A CI workflow ending `|| true`, so a failing test exited zero.
- An assertion that "the page loads nothing from the network" whose regex was a **syntax error**;
  stderr went to `/dev/null` and control always fell to the success branch. A live CDN URL was
  baked into the page and the suite reported 385 passed, 0 failed.
- A guard proving worktree isolation that keyed on worktrees existing — and therefore stood down in
  exactly the incident it was written for.

The counter-rule: **a new rule ships with a demonstration of it failing.** Phase 8 makes this
mechanical (`scripts/mutate.sh`), because a discipline that depends on a reviewer remembering is
itself a rule that cannot fail.

### 2.3 Gates fail closed, and "cannot evaluate" is its own answer

Every gate speaks one contract:

| Exit | Meaning |
|---|---|
| `0` | clear |
| `1` | blocked by a real condition |
| `2` | **cannot evaluate** — a required input is missing, unreadable, or the toolchain is absent |

**Exit 2 is never a pass.** This matters more than it sounds. A machine with no Xcode is a normal
state, not an error — and the temptation is to let that quietly succeed so the pipeline stays green.
That would manufacture confidence exactly where there is none.

Proceeding past a `2` requires a recorded waiver naming a human and a reason, which `ship-gate.sh`
parses and validates. **A skipped gate and a waived gate are indistinguishable in a log unless the
waiver is written down.**

### 2.4 Execute constants, never certify by reading

Code that reads perfectly can still be wrong about the world. Two instances:

- A plausibility envelope that survived 35 sprints and rejected the *median* subject at 26 of 61
  ages. Invisible to inspection, because the code was correct.
- A test asserting `perPersonShare == 33.34`, which **can never pass on any host**: `Decimal` is
  `ExpressibleByFloatLiteral` via `Double`, so the literal carries `33.34000000000000512`. That
  assertion was the architecture's own named mitigation for its only silent-failure risk. The
  safeguard was non-functional and read perfectly.

So `verification-engineer` exists as a distinct role whose only job is to run the numbers everyone
else asserts, and `code-reviewer` **routes** constants to it rather than blessing them by reading.

### 2.5 Isolation is a mechanism, not a convention

Two writing agents in one working tree corrupt each other. Measured, not theorised: a commit
containing another ticket's half-written files, one agent burning ~50% of its budget rediscovering
work it had already done, and two branches with add/add conflicts on all 8 files.

The rule has existed since v1.4.0. On 2026-07-29 **the orchestrator that had spent the day hardening
that rule violated it**, and one `git stash` + `git reset` discarded 22 files of another agent's
work. Recovery was luck — it happened to be stashed rather than checked out.

The conclusion: knowing a rule, having written it, and having defended it for hours does not make
you apply it. `spawn-gate.sh` now refuses to launch a second writer without worktrees, and a
PreToolUse hook blocks repo-wide destructive git whenever the tree has uncommitted work.

### 2.6 The failure mode must be "honestly blocked," never "falsely complete"

For an autonomous system this is the whole ballgame. A team that stops and tells you why can be left
running overnight. A team that reports success it did not earn is **worse than no team**, because it
consumes your trust along with your tokens.

The first end-to-end run produced **zero merged code** — three tickets, all blocked, on a machine
with no iOS SDK. Every gate refused and each said which one it was. That is the system working.

---

## Part 3 — The roles

Roles are Markdown files in `agents/`. Each declares its tools and model. They are activated per
project by tier and product type (§6), so not all of them run on every project.

### Executive — decides what and why

| Role | Model | Owns |
|---|---|---|
| `ceo` | opus | Vision, success metrics, final scope |
| `cpo` | opus | PRD, user stories, acceptance criteria, backlog |
| `cto` | opus | Architecture, stack, engineering principles |

On **utility tier**, `ceo` absorbs the `cpo` charter (one founder pass) and `cto` collapses into
`tech-lead`. Neither role is deleted; flagship keeps all three.

### Management — plans and coordinates

| Role | Model | Owns |
|---|---|---|
| `tech-lead` | opus | Per-platform impl specs, module boundaries, reusable patterns, the mid-sprint Q&A batch |
| `tech-manager` | opus | Sprint plan, the board, the merge gate, standups, findings register |

`tech-manager` is the only role that runs the merge, and it is the operating system of the pod.

### Engineering — builds and verifies

| Role | Model | Owns |
|---|---|---|
| `ios-developer` | sonnet | Swift/SwiftUI implementation |
| `android-developer` | sonnet | Kotlin/Compose implementation |
| `backend-developer` | sonnet | API, persistence, migrations (when in scope) |
| `monetization-engineer` | **opus** | StoreKit / Play Billing, paywall, ads + consent |
| `code-reviewer` | opus | The review gate; routes constants to verification |
| `qa-engineer` | sonnet | Test plans, bug filing, ship recommendation |
| `verification-engineer` | opus | **Executes what everyone else asserts** — constants, thresholds, guard rules |
| `product-validator` | opus | **Compares the recorded founder brief to the PRD** — omitted intent, invented requirements, silent scope change. Outside the cpo/cto/tech-manager chain; blocks scope-lock; never writes the PRD |

`monetization-engineer` is opus deliberately: it owns money-correctness paths, which is where a
silent error is most expensive.

### Design and growth

| Role | Model | Owns |
|---|---|---|
| `ux-architect` | sonnet | Information architecture, navigation, flows, screen-and-state inventory |
| `product-designer` | sonnet | Screen composition, hierarchy, interaction, tokens, components |
| `product-manager` | sonnet | Ticket clarification, backlog grooming, in-sprint scope calls |
| `product-researcher` | sonnet | Independent evidence gathering, labelled fact/user/competitor/hypothesis/inference |
| `chief-of-staff` | sonnet | Decision briefs, unresolved commitments, founder inbox |
| `web-developer` | sonnet | TypeScript/browser implementation — makes `web-app` staffed |
| `test-automation-engineer` | sonnet | Test infrastructure, device and state matrix, evidence bundles, flake detection |
| `privacy-reviewer` | opus | Data inventory, consent, retention, regional compliance (flagship) |
| `reliability-engineer` | opus | Offline, retries, idempotency, sync conflict, restoration, recovery |
| `red-team-agent` | opus | Attacks the product and the studio own assumptions |
| `release-auditor` | opus | Independent review of the evidence bundle and gate record; can block the release |
| `aso-specialist` | sonnet | Store listing, keywords, screenshots, readiness |
| `data-analyst` | sonnet | Analytics schema, instrumentation check, post-launch KPIs |

### Platform and release

| Role | Model | Owns |
|---|---|---|
| `devops-engineer` | sonnet | Git strategy, CI, signing, flavors, secrets |
| `security-reviewer` | opus | Pre-ship security pass, severity-classified findings |
| `release-manager` | **opus** | Versioning, signing, store upload, release notes |

`release-manager` is opus because it is the only role that performs **irreversible** actions. The
riskiest actor should not be the cheapest model.

### Who may own a ticket

Ten roles can own an implementation ticket: the four developers, plus `devops-engineer`,
`ux-architect`, `product-designer`, `product-manager`, `product-researcher`, `qa-engineer`,
`data-analyst`, `aso-specialist`, `verification-engineer`.

`code-reviewer`, `security-reviewer`, `release-manager`, `tech-lead` and `tech-manager` **gate,
review and coordinate — they do not work tickets.** Assigning one is a board error, because the
loop would never spawn it: the ticket would be never picked up, never blocked, and never reported.

---

## Part 4 — How they communicate

### 4.1 The problem, measured

Across three dry runs and ten agent-runs, **the team channel was used zero times.** Including one
run where an agent hit a planted ambiguity, was handed the exact command, decided it *should* raise
the question — and then reported that it had, when it had not.

That is structural, not lazy. **An agent that can proceed will proceed.** It cannot block waiting
for an answer inside its own run, so it must decide anyway; sending a message costs it a step and
buys it nothing before it finishes.

### 4.2 The channel

`docs/team/messages.md` — one append-only Markdown ledger for the whole team. It survives an agent
dying mid-run, is readable by a human, and gives a restarted agent its history back.

| Kind | Meaning |
|---|---|
| `question` | needs an answer before someone guesses |
| `answer` | closes exactly one open question on that ticket |
| `decision` | also closes exactly one — so never use it for a note that decides nothing |
| `handoff` · `blocker` · `fyi` · `escalation` | routing and status |

Written through `scripts/team-message.sh`, which sanitises every field and enforces the guards. A
`decision` row that decides nothing silently consumes a real open question — observed live, on a
ticket that had already shipped on the assumption underneath it.

### 4.3 Declare, don't dispatch

Since an IC will proceed regardless, the protocol splits by role:

- **ICs** must record every place the spec did not answer something, in the
  `Assumptions & open questions` field of their output contract, with the decision and the reasoning.
  If they raised it, paste the ledger row. If not, write `ASSUMED, NOT RAISED`.
  **Never claim to have raised something you did not** — the orchestrator and the standup read that
  line as fact.
- **The orchestrator** turns every `ASSUMED, NOT RAISED` into a real ledger row on the agent's
  behalf. Nothing is lost because an IC was mid-flow.

### 4.4 The two answering mechanisms

**`spec-critic`, before any developer spawns.** It reads the impl specs and files every question a
developer would otherwise be forced to guess at. `tech-lead` answers them into the ledger, and the
answers are **folded back into the spec** — because a closed ledger is not delivery.

On its first real run it found a **silent 10× money bug** before a line of code existed: the spec
specified `.decimalPad` (which shows a separator key), *"digits are read as cents"*, and *"strip
non-digits"* in one paragraph. Typing `124.5` would have produced **$12.45**. No crash, no failing
test, nothing in the spec resolving it.

**Mid-sprint Q&A, at the top of each round.** Open questions are batched and `tech-lead` is spawned
**once** to answer them all before the next developer wave inherits the guesses. The step then
re-renders and checks the open count actually fell — if it didn't, `tech-lead` wrote prose instead
of ledger rows.

### 4.5 The anti-ping-pong guard

Two agents can burn an entire budget agreeing with each other. Enforced at send time and re-checked
against the ledger afterwards, so a hand-written row cannot route around it:

| Limit | Value |
|---|---|
| Messages per role, per round | 10 |
| Same pair, one ticket | 2 |
| Chain depth | 4 roles |
| Unanswered question age | 1 round, then it is `tech-manager`'s action item |

### 4.6 Who may talk to whom

Direct messages follow the org chart; anything else routes through `tech-manager`. An IC never
messages `ceo`/`cpo`/`cto` directly — not politeness, but to stop every IC independently re-opening
settled scope.

---

## Part 5 — The board: how work is tracked

### 5.1 Why it is event-sourced

The board used to be a hand-edited Markdown table. Every anomaly the doctor hunts for existed
because an agent could type any cell it liked, and the error was only **detected afterwards**.

Now: `docs/31-board-events.jsonl` is an append-only event log, and `docs/31-board.md` is a
**generated view**. The Markdown stays human-readable and diffable — that is what makes the system
inspectable rather than a black box — but nobody hand-authors it.

### 5.2 The state machine

```
todo ──claimed──> in_progress ──done_reported──> (verify) ──review_requested──> in_review
  ^                    │                                                            │
  │                    └── blocked ──> blocked ──unblocked──┐                  approved
  └──────────────────── (re-open, admin only) ─────────────┘                        │
                                                                                    v
                                         done <──closed── qa <──merged──── (merge gate)
```

Transitions are validated **before** the append, so illegal states become unwritable rather than
detectable. Rules enforced at write time:

| Rule | The anomaly it makes impossible |
|---|---|
| `review_requested` requires a prior `verified` or `verified_static` | a DONE believed unverified |
| `approved` must be authored by someone ≠ the owner | self-review |
| `merged` requires a non-owner `approved` | merge without review |
| the 3rd `changes` is refused | cycle-cap drift |
| `claimed` refused if a dependency never merged | the silent stranded ticket |

A refusal names the current state and what is legal from it, so an agent can correct itself:

```
board: refused approved on APP-002
  approved is not legal on APP-002 — it is in_progress
  legal from here: done_reported, blocked, assigned
```

### 5.3 The static-review lane

`verified_static` exists because a missing simulator once blocked a path that **also** gated static
inspection — and `code-reviewer` never ran once across an entire sprint. Work can now be reviewed,
approved and merged on inspection alone, while the board carries
`qa (static only) — NOT RUN: the executable test suite` and **refuses to close**.

That is the difference between a system that stalls when the environment is imperfect and one that
keeps making honest progress while being precise about what it has not proven.

---

## Part 6 — Role activation: who exists at all

Two axes decide the roster for a project:

- **Tier** — `flagship` or `utility`: how much process the work deserves.
- **Product type** — `ios-app`, `android-app`, `mobile-app`, `backend-service`, `web-app`, `cli`,
  `library`: *which specialists exist at all*.

A backend service never spawns an ASO specialist, never hits a store-readiness gate, and is never
blocked by a runtime gate hunting for an `.xcodeproj`.

**Every deactivation is recorded** in `docs/02-team-roster.md` with its reason — `active`,
`conditional(trigger)`, or `off(reason)`. A skipped role and an absent role must stay
distinguishable.

Two rules that survive cost pressure: **`security-reviewer` and `verification-engineer` are never
off and never tier-gated.** Cheapness is not a reason to skip a security review, and every product
type has constants that need executing.

And a rule learned by getting it wrong: **every product type must name at least one IC that can own
an implementation ticket.** `cli` is currently *recognised but unstaffed* — activation refuses and
names what is missing, rather than silently assembling a team that cannot build the product.
`web-app` was in that state until `web-developer` existed; adding the IC is what moved it.

---

## Part 7 — The commands

| Command | What it does |
|---|---|
| `/app-run` | The autonomous driver. Detects greenfield vs brownfield, then init → gate → sprint loop → ship-readiness |
| `/app-init` | New app: intake → vision → PRD/architecture → specs → project bootstrap |
| `/app-onboard` | Existing app: detect stack, reverse-engineer the as-built architecture and backlog |
| `/app-audit` | Grade against the House KB → severity-ranked gap report → remediation backlog |
| `/app-plan` | Turn backlog + specs into a parallel-friendly board |
| `/app-build` | The sprint loop (§8) |
| `/app-review` | Review a single branch |
| `/app-ship` | Readiness gates → release manager → confirm before upload |
| `/app-status` | Board, blockers, metrics, open questions, budget position |
| `/app-dashboard` | The control room (§9) |
| `/app-portfolio` | N projects ranked by attention needed |
| `/app-learn` | Fold learnings — successes **and failures** — into the knowledge base |
| `/app-team` | List the roster |

**Two human gates, and only two:** scope-lock (approve what we're building) and ship (confirm the
upload). Everything between streams as standups.

---

## Part 8 — The sprint loop, step by step

```
0.  spawn-gate       — refuses to launch a second writer without worktrees
0.  board-doctor     — refuses to spawn anything against an incoherent board
0a. budget gate      — stops the loop when a ceiling is reached, naming which
1.  read state       — derived from the event log
1a. route assumptions— last wave's ASSUMED, NOT RAISED become question rows
1b. mid-sprint Q&A   — tech-lead answers them BEFORE this wave inherits them
2.  spawn developers — one worktree each, serialised on file overlap
3.  streaming review — verify each DONE, then review immediately; don't wait for the batch
4.  verdicts         — approve → merge gate; changes → re-spawn one tier up
4a. runtime gate     — build, launch, drive the P0 flow, capture evidence
5.  QA               — as a ticket on a branch, not an errand
6.  standup + journal— aggregate fragments, append the round record
7.  loop             — until the board is drained
8.  exit check       — every non-done row named with its reason
```

**Parallelism is judged on files, not features.** Two tickets that touch the same file are
serialised however unrelated they look — a dry run of two "independent" tickets produced add/add
conflicts on all 8 files.

**A refusal is a finding.** When the CLI rejects a transition, the loop surfaces it rather than
retrying around it.

---

## Part 9 — Seeing what is happening

`scripts/studio-dashboard.mjs` — one file, Node stdlib only, `localhost:4173`, live via SSE.

Its panels were chosen **after** the pipeline had been run once, and they are deliberately not a
burn-down:

1. **Why is nothing moving** — blocked/stranded tickets with reasons; gates reporting CANNOT EVALUATE
2. **Inspectable but not runnable** — static-only tickets and what never ran
3. **Unowned artifacts** — a spec requires it, no ticket owns it
4. **Work with no provenance** — files changed belonging to no ticket or branch
5. **Question → answer → delivery** — and whether the answer reached an artifact
6. Board · 7. Metrics · 8. Timeline

On a blocked sprint a burn-down is a flat line that explains nothing. *"All three tickets are
blocked, and here is the one reason"* was the single most useful fact in the first real run.

The governing constraint: **nothing writes state except through the validated CLI.** The page can
act — unblock, answer, assign — but only by invoking the same commands agents use, showing the
command and its exit code, and displaying refusals verbatim.

---

## Part 10 — The knowledge base

`knowledge/` — the studio's accumulated taste, so output is production-grade rather than generic:
stack defaults, iOS and Android conventions, monetization, analytics, ASO, git workflow.

### The failure corpus

The KB used to learn only from **success**. `knowledge/failure-corpus.md` accumulates what goes
wrong, one entry per defect **class** with the *tell* — what a reviewer greps or asks:

| Class | The tell |
|---|---|
| FC-001 The fix that stops one layer short | *Who reads this value, and did they change?* |
| FC-002 The rule that cannot fail | *What input makes this print red?* |
| FC-003 Green while nothing happened | Name the artifact that exists **only if** the work ran |
| FC-004 The gate that fails open on a renamed input | *What does this print when the file is missing or renamed?* |
| FC-005 The check whose own input nobody writes | For every artifact a rule reads, name the step that writes it |
| FC-006 The proxy trigger that misses its own incident | **Replay the incident in its actual configuration** |

**The mechanism that makes it more than a document:** an instance dated *after* its class's rule
shipped is a **blocking** finding, and it names the rule rather than the incident:

> RECURRENCE — FC-001 happened again, after its rule shipped. **The rule did not work. That is the
> finding, not the incident.** → Strengthen the rule and stamp a new date, or reclassify.
> **Deleting the row is not an exit.**

FC-001 alone accounts for eleven of the sixteen findings in the team's own review of its revamp.

---

## Part 11 — How the system checks itself

| Tool | Checks |
|---|---|
| `board-doctor.mjs` | A project's board: stranded, self-review, broken deps, cycle caps |
| `team-doctor.mjs` | The **team definition**: unreachable roles, missing skills, contract drift, doc-graph, path spellings, corpus recurrence |
| `verify-done.sh` | A DONE claim against git and the test command |
| `ship-gate.sh` | Release preconditions, including generated-CI rules and waivers |
| `runtime-gate.sh` | Does the app build, launch, and stay up |
| `spawn-gate.sh` | Worktree isolation before any parallel spawn |
| `test.sh` | 438 assertions |
| `mutate.sh` | *(Phase 8)* Breaks the code and reports which mutations the suite failed to notice |
| CI | All of the above on every push |

**Zero runtime dependencies.** Node stdlib and POSIX `sh` only — no `package.json`, no
`node_modules`. That is a security property as much as a portability one.

---

## Part 12 — What is honestly not finished

This section exists because a handbook that only describes the working parts is the same failure
this system is built to prevent.

**Blocking, verified open at the time of writing:**

- `ship-gate` cannot block a plain-format S1 — its regex demands markdown bold, the QA template
  writes pipes. Probed: an S1 *crash on launch* returns CLEAR.
- `verify-done` reports `tests=green` for the literal command `true` — the ran-evidence check is
  consulted only on failure.
- `integration-branch` always returns `main`, because **nothing writes the line it reads**.
- Argument injection in `board.mjs parseArgs`: a `--`-leading value in any agent-supplied string
  overwrites arbitrary files. Reproducible with a sentinel file.
- `POST /action` has no Origin check — CSRF-drivable.
- `code-reviewer.md` instructs hand-appending to a generated file and never mentions `board.mjs`;
  following it blocks every merge.
- `verified_static` tickets ship CLEAR — the release gate cannot see the flag.
- Four assertions in the suite cannot go red.

**Never exercised:** `/app-ship` (H8). The fixed pipeline has not been re-run end to end.

**Structurally true regardless of fixes:** the team writes the PRD, derives acceptance criteria from
its own PRD, implements against its own spec, and tests against its own criteria. It is a closed
loop. The external oracles are the compiler, the two human gates, and real users. **It can tell you
"this builds, launches, and matches the spec we wrote." It cannot tell you "this is what you
wanted."**

*Narrowed, not closed (P1).* `docs/00-founder-intent/` keeps the founder's words as a reference the
team cannot edit to match its plan (`scripts/founder-intent.mjs`); `product-validator` compares that
record to the PRD from outside the cpo/cto/tech-manager chain and can block scope-lock;
`scripts/trace.mjs` fails when the chain from goal to release breaks, when two documents disagree,
and when a conditional founder gate fires. What that buys is **drift** detection — the PRD no longer
gets to quietly stop representing the brief. What it does not buy is correctness of the brief: a
founder who is wrong about the market now gets a validated, traceable, well-evidenced product nobody
wants. That is what the human gates and real users are still for, and no script replaces them.

Every open item is specified with a reproduction in
`docs/research/2026-07-29-dry-run-4-findings.md`.

---

## Part 13 — The three sentences

If you keep nothing else:

1. **A green signal is evidence only to the extent it could have gone red.**
2. **When you fix something, ask who else touches this value between the fix and the human.**
3. **The failure mode must be "honestly blocked," never "falsely complete."**
