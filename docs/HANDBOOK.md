# AI App Studio — the handbook

*What this is, what it believes, how it actually works, and where it is honest about not working.*

**Version:** 2.0.0 (`main`) · **Date:** 2026-08-01
**Scale:** 30 roles · 31 skills · 27 commands · 57 top-level scripts (+14 shared libs) · 9 knowledge packs · 1100 assertions

*The script and lib counts are checked against the tree by `scripts/metadata-check.mjs` and cannot
drift again. They had: this line read 52 and 9 while the tree held 57 and 14.*

---

## Part 1 — What this is

A team of AI specialists that takes an app from an idea to a shipped build, or takes an existing
codebase and closes the gap between it and your standards. It runs inside Claude Code as a plugin.

The thing that distinguishes it from "an AI that writes an app" is not that it has more agents. It
is that **it does not trust its own agents, including about whether they did the work.**

Most of this document is about that distrust — where it is enforced, how, and what happened every
time it was absent.

## Current state — 2026-08-01

This is the authoritative snapshot after the Revamp implementation checkpoints and the
strategy-review closure pass that followed. The repository is on `main`. The Revamp checkpoints
below were committed and pushed in small, reviewable slices:

| Commit | Delivered |
|---|---|
| `42975c4` | Durable runs, context freshness, approval binding, audit anchoring |
| `60979b6` | Governed memory, prompt registry, evaluation laboratory |
| `eebe698` | Deterministic scheduler, capabilities, impact propagation |
| `30b5a64` | Risk routing and incident lifecycle |
| `0012489` | Revamp checkpoint documentation |
| `084c6ac` | Layered context compilation and manager failover |
| `3b3d75d` | Warm/cold manager compatibility harness (last commit on `main` as of this snapshot) |

**Uncommitted on top of that, local and test-verified, not yet pushed:** an external
strategy/architecture review found several of the controls above were built and unit-tested but not
actually load-bearing — opt-in trust controls nobody opted into, a leasing primitive with no caller
in the real claim path, a prompt registry that validated an empty shape, a memory ledger with no
read path, and a staged-rollout section that was prose a human judged by eye. Every finding below is
now closed and covered by a mirror-tested `test.sh` assertion (760 → 860): ticket-keyed run-ledger
leases wired into `board.mjs move claimed`; `.studio-policy.json` defaulted on for new projects;
`board.mjs move approved --bind` and `tech-manager`'s merge gate binding approvals to commit/diff
before `git merge`, not only at `ship-gate`; a real "rule that cannot fail" bug fixed in
`approval-check.mjs` (`git cat-file -e`/`git merge-base --is-ancestor` are silent on success, and the
script was reading that silence as failure); `audit-anchor`/`prompt-registry`/`eval-lab` composed
into `dispatch-preflight.mjs` so drift is caught at the next spawn, not the next release;
`docs/03-decision-rights.md` plus a role-existence rule enforced by `team-doctor.mjs`; the ticket
contract (`--invariant`/`--rollback`/`--file`-derived `risk`, with teeth at `review_requested`);
`prompt-registry.mjs sync` and `memory-curator.mjs retrieve` turning two scaffolds into governance;
five static contract-clause eval cases; and `release-health.mjs` plus the conditional
`incident-commander` role. Nothing here is described anywhere else as committed — treat this
paragraph, not the commit table above it, as the current edge of the work.

### What exists end to end

The system now has four cooperating planes:

1. **Intent and planning.** Founder intent, PRD, architecture, platform specifications, backlog,
   acceptance criteria, and the event-backed board define what should be built.
2. **Execution and coordination.** Roles work in isolated branches/worktrees; the scheduler computes
   dependency-ready work; the run ledger records attempts, checkpoints, leases, and terminal state;
   manager failover prevents a dead manager from being silently duplicated.
3. **Evidence and governance.** Context manifests record exactly which layered sources were used;
   approval checks bind approvals to commit/diff/context/evidence; capability checks constrain role
   operations and paths; impact maps identify downstream consumers; risk routing selects model tier,
   approvers, and evidence requirements.
4. **Release and learning.** Ship gates, runtime gates, dependency/version/policy scanners, audit
   anchors, governed memory, prompt registry, evaluation fixtures, and incident records provide
   release evidence and preserve failures for later review.

### The normal lifecycle

```text
idea / existing app
  → intake or onboard
  → founder intent + PRD + architecture + platform specs
  → context preflight + layered context manifest
  → board plan + dependency/scheduler decision
  → isolated implementation attempts with run checkpoints
  → DONE verification + review + capability/impact/risk checks
  → approval bound to immutable evidence
  → merge + runtime/QA/release gates
  → incident or release-health record if needed
  → governed learning proposal → explicit curator review → durable memory
```

Every arrow is an intended control boundary. The command files describe the operator flow; the
scripts are the enforceable part. If a command and a script disagree, the script's exit code is the
truth and the command documentation must be corrected.

### Revamp control inventory

| Area | Current implementation | What it prevents |
|---|---|---|
| Durable execution | `run-ledger.mjs`, `run-doctor.mjs` | Silent restart, duplicate attempts, expired leases, lost checkpoints |
| Layered context | `context-manifest.mjs` | Hidden context, stale sources, precedence ambiguity |
| Approval evidence | `approval-check.mjs` | Approval of a different commit, diff, context, or evidence set |
| Audit integrity | Board chain plus `audit-anchor.mjs` | Unnoticed release-time event-log changes |
| Memory governance | `memory-curator.mjs` (`propose`/`review`/`retrieve`) | Unreviewed, unscoped, unprovenanced agent memory — `retrieve` excludes unpromoted, expired, and superseded/contradicted records, not just a write-only ledger |
| Prompt governance | `prompt-registry.mjs` (`sync`/check) | Unversioned prompts, missing owners, no rollback metadata — `sync` populates one entry per `agents/*.md` from a real content hash; `team-doctor.mjs` blocks on a missing or stale entry |
| Evaluation | `eval-lab.mjs`, `eval/manifest.json` | Claims that a role/workflow works without an executable case |
| Scheduling | `scheduler.mjs` | Dependency violations, starvation, uncontrolled parallelism |
| Capabilities | `capability-check.mjs`, `docs/team/capabilities.json` | Role access beyond declared operations or paths |
| Impact | `impact-map.mjs`, `docs/team/impact-map.json` | Changed files whose downstream consumers were never reviewed |
| Risk routing | `risk-router.mjs`, `docs/team/risk-policy.json` | Low-assurance routing for money, security, migration, or release work |
| Incidents | `incident-ledger.mjs`, `docs/team/incidents.jsonl` | Operational failures disappearing into ordinary ticket history |
| Failover | `manager-failover.mjs` | Two managers acting concurrently or a dead manager blocking recovery |
| Dispatch composition | `dispatch-preflight.mjs` | One spawn gate composing context, scheduler, capability, and risk checks |
| Warm/cold contract | `manager-harness.mjs`, `eval/manager-scenario.json` | Persistent and respawned managers produce identical state |
| Ticket contract | `board.mjs add --invariant/--rollback/--file`, `risk-router.mjs` | A high/critical-risk ticket (derived from `--file`, never hand-typed) reaching review with no recorded invariant |
| Release health | `release-health.mjs` | Widening a staged rollout on a judgment call instead of a measured crash-free rate and open-P0 count |
| Incident command | `agents/incident-commander.md` (conditional) | An incident coordinated by whoever happens to be free, instead of one independent authority for its duration |

### Command groups

| Group | Commands | Purpose |
|---|---|---|
| Intake and planning | `/app-init`, `/app-onboard`, `/app-audit`, `/app-plan` | Establish intent, inspect an existing app, create specifications, and build the board |
| Execution | `/app-run`, `/app-build`, `/app-review` | Drive waves of isolated implementation, verification, review, and merge |
| Evidence controls | `/app-preflight`, `/app-context`, `/app-run-status`, `/app-recover`, `/app-manager-failover`, `/app-manager-harness` | Establish context, inspect durable state, recover safely, and verify manager modes |
| Coordination controls | `/app-schedule`, `/app-capabilities`, `/app-impact`, `/app-risk` | Decide what may run, who may do it, what it affects, and what assurance it needs |
| Quality and release | `/app-ship`, `/app-eval`, `/app-incident` | Gate release, execute evaluations, and record operational failures |
| Visibility and learning | `/app-status`, `/app-dashboard`, `/app-control-room`, `/app-portfolio`, `/app-memory`, `/app-learn`, `/app-team` | Observe work, curate memory, learn from shipped work, and inspect the roster |

### Artifact map

| Artifact | Authority / purpose |
|---|---|
| `docs/31-board-events.jsonl` | Append-only ticket event source; `docs/31-board.md` is a generated view |
| `docs/team/runs.jsonl` | Durable execution attempts, checkpoints, leases, and terminal outcomes |
| `docs/team/context-manifest.json` | Layered context snapshot and freshness boundary |
| `docs/team/memory.jsonl` | Proposed and reviewed memory records |
| `docs/team/prompt-registry.json` | Versioned prompt/policy metadata |
| `docs/team/schedule.json` | Scheduler input plan |
| `docs/team/capabilities.json` | Role operation/path allowlist |
| `docs/team/impact-map.json` | Changed-surface consumer rules |
| `docs/team/risk-policy.json` | Blast-radius routing rules |
| `docs/team/incidents.jsonl` | Operational incident lifecycle |
| `docs/team/audit-anchor.json` | Release-time board-log anchor when enabled |
| `eval/manifest.json` | Executable evaluation cases |
| `docs/50-test-plan.md`, `docs/60-releases.md` | Human-readable test/release evidence and waiver records |

The JSONL artifacts are append-only by contract. A broken chain is an evidence-integrity failure;
the recovery action is version-control/operator review, not manual editing or re-anchoring.

### Opt-in strict project policy

Existing projects remain compatible until their `.studio-policy.json` enables the newer controls.
The following switches are supported by `ship-gate.sh`:

```json
{
  "requireDurableRuns": true,
  "requireApprovalBinding": true,
  "requireAuditAnchor": true,
  "requirePromptRegistry": true,
  "requireEvaluation": true
}
```

An enabled control with a missing or unreadable artifact returns `CANNOT EVALUATE`; it does not
silently pass. This staged opt-in is deliberate: adding a checker is code-complete before every
existing project has populated the corresponding evidence artifacts.

### What “complete” means here

The code-only Revamp phase is complete when the controls exist, have positive and negative tests,
are documented, and are wired into the release gate. That milestone has been reached for the
listed P0/P1 controls. Full operational completion requires every dispatch path to invoke them, plus
CI, device, runtime, production replay, and human approval evidence. This handbook therefore
describes a strong control plane, not a claim that a real app has shipped autonomously.

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

### Operational — conditional, off between incidents

| Role | Model | Owns |
|---|---|---|
| `incident-commander` | opus | Severity, coordination, containment, communication, and the resolution decision for one open incident |

Activates only while `incident-ledger.mjs` has an open `sev1`/`sev2` record (`role-activation`'s
matrix: `?`). Deliberately not `release-manager` (may be the cause) or `tech-manager` (running an
unrelated sprint) — independent coordination authority is the whole reason it is a separate role
rather than a mode of either. Stands down the moment the incident is `resolved`.

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

`docs/team/messages.jsonl` — one append-only event log (schema `studio-event-schema/v1`) for the
whole team, with `docs/team/messages.md` as its GENERATED human view. Same relationship the board
has to its event log, for the same reason: state is validated before the append, not detected after
it. It survives an agent dying mid-run and gives a restarted agent its history back.

| Kind | Meaning |
|---|---|
| `question` | needs an answer before someone guesses |
| `answer` | closes exactly one open question on that ticket |
| `decision` | also closes exactly one — so never use it for a note that decides nothing |
| `handoff` · `blocker` · `fyi` · `escalation` | routing and status |

Written through `scripts/team-message.sh`, the only writer. It refuses a send that breaches the
guard or carries **no obligation**: every material message must yield a decision, a state
transition, an artifact update or a timed follow-up, and an `answer`/`decision` that names no
artifact is refused outright — a closed ledger is not delivery (DR4-006). `--kind fyi` is the escape
hatch and must be chosen. A `decision` that decides nothing silently consumes a real open question —
observed live, on a ticket that had already shipped on the assumption underneath it.

Threads and channels (`#founder-decisions`, `#product`, `#design`, per-platform, per-ticket) are
queries over the log, never places state is authored. Formal artifacts — `ADR` · `PDR` · `DDR` ·
`WAIVER` (expiry enforced; an expired waiver is a finding) · `INCIDENT` · `ASSUMPTION` (owner,
confidence, validation date) — are created by `scripts/messages.mjs artifact`, which writes the file
and registers it on the channel in one step.

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

Who is authorized to make each transition — who proposes, who challenges, who decides, who executes,
who records the evidence — is `docs/03-decision-rights.md`, not this table. This table is the state
machine; that document is the authority behind it.

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

A third, narrower activation shape exists alongside tier and product type: a role can also be
**conditional on runtime state** rather than on the project's own axes — `incident-commander` is the
one example, gated on whether `incident-ledger.mjs` currently has an open `sev1`/`sev2`, not on
anything decided at intake.

**Being on the roster answers only whether a role runs, never what it may decide.**
`skills/role-activation/SKILL.md`'s "Why a role exists" table is the cheaper, prior question — a
role is justified only by independent authority, independent context, a distinct capability/security
boundary, or separated-duties accountability — and every role in this handbook clears that bar at
least once. `docs/03-decision-rights.md` is where the actual authority lives once a role clears it:
who proposes, who challenges, who decides, who executes, who records the evidence, for the
decisions this studio actually makes. Both documents are sourced from what the role files already
say, not the other way around — fix the role file first if the two ever disagree.

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
| `/app-preflight` | Verify branch, ticket, dependency, policy, version, and source-of-truth context before work |
| `/app-context` | Create or verify a deterministic context snapshot before review or irreversible work |
| `/app-run-status` | Audit durable run leases, checkpoints, and orphaned attempts |
| `/app-recover` | Recover an interrupted run without silently creating a competing attempt |
| `/app-memory` | Propose and review governed memory with provenance and contradiction history |
| `/app-eval` | Execute deterministic role, policy, and workflow evaluation fixtures |
| `/app-schedule` | Compute dependency-ready work with fairness and bounded parallelism |
| `/app-capabilities` | Check role operation and path permissions against an allowlist |
| `/app-impact` | Require changed surfaces to declare downstream consumers |
| `/app-risk` | Route work by blast radius, model tier, approvals, and evidence |
| `/app-incident` | Record operational incidents, mitigation, resolution, and evidence |
| `/app-manager-failover` | Decide whether a manager lease permits continuation or requires failover |
| `/app-manager-harness` | Compare warm and cold manager state contracts against the same scenario |
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
0.. preflight        — verifies branch, dirty tree, ticket, worktrees, and source-of-truth context
0.  spawn-gate       — refuses to launch a second writer without worktrees
0.  board-doctor     — refuses to spawn anything against an incoherent board
0a. budget gate      — stops the loop when a ceiling is reached, naming which
1.  read state       — derived from the event log
1a. route assumptions— last wave's ASSUMED, NOT RAISED become question rows
1b. mid-sprint Q&A   — tech-lead answers them BEFORE this wave inherits them
2.  spawn developers — one worktree each, serialised on file overlap
2a. dependency gate — declarations, lockfiles, toolchain versions, and policy are checked when applicable
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
| `ship-gate.sh` | Release preconditions, dependency/version/policy tripwires, generated-CI rules and waivers |
| `runtime-gate.sh` | Does the app build, launch, and stay up |
| `spawn-gate.sh` | Worktree isolation before any parallel spawn |
| `context-preflight.mjs` | Branch, dirty-tree, ticket, worktree, and source-document context |
| `dependency-check.mjs` | Dependency declarations, lockfiles, and reproducible version constraints |
| `version-consistency-check.mjs` | Release version versus iOS/Android manifests |
| `policy-check.mjs` | Explicit project policy ownership and required evidence |
| `run-ledger.mjs` / `run-doctor.mjs` | Append-only execution attempts, checkpoints, leases, and orphan detection — leases now claimed automatically by `board.mjs move claimed` |
| `context-manifest.mjs` | Source hashes, git revision, omissions, and context freshness |
| `approval-check.mjs` | Binds approvals to commit, diff, context, and evidence — on by default for new projects (`--bind`), opt-in for onboarded ones |
| `audit-anchor.mjs` | Digest and tip anchor for the board event log — composed into `dispatch-preflight.mjs`, not release-time-only |
| `dispatch-preflight.mjs` | The gate before every spawn: composes context, scheduler, capability, risk, and (when enabled) audit-anchor/prompt-registry/eval-lab |
| `memory-curator.mjs` | Append-only proposals, explicit reviewer decisions, and `retrieve` — the read path: live means promoted, unexpired, not superseded |
| `prompt-registry.mjs` | Semantic versions, owners, evaluation suites, rollback metadata — `sync` populates real entries; `team-doctor.mjs` blocks on a missing or stale one |
| `eval-lab.mjs` | Deterministic executable evaluation cases, plus static contract-clause checks over the agent files carrying this studio's hardest-won rules |
| `scheduler.mjs` | Ready queue, dependency, fairness, and backpressure decisions |
| `capability-check.mjs` | Role operation/path allowlist enforcement |
| `impact-map.mjs` | Changed-surface consumer propagation |
| `risk-router.mjs` | Blast-radius routing and required approval/evidence decisions — also drives `board.mjs add --file`'s ticket-contract risk field |
| `incident-ledger.mjs` | Append-only operational incident records; a `sev1`/`sev2` activates `incident-commander` |
| `release-health.mjs` | Three-state gate (crash-free floor, open-P0 ceiling) between staged-rollout ramp steps |
| `manager-failover.mjs` | Prevent duplicate managers and make failover decisions from durable leases |
| `metadata-check.mjs` | Marketplace/README/CHANGELOG advertise the version and role count that actually ship |
| `journey-gate.mjs` | Proves a DECLARED P0 user journey completes — not that a process is alive |
| `test.sh` | 1100 assertions |
| `mutate.sh` | *(Phase 8)* Breaks the code and reports which mutations the suite failed to notice |
| CI | All of the above on every push |

**Zero runtime dependencies.** Node stdlib and POSIX `sh` only — no `package.json`, no
`node_modules`. That is a security property as much as a portability one.

---

## Part 12 — What is honestly not finished

> **Current correction — 2026-07-31.** The historical review text below predates the Revamp
> checkpoints and must not be read as the current implementation state. Approval binding,
> context freshness, audit anchoring, evaluation scaffolding, risk routing, and the other controls
> listed in the Current state section are now implemented. The old findings are retained only as
> provenance for why each control exists.

### Current open work

- **Runtime integration — partially closed, 2026-07-31.** An external review found the P0 trust
  controls were built and unit-tested but not actually load-bearing: `run-ledger.mjs` had no caller
  in the real ticket-claim path (two agents could both claim the same ticket), and the five
  `ship-gate` trust controls (`requireDurableRuns`, `requireApprovalBinding`, `requireAuditAnchor`,
  `requirePromptRegistry`, `requireEvaluation`) were opt-in with no project ever opting in — a fresh
  greenfield project shipped with all five silently absent. Both are now closed: `board.mjs move
  <ID> claimed` acquires a ticket-keyed run-ledger lease and refuses a racing second claim
  (`scripts/board.mjs:claimLease`); `/app-init`'s bootstrap step now writes a default
  `.studio-policy.json` turning all five on for every new project (existing/onboarded repos stay
  opt-in on purpose — they should not be retroactively blocked by controls they never adopted).
  `board.mjs move <ID> approved --bind` also now computes and binds `commit`/`diff_hash` from git
  and hashes reviewer-supplied `--evidence`/`--context` files, and `tech-manager`'s merge gate
  re-checks that binding immediately before `git merge`, not only at `ship-gate` release time. Fixing
  this also surfaced and fixed a genuine "rule that cannot fail" defect in `approval-check.mjs`:
  `git cat-file -e` and `git merge-base --is-ancestor` print nothing on success, and the script was
  treating that empty stdout as falsy — so the commit-exists and is-ancestor checks reported failure
  on every call, including a perfectly valid commit, and no test had ever exercised the passing path.
  Also closed, 2026-08-01: `audit-anchor.mjs`, `prompt-registry.mjs`, and `eval-lab.mjs` were
  reachable only through `ship-gate` or their own slash command — a project found out its audit tip,
  prompt registry, or eval baseline had drifted at release time, not when the drift happened. All
  three are now composed into `dispatch-preflight.mjs`, the same gate that already runs before every
  agent spawn, still policy-gated so a project that has not opted in pays nothing extra.
- **Live evidence:** full CI/device/runtime/production replay, `/app-ship` end-to-end execution,
  mobile state matrices, performance/accessibility validation, and release rehearsals require the
  target project and toolchains.
- **Operational depth:** incident response and manager failover still need repeated real-run
  evidence before they can be called mature operating practices. Memory curation and prompt
  governance moved from scaffolding to load-bearing, 2026-08-01: `memory-curator.mjs retrieve` is
  the read path that was missing entirely — a memory record is served only if promoted, unexpired
  as of `--now`, and not superseded/contradicted by a later-promoted record. `prompt-registry.mjs
  sync` populates one entry per `agents/*.md` file from a real content hash instead of leaving
  `docs/team/prompt-registry.json` empty (`"entries": []`), and `team-doctor.mjs` now blocks on a
  role missing from a populated registry or whose file changed since its last sync.
- **Evaluation is deliberately partial, and says so.** `eval/manifest.json` gained five static
  contract-clause cases (`eval-lab.mjs`, 2026-08-01) that assert the agent files carrying the
  studio's hardest-won rules — self-review refusal, the no-hand-edited-board instruction,
  product-validator's independence, release-auditor's separation of duties, mandatory escalation
  after one unresolved round — still say so, catching a future edit that silently drops one. This
  is content-checking, not behavior: it proves the RULE IS WRITTEN, not that an agent obeys it under
  load. A real role/pair/workflow/long-horizon behavioral eval (spawning an agent against a scenario
  and grading its decision) needs a mechanism `test.sh` cannot provide — the `Agent` tool is not
  shell-callable — and was deliberately not invented here. That remains open.
- **Product truth:** the team can validate traceability and implementation evidence; it cannot
  determine market desirability or replace founder/user judgment.
- **Staged-rollout health and incident command closed, 2026-08-01.** `release-manager.md`'s
  staged-rollout section used to be prose a human read and judged by eye — "hold at each step until
  the release health checks below are clean" checked nothing. `release-health.mjs` is now a real
  three-state gate (crash-free floor, open-P0 ceiling, both overridable per project in
  `.studio-policy.json`'s `releaseHealth`) called between ramp steps. `incident-commander` is a new
  **conditional** role (`role-activation`'s matrix: `?`, trigger `incident-ledger.mjs` has an open
  sev1/sev2) with independent coordination authority during a live incident, deliberately distinct
  from `release-manager` (may be the cause) and `tech-manager` (running an unrelated sprint).
- **Four ship-gate fail-open paths closed, 2026-08-01, following an external `/app-ship` end-to-end
  audit** (`docs/reviews/2026-08-01-app-ship-end-to-end-audit.md`). Each was independently reproduced
  before being fixed, and each fix is mirror-tested: (1) `release-health.mjs`'s policy override had
  no numeric validation — a malformed `.studio-policy.json` (string thresholds) silently defeated
  both the crash-free floor and the open-P0 ceiling at once, returning CLEAR for a 0% crash-free rate
  and 99 open P0s; now a non-numeric threshold is CANNOT EVALUATE. (2) an explicit QA `HOLD` in
  `docs/50-test-plan.md` was only ever a `note()` in `ship-gate.sh`, never a `block()` — the one thing
  `app-ship.md` promises stops a release never reached the exit code; `qa-engineer` now writes a
  structured `QA VERDICT: GO`/`HOLD — <reason>` line the gate keys on directly, and a plan with no
  verdict line is CANNOT EVALUATE. (3) `version-consistency-check.mjs` recognized only `version:
  X.Y.Z` prose, never `release-manager.md`'s own required release-note heading `## vX.Y.Z —
  YYYY-MM-DD` — a correctly-formatted release note never triggered the checker at all; both the
  checker and `ship-gate.sh`'s guard now recognize the heading form, taking the last one when a
  project has shipped more than one release. (4) waivers bound to nothing but the artifact name — no
  version, no expiry — so a waiver written for one release silently covered every release after it;
  once a project declares a canonical version, `WAIVED:` lines must now name it as a fourth field
  (`WAIVED: <artifact> — <who> — <reason> — vX.Y.Z`) or they do not count. The audit's remaining
  findings (an immutable release-candidate identity binding every gate to one frozen artifact, a
  structured per-control verdict schema, and a dedicated control-room Submission screen) are a larger
  architectural change than these four fixes and were deliberately not attempted in the same pass —
  see that review document for the full action plan if that work is taken on later.
- **Four more findings closed, 2026-08-01, from an automated Codex review of PR #15** (all
  independently reproduced before being fixed, all mirror-tested). (1) `run-ledger.mjs`'s
  ticket-holder check and the write that followed it were two separate operations with no lock
  between them — two `start` calls racing the same ticket could both read "no active holder" and
  both append, corrupting the hash chain for every future read. Reproduced with two live concurrent
  processes; fixed with an `O_EXCL` lockfile serializing the whole read-decide-append sequence, the
  same mechanism Unix mail spools use for the identical problem. (2)
  `readReleaseChecklist`'s block-terminating regex used the `m` flag, so `$` matched end-of-line
  instead of end-of-input and the lazy body capture silently stopped after the block's first row — a
  checklist with one checked item and two unchecked ones reported `1/1` done. (3) `/app-init`'s
  default `.studio-policy.json` turned on all five P0 trust controls, but three of them
  (`requireAuditAnchor`, `requirePromptRegistry`, `requireEvaluation`) are composed into
  `dispatch-preflight.mjs`, which runs before every spawn, and each needs an artifact a fresh
  project does not have yet (an event log with a first ticket, a prompt registry sync of an
  `agents/` directory a shipped project doesn't have, an eval corpus of its own) — every spawn after
  `/app-init` was silently blocked forever. Only `requireDurableRuns`/`requireApprovalBinding`
  default on now; the other three are documented as an explicit later opt-in once their
  prerequisite exists. (4) `board.mjs add --file`'s risk derivation collapsed "no risk policy
  exists yet" (a legitimate unknown) and "a policy exists but is malformed" into the same silent
  `null` — since `review_requested`'s invariant guard only fires on risk explicitly
  `high`/`critical`, a broken policy let a billing/security ticket reach review with no invariant
  recorded. A malformed policy is now a hard failure at ticket creation; a missing one stays a quiet
  unknown.
- **Two findings from independent dry-run pilots closed, 2026-08-01** (`docs/dry-runs/2026-08-01-android-small-app.md`
  and its follow-up `2026-08-01-daily-reading-log-workflow-review.md`, both single-session Codex
  pilots exercising the local workflow end to end, not a claim of true multi-agent execution — that
  gap is still open and both reports say so). (1) Mission Control's release-readiness panel could
  show `clear` while `ship-gate.sh` had just returned BLOCKED, because the panel swept only
  ticket/bug state — a narrower population than the gate actually checks. `ship-gate.sh` now takes
  an opt-in `--record` flag (used by `/app-ship` and `release-manager`) that writes its verdict to
  `docs/team/ship-gate-verdict.json`; when the last recorded run was not CLEAR, the control room
  surfaces it as an item, so the panel can no longer disagree with the gate's own last word. Opt-in,
  not automatic, because `ship-gate.sh` is documented as read-only by default and several of this
  repo's own test fixtures run it directly against tracked directories. (2) `trace.mjs`'s `waiver`
  founder-gate trigger scanned every file under `docs/` for the bare string `WAIVED:`, so a roster
  template's own explanatory prose about the waiver format tripped a founder-approval gate the
  project never needed — reproduced in both pilots independently. `WAIVED:` has exactly one
  legitimate home, `docs/60-releases.md` (the only file `ship-gate.sh`'s `waiver_for()` ever reads);
  scoping the trigger there was not a narrower heuristic, it was the actual shape of a real waiver
  record.
- **Support triage and experiment feedback are explicitly deferred, not silently dropped.** No app
  built by this studio has shipped yet, so there is no real user-report or experiment-result signal
  for a support-triage or experiment-feedback loop to act on — building either now would be process
  for data that does not exist. Revisit once a real release produces real signal.
- **Publishing and preparing-to-publish are now separated as different actions with different
  actors, 2026-08-01.** `release-manager` used to instruct the actual App Store Connect / Play
  Console upload commands (`xcrun altool --upload-app`, `fastlane supply --aab ... --track
  internal`); those are gone, replaced by a founder-facing `- [ ]` submission checklist written into
  `docs/60-releases.md`. `docs/03-decision-rights.md`'s Release readiness row now names the split
  explicitly: `release-manager` assembles the signed, submission-ready build; the founder alone
  executes the actual store submission, at any track. The control room reads that checklist
  (`scripts/lib/project.mjs:readReleaseChecklist`) and surfaces it as a `submission_ready` Founder
  Inbox item showing outstanding steps — read-only by construction, since its action name is
  deliberately absent from `scripts/lib/actions.mjs`'s `ACTIONS` whitelist, so the control room
  cannot execute a submission even by accident.
- **Four findings from dry run 3 closed, 2026-08-02** (`docs/dry-runs/2026-08-01-tap-counter-real-multiagent-pilot.md`,
  the first dry run to spawn genuinely isolated subagent processes through the real `Agent` tool
  rather than narrating what agents would do). (1) `docs/31-board-events.jsonl` is operational state,
  never git-tracked, so `git worktree add` never populates it into a linked worktree — an agent
  operating with `cwd` inside `.agent-wt/<TICKET>` (this repo's own `agent-isolation` convention) had
  its default `--log`/`--board` paths resolve against `process.cwd()`, a separate, empty ledger
  inside the worktree instead of the project's real one; reproduced directly when a `code-reviewer`
  spawn inside a worktree held a strict subset of the real board, purely by luck of command order.
  `board.mjs`'s default paths now resolve via `git rev-parse --path-format=absolute
  --git-common-dir`, which finds the one project root regardless of which worktree asked; an
  explicit `--log`/`--board` still resolves against `cwd`, unchanged. (2) Fixing (1) made running
  `board.mjs` from the project root — not the worktree — the natural thing to do, which broke `--bind`
  the opposite way: it assumed `HEAD` from `cwd` always named the reviewed commit, silently binding
  whatever `main` happened to be instead of the reviewed branch. `--commit <sha>` makes the bound
  commit explicit instead of ambient; omitting it keeps the old cwd-relative behavior for a caller
  that really is inside the right worktree. (3) Squash-merge is incompatible with
  `requireApprovalBinding`: a squash merge writes a brand-new commit, so the approved commit's SHA is
  never an ancestor of it and `approval-check.mjs`'s `merge-base --is-ancestor` fails by design, not
  by bug — not fixed in code, documented as an explicit incompatibility in `agents/devops-engineer.md`
  so a project's git-strategy choice and its trust-control choice can't silently contradict each
  other. (4) `docs/team/risk-policy.json`'s critical rule matched the bare substring `store`, so a
  Kotlin class named `CounterStore` — a plain state holder with no billing/release relevance — routed
  critical purely by name; anchored to `app.?store|play.?store|storefront` instead, which still
  matches genuine "prepare the app store listing" language.
- **Independent readiness verdicts, 2026-08-03** (`docs/dry-runs/2026-08-02-blood-pressure-journal-10-10-readiness-plan.md`,
  a dry-run pilot's own readiness charter, which named this as the fix for its sharpest
  self-criticism: a single blended score can read `clear` while one real dimension is not).
  Mission Control's `release` section swept only in-flight tickets, static-only verification and
  S1/S2 bugs into one status — narrower than what "is this actually ready" requires, and averaging
  hides exactly the kind of gap the pilot's reviewer addendum flagged about its own plan (8.5/10
  checklist, 6/10 executability). Two new, independent verdicts now live on Mission Control's
  `readiness.dimensions`, never rolled into the existing section's clear/attention status: an
  `engineering` verdict (`unverified` → `buildable` → `tested` → `production-ready`, derived from
  verification events and `ship-gate.sh`'s last recorded verdict) and a `store` verdict
  (`not-ready` → `founder-actions-required` → `submission-ready`, derived from the same submission
  checklist `readReleaseChecklist` already parses for the Founder Inbox). This is a deliberately
  **partial** implementation of the plan's five-dimension idea (Product/Engineering/
  Compliance/Store/AI-workflow) — Product, Compliance and AI-workflow verdicts are not included and
  `readiness.notCovered` says so explicitly, because this file's own rule is "render only what the
  log can produce" and there is no reader yet for a founder-intent/PRD doc-graph or `trace.mjs`'s
  founder-gate approvals. Inventing those verdicts from signals that don't exist would be the exact
  failure the rule exists to prevent.
- **Dispatch preflight now requires a ticket, and a claim now records its own run identity,
  2026-08-03** (`docs/reviews/2026-08-03-global-plugin-enhancement-plan.md` P0.2's narrow first
  slice — the full workflow-engine rewrite that plan describes is a multi-week program and was
  deliberately NOT started; this is the two-item slice the plan itself named as safe to do first).
  `dispatch-preflight.mjs` ran context/scheduler/capability/risk checks but never required the
  ticket the spawn was actually for — a caller with a valid role/operation/path got a CLEAR with no
  ticket in the picture, so nothing stopped two agents (or one agent twice) from each passing
  preflight for a ticket the scheduler had not marked ready. `--ticket` is now required and checked
  against the scheduler's own `ready` list; a ticket that's unknown, blocked, or dependency-gated is
  refused the same way. Separately, `board.mjs`'s `claimLease()` ran `run-ledger.mjs start` and kept
  only its exit code — the `claimed` event carried no pointer back to the run/attempt that actually
  holds the lease, so the board and the run ledger were two records about the same claim with
  nothing joining them. `claimed` events now carry `run_id`/`attempt_id`/`lease_until` in `detail`,
  parsed from run-ledger's own output rather than re-derived.
- **The `studio` memory class has a real producer, 2026-08-03**
  (`docs/2026-08-03-self-improvement-and-skill-reuse-plan.md`). `scripts/memory-curator.mjs`'s
  class vocabulary (`run/ticket/project/platform/studio/founder`) has existed since the Revamp
  work, but nothing ever proposed a `studio`-class memory — pure scaffolding, the same shape as the
  leasing primitive with no caller and the prompt registry validating an empty shape, both fixed
  earlier this session. Before building a harvester, I checked whether the plan's paired idea
  (role files should check for a better-equipped local skill before reinventing one) was actually a
  gap too — it was not: 11 of 30 role files already carry "external and optional, degrade
  gracefully, never file absence as a defect" language for exactly this, with a named incident
  (`DR4-011`) and its own mirror-tested regression. `/app-learn` now has a sixth pass — distinct
  from its existing app-convention/failure-corpus mining — that reads a `docs/dry-runs/*.md` report
  or an `/app-ship` retro for what the STUDIO's own process should do differently (question
  quality, output format, flow logic, gate design, role design) and proposes each via
  `memory-curator.mjs propose --class studio`, the same governed propose → review → retrieve
  pipeline every other class already uses — never auto-applied. `memory-curator.mjs list` gained a
  `--class` filter so a pending (proposed, not yet reviewed) `studio` entry can be looked at on its
  own instead of scanning every class's output by eye. What promoted learnings actually change
  about agent/role/gate behavior once reviewed is deliberately NOT built yet — that's the next
  phase, once real proposals exist to design the lifecycle around rather than guessing its shape.
- **Phase 0 truth repair, and the first half of a product-correctness engine, 2026-08-04**
  (`docs/2026-08-04-consolidated-enhancement-plan.md`, built from all 20 review/dry-run documents
  with every high-value claim re-verified against the tree — several audit claims were already
  stale and are marked so there rather than acted on).
  (1) **`runtime-gate.sh` returned PASS when screenshot capture failed**, on both the iOS and
  Android paths, with the reason "Screenshot capture failed — no evidence artifact" — a PASS whose
  own sentence says it proved nothing, which `/app-ship` then quotes. Both paths are now
  CANNOT EVALUATE: the app may well be fine, and that is exactly what UNKNOWN means.
  (2) **`ship-gate.sh` invoked `approval-check.mjs` with no `--head`**, so the one check that ties
  an approval to the thing being released never compared them; a project root that is not a git
  repository is now a stated UNKNOWN rather than the silent pass that omission produced.
  (3) **The plugin misreported itself** — `plugin.json` advertised 29 roles while shipping 30, and
  `metadata-check.mjs` printed CLEAR because it only ever inspected the marketplace description.
  It now inspects every manifest, and rejects the "takes an idea to a shipped app" overclaim: the
  pipeline stops at submission-ready and publishing is human-owned, so the shop window may not say
  otherwise.
  (4) **Eval manifests carried narratives that had outlived their code** — `stale-approval` still
  claimed "no board field records what was approved" four days after `--bind` began recording
  commit + diff_hash. Every manifest now carries `last_verified_at`, the corrected claim is
  regression-locked against returning, and named workflow paths must resolve. That check caught a
  second live instance on its first run — and its own first draft produced a false positive on a
  fixture's planted `ci.yml`, fixed by resolving fixture-relative paths first.
  (5) **`defect-hunting` §4b — follow the user's value across the boundary**, required by
  `code-reviewer.md` rather than merely available. Six dry runs measured the same result: the gates
  caught every process defect and **zero** product defects. A date picker whose selection was
  discarded for `System.currentTimeMillis()`, a 24dp touch target where the spec said 56dp, a stale
  TalkBack announcement, a corrupt-data fallback indistinguishable from data loss, a device test
  that exercised its own stub — every one found by a reviewer who went and looked, or by a human
  afterwards. §4b makes the round trip, the distinguishable test value, the on-device measurement,
  and reintroducing the defect to prove the regression catches it into contract rather than a
  reviewer's good day.
  (6) **`scripts/journey-gate.mjs` — a runtime PASS that means the product WORKS, not that a process
  is alive.** Journeys are declared in `docs/team/journeys/*.json` (never inferred) and the gate
  refuses two shapes at load, before anything runs: a journey whose only assertion is `screen`
  (liveness theatre — it re-proves what `runtime-gate` already proves), and a journey that enters
  `""`, `"0"` or **today's date** (indistinguishable from an empty default or a clock call — which
  is precisely why the discarded date picker survived three separate reviews). Wired into
  `/app-build` step 5 immediately after the runtime gate. **The platform drivers are NOT written**:
  with no `--driver`, every declared journey is CANNOT EVALUATE and is listed by name, because an
  unrun journey and a passing journey are different facts. The schema, validation, driver contract
  (`journey-result/v1`) and reporting are complete and carry 21 assertions — including that a driver
  reporting PASS with no evidence is UNKNOWN, and that a driver which *crashes* is UNKNOWN rather
  than FAIL, so a broken harness is never mistaken for a broken app (DR4-001).
- **Dry run 6 — the first measurement of the product-correctness engine, 2026-08-04**
  (`docs/dry-runs/2026-08-04-dry-run-6-findings.md`; hypotheses committed before the fixture
  existed). A real `code-reviewer` agent, told nothing about the plants, against five planted product
  defects of exactly the classes six prior dry runs missed, plus two controls. Result: **8 of 8
  hypotheses passed, 5 of 5 defects detected, 0 misidentifications.**
  **And the honest reading is the deflating one, per the hypotheses doc's own rule.** §4b's table
  *names* those five defect classes and I then planted those five classes, so 5/5 is close to
  tautological — a reviewer applied a checklist and found the checklist's contents. The evidence that
  actually counts is the four findings nobody planted: a compound defect where `save()`→`load()`→
  `persist()` **destroys the entire history on one corrupt byte** (worse than anything planted); the
  ticket's journey being unreachable at all; a boundary test asserting a value the PRD explicitly
  calls "not a limit"; and a critique of the fixture itself (no build files, so "tests pass" had no
  producing step).
  **The most useful negative result: every planted defect was caught by READING. Not one required
  execution.** §4b's expensive half — run the round trip, measure on-device — never ran, so this run
  says nothing about it. §4b's value is the questions it forces, not the device work it mandates.
  The two things reading genuinely could not settle (the 56dp measurement, the clinical range) were
  routed to `verification-engineer` unprompted, which is the reviewer/verifier seam behaving as
  designed. **DR6-01, landed rather than reported:** the reviewer stated its ten unmeasured items
  beautifully and *nothing verified that it had* — "state what you did not do" with no fixed heading
  is unfalsifiable, so it is now a literal `## Not checked` heading required even when empty.
- **Codex review of PR #21 — five findings, two of them against the fixes above, 2026-08-04.**
  (1) `journey-gate` accepted `evidence: ["does-not-exist.png"]` as a PASS — **recreating, inside the
  gate written to forbid evidence-optional passes, exactly that defect**, hours after the same shape
  was fixed in `runtime-gate.sh`. FC-001 in its purest form: the fix that lands in one mechanism and
  stops before its sibling. Every cited artifact must now resolve to a non-empty file.
  (2) The gate checked only `schema` and `result`, never `journey_id`, so a driver that ignored
  `--journey` and returned one cached report counted as a PASS for **every** declared journey.
  (3) `ship-gate.sh` bound the approval to `HEAD` while the runtime gate, the build and the release
  tooling all consume the working TREE — a dirty tree meant the thing being released was not the
  commit any approval named. Now a stated UNKNOWN.
  (4) The journey gate existed but neither shipping path enforced it: `/app-build` printed exit 2 and
  continued, `/app-ship` never invoked it, so a release could clear with no P0 journey ever run.
  (5) `last_verified_at` had been **bulk-stamped without reading the narratives** — the exact defect
  those fields were added to expose, committed by the person adding them. Sweeping for it found a
  SECOND contradictory manifest codex had not flagged.
  **Two method notes worth more than the fixes.** The anti-staleness check first grepped prose for
  absence-claims and then failed on the CORRECTED manifests, because a correction must *quote* the
  false claim to refute it and a regex cannot tell an assertion from a citation — so the claim moved
  into an enumerated `status` field and the prose became free text nobody parses. **Prose is not
  checkable; a field is.** And the dirty-tree fix's own end-to-end test caught two further bugs that
  reading the diff had missed: a false "not a git repository" message emitted alongside the real one,
  and a test using `$BD` ~340 lines above the line that assigns it. §4b's rule, applied to its author.

Everything below this marker is **historical review evidence**. It explains earlier gaps and the
reasoning behind the controls; when it conflicts with the current-state inventory above, the
current-state inventory wins.

This section exists because a handbook that only describes the working parts is the same failure
this system is built to prevent.

> **Last verified: 2026-08-01 (post strategy-review closure pass).** This section is only worth
> reading if it is current, so it carries a date. It was stale for a day once already and listed
> eight defects as open that had all been fixed, then stale a second time — merged to `main` as
> v2.0.0 without this section mentioning either DR5-001, DR5-002, or the second codex review round
> that ran against the review-stack PRs. A handbook that overstates what is broken cannot be
> trusted about what is broken, and neither can one that stops updating the moment the branch does.

**Closed since the previous revision**, each re-probed by execution rather than by reading the diff:
the `ship-gate` plain-format S1 regex · `verify-done` reporting `tests=green` for the literal
command `true` · `integration-branch` always returning `main` · argument injection in `board.mjs
parseArgs` · the missing Origin check on `POST /action` · `code-reviewer.md`'s hand-append
instruction · `verified_static` tickets shipping CLEAR · the four assertions that could not go red ·
**DR5-001** (the audit chain guarded `board.mjs`'s write path and not its read path — `show` and
`render` could report a rewritten log at exit 0) · **DR5-002** (the roster template drifted from the
activation matrix it claims to be generated from).

**Two review rounds by codex against the stacked PRs produced 42 findings. 40 are closed**, each
proven by reverting the fix and watching the assertion that names it go red. Closed in the second
round, beyond DR5-001/DR5-002 above: `cmdArtifact` (formal artifact registration — ADR/PDR/WAIVER/…)
never called the same anti-ping-pong `guard()` a normal `send` does, so an artifact could push a
ticket's thread past the chain-depth limit and be accepted — the same limit `board-doctor`'s
`auditGuards()` enforces retroactively, so it could be written clean and reported as a breach the
moment anything re-audited the log · `board.mjs`'s and `messages.mjs`'s append functions both
concatenated raw bytes onto a log without checking for a trailing newline, so a hand-edited or
externally-written log missing one got the next JSON object glued onto the last line as `}{`,
silently corrupting every line after it · a credential was written verbatim into the `blocked` event
of a ticket created `--status blocked`, after the CLI printed that it had been redacted — the
`created` event scrubbed `--notes`, the `blocked` event built from the raw flag · `--kind answer
--priority fyi` and `--kind decision --priority fyi` closed an open question with nothing delivered,
because the `fyi` exemption was checked before the closing-kind rule rather than after · founder
gate approvals were keyed on the trigger's TOPIC rather than the VALUE it covers, so approving
`$3.99/month` once cleared the pricing gate forever — a later change to `$99/month` sailed through
with the same stale approval, and the same defect let one waiver authorize every later one ·
`trace.mjs` never checked that a node's declared `src:` actually resolved to a real node, so a
requirement citing a deleted or renamed outcome still traced clean · `founder-intent.mjs --write`
accepted a DELETION of a previously recorded file as a no-op rather than a refusal, so the append-only
guarantee only held for edits, not removals · `repo-controls.sh` counted required status-check
*names* by array length instead of checking which names were present, and never queried secret
scanning or push protection at all while still reporting "every server-side control is set."

**Blocking, verified open right now — 2 findings:**

- **Audit-chain truncation is undetectable.** `verifyChain()` proves forward consistency of the
  lines *present* in a log; nothing anchors how many lines *should* be present, so deleting the
  trailing N lines of `docs/31-board-events.jsonl` — say, the line recording an S1 rejection —
  leaves the remaining chain fully "intact." Lower-urgency than it first reads: an attacker who can
  edit the log and needs `verify` to stay green already has repo write access, and at that point can
  `git commit --amend` the evidence away by other means too. Still a real gap in a claim this repo
  makes explicitly. Not fixed because the honest options — a sidecar tip file (same trust problem,
  relocated), verifying against the log's last committed `git` state (adds a git dependency to a
  currently git-agnostic checker), or documenting the limitation and moving on — are a product
  decision, not an engineering one.
- **Stale approval remains structurally undetectable.** An approval still does not bind to a commit or
  immutable evidence snapshot. This requires a repository-trust decision, not another heuristic.

The previously open message-ID race and follow-up-obligation gap are closed: writes use a lock,
non-question obligations require delivery evidence, and the suite covers both behaviors. The
evaluation lab now detects 12/12 scored planted defects; stale approval is the one intentionally
unmeasured detector class.

**Never exercised:** `/app-ship` end to end — hypothesis **H1** of dry run 5, still unrun. Several
of that run's hypotheses have no verdict at all. Autonomous release stays disabled until they do.

**Newly proven, because it was a gap for months:** `runtime-gate.sh`'s central claim — that an app
which builds is not an app that runs — now executes on every push. A `macos-15` CI job runs it
against `eval/crash-on-launch` on real Xcode and asserts **exit 1**, then repairs the one
force-unwrap and asserts **exit 0** on the otherwise identical app.

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

Every open item is specified with a reproduction: dry run 4 in
`docs/research/2026-07-29-dry-run-4-findings.md`, dry run 5 in
`docs/research/2026-07-30-dry-run-5-findings.md`.

---

## Part 13 — The three sentences

If you keep nothing else:

1. **A green signal is evidence only to the extent it could have gone red.**
2. **When you fix something, ask who else touches this value between the fix and the human.**
3. **The failure mode must be "honestly blocked," never "falsely complete."**
