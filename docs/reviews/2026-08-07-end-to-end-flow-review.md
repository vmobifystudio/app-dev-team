# End-to-end flow review — 2026-08-07 (second pass)

**Seat:** the operator's. Not "is each gate correct" — the first review of today answered that — but
**does the thing run end to end, for a founder, across a whole project, and do the parts agree with
each other.** Endpoints, call graph, ticket lifecycle, communication flow, role economy, and the
cross-links between them.

**Method:** the command→script call graph for all 27 commands, the role table against
`BUILD_SPAWNABLE_OWNERS`, the ticket lifecycle driven by hand through every transition on a real
fixture, and `git show` against this morning's two commits to check what they broke. Three findings
below were produced by executing, not reading, and the headline one is a regression **I** introduced
today.

**Scope note:** the first review (`2026-08-07-adversarial-operations-review.md`) covered economics.
This covers coherence. They do not overlap; where they touch, this one cites it.

---

## 0. The verdict, in one paragraph

The studio's *parts* are now unusually good and its *seams* are where everything fails. Every finding
below is a disagreement between two components that are each individually correct: a reconciler that
does not know about the wave that was added under it; a runbook that grew 20% in the same commits
that were justified by that runbook being too long to follow; a communication protocol with an
obligation nothing checks; a roster of 30 in which 15 can never own work and 4 never execute in an
autonomous run at all; six commands with no mechanism, including the one you reach for when a run has
crashed. **Nothing here is a gate that fails. Everything here is two things that were never
introduced to each other.**

---

## 1. EE-001 · S1 · The wave model deadlocks the loop after any failed wave

**This is a regression from commit `98058c3`, this morning, and it is mine.**

**Reproduced, not reasoned.** Drive one ticket by hand to the merge gate on a fixture — `claimed`,
`done_reported`, `verified_static`, `review_requested`, `approved`, `merged` — which is exactly what
`/app-build` steps 2–4 now do, and then ask the loop whether it may start another round:

```
$ node scripts/board.mjs show APP-001
  APP-001   qa (static only)   owner=ios-developer   events=7

$ node scripts/merge-reconcile.mjs --root .
  MERGE RECONCILE: 1 ticket(s) claim integrated code that is NOT in main
    APP-001 [qa] — feat/APP-001 is not an ancestor of main
  exit 1

$ node scripts/orchestrator.mjs round --root .
  BLOCKED   merge truth — a ticket claims its code is integrated and git says it is not —
            the board is lying
```

**The accusation is false.** The board is not lying. The merge gate is a *permission*, the wave pass
is the *fact*, and between them the ticket legitimately sits at `qa` with an unmerged branch. That
gap is not a bug — it is the entire point of the wave model, and `tech-manager.md` now says so in
those words.

**Why it is S1 rather than cosmetic.** `merge-reconcile.mjs` is a *precondition* of
`orchestrator.mjs round`, and `/app-build` step 0's rule is "Exit 1 → **BLOCKED. Spawn nobody this
round.**" So:

- a wave that exits `1` (a failing suite, a conflict) leaves its tickets at `qa` unmerged — **the
  next round cannot start**;
- a wave that exits `2` (no `full` scope declared, toolchain absent — the *expected* path today)
  does the same;
- so does any round that ends between step 4 and step 5: a budget ceiling, `.studio-stop`, a context
  reset, an operator closing the laptop.

The loop's recovery path from a failed wave is therefore *blocked by the loop's own health check*,
and the message tells the operator to "merge it, or correct the board" — i.e. to route around the
wave model by hand. A gate that instructs you to defeat the design is worse than no gate.

**The fix is small, and the signal already exists.** `verifiedStatic` distinguishes the two states
without a new field:

| Ticket state | Branch not an ancestor of `$BASE` means |
|---|---|
| `qa`, `verifiedStatic: true` | **PENDING** — the wave has not run yet. Legitimate. Report, do not block. |
| `qa`, `verifiedStatic: false` | the wave ran and reported green, so the branch **must** be integrated. A lie. Block. |
| `done` | must be integrated. A lie. Block. |

That also preserves today's behaviour exactly for a project not using the wave model: it merges per
ticket, `verifiedStatic` is false at `qa`, and the check bites as it always did.

**The lesson, which is the transferable part.** I added a mechanism (`wave-integrate.mjs`) that
changed the *meaning* of an existing event (`merged`), and I checked every consumer I had written
myself while missing the one written by someone else three weeks earlier — whose entire purpose is to
police that exact event. That is FC-001, this repository's own defining defect class ("the fix that
lands in one mechanism and stops before its sibling"), committed by the person who had just spent the
day writing about it.

---

## 2. EE-002 · S1 · I made the runbook 20% longer to fix a problem caused by its length

```
commands/app-build.md      630 → 753 lines   (+19.5%)
agents/tech-manager.md     365 → 442 lines   (+21.1%)
```

The instruction load for **one build round** is now:

| File | Lines |
|---|---|
| `commands/app-build.md` | 753 |
| `agents/tech-manager.md` | 442 |
| `agents/code-reviewer.md` | 375 |
| `skills/team-protocol/SKILL.md` | 426 |
| `skills/parallel-orchestrator/SKILL.md` | 254 |
| `skills/agent-isolation/SKILL.md` | 223 |
| `skills/ic-workflow/SKILL.md` | 160 |
| **total** | **2,633** |

`orchestrator.mjs`'s own header states the problem it was built to solve: *"an agent must read past a
thousand lines of instructions and then REMEMBER to run four separate checks in the right order. That
is the same pressure that produced dry run 3's skipped transition: not ignorance, load."* The
response was to collapse four steps into one command. **This morning I added six more scripts and
described every one of them in the same file, in prose, at length.**

And the open question in `RESUME.md` — *"whether an AGENT following `app-build.md` reaches the same
outcomes a careful hand does. Every finding above came from driving the CLI directly. That question
needs a spawn."* — is now **harder to answer favourably than it was yesterday**, because the thing
the agent must follow got longer.

**Where the prose belongs.** Every one of my additions is already a script with a self-explaining
header — that is this repository's established convention and the reason `verify-done.sh` opens with
forty lines of argument. The *why* belongs there. The runbook should say what to run, in order, and
what each exit code means. As a rough target, `/app-build` step 5 should be four lines and a table,
not the forty I gave it.

This is not a style complaint. It is the single mechanism most likely to decide whether the six gates
built today ever actually fire in a real agent-driven run.

---

## 3. EE-003 · S2 · Nothing verifies the one step that turns a guess into a decision

`/app-build` step 1b is, by its own argument, the highest-leverage step in the loop: *"a question
answered after the wave is spawned is answered too late — the developer has already decided.
Measured across three dry runs and ten agent-runs, the live channel was used zero times."*

Its verification is a sentence:

> Then re-render and confirm the count actually fell. A batch that comes back with the same number of
> open questions means `tech-lead` wrote prose instead of ledger rows.

**Nothing checks that.** Compare it with the step directly below it, where the same class of problem
got a script — `report-check.mjs` exists because *"reading the report does not catch this: the one
that failed sounded complete, named its own skips and explained itself."* A `tech-lead` that returns
a thoughtful paragraph instead of `answer` rows produces exactly that shape, and the only thing
standing in the way is an instruction to go and look, in a 753-line file.

**Fix:** `messages-render.mjs` already computes the open-question count. Either make it exit non-zero
when the count did not fall across a round, or add `messages.mjs check --before <n>`. Either is under
thirty lines and it closes the loop's only real communication gate.

---

## 4. EE-004 · S2 · The autonomous run has a channel to the founder that the autonomous run never uses

`team-protocol` requires that every `escalation` addressed to `tech-manager` is *"resolved or passed
to the user in the same round"*. `docs/17-founder-inbox.md` exists for exactly this and
`team-doctor` declares its writer: `agents/chief-of-staff.md`.

**No step in `/app-build` or `/app-run` writes it.** `/app-run` surfaces "only blockers and the two
human gates", and an escalation is not a blocker in that sense — the ticket that raised it keeps
moving. `/app-status` lists unresolved escalations, but `/app-status` is a command a human types, and
the whole premise of `/app-run` is that the human is not typing commands.

So in the mode the studio is designed to be used in, an escalation to the founder is written to a
ledger, counted by a renderer, and read by nobody until someone asks. The mechanism is complete
except for its last link.

---

## 5. EE-005 · S2 · A roster of 30 that behaves like a team of 12

`BUILD_SPAWNABLE_OWNERS` holds **15** of the 30 roles. The other 15 cannot own a ticket, correctly —
they gate and coordinate:

```
ceo · chief-of-staff · cpo · cto · tech-lead · tech-manager · code-reviewer · security-reviewer
release-manager · release-auditor · privacy-reviewer · product-validator · red-team-agent
reliability-engineer · incident-commander
```

That is a sound rule. The consequence nobody has costed is that **a role which cannot own a ticket
only ever runs when a specific command calls it**, and four of them are called by two commands each,
neither of which is `/app-build` or `/app-run`:

`red-team-agent` · `reliability-engineer` · `incident-commander` · `privacy-reviewer`

In an autonomous run — the studio's designed mode — those four never execute. They are maintained
surface: they carry instructions, they are checked by `team-doctor`, they are synced into the prompt
registry, and they produce nothing. Either the loop should reach them (a red-team pass per sprint, a
reliability review before ship) or the roster should say plainly that they are on-demand only.

The founder-facing version of this: **the studio presents as a 30-person team and behaves as a
~12-person one.** That is not necessarily wrong — but it should be a decision, not an emergent
property of who happens to be cited in `app-build.md`.

---

## 6. EE-006 · S2 · Six endpoints have no mechanism, and one of them is the crash handler

| Command | Lines | Scripts invoked |
|---|---|---|
| `/app-audit` | 126 | none |
| `/app-onboard` | 83 | none |
| `/app-team` | 69 | none |
| `/app-review` | 17 | none |
| `/app-preflight` | 15 | none |
| **`/app-recover`** | **11** | **none** |

`/app-team` is a listing and needs nothing. `/app-audit` and `/app-onboard` are orchestration prose
that spawns agents, which is defensible.

**`/app-recover` is not.** Eleven lines of prose, invoking nothing, describing a lease protocol
against a run ledger — and it is the command you reach for at the single highest-stress moment the
system has: a run that died mid-flight, with worktrees possibly leased, tickets possibly claimed, a
wave possibly half-merged. `run-ledger.mjs` and `run-doctor.mjs` both exist. `/app-run-status` calls
`run-doctor`. `/app-recover` calls nothing.

Note the interaction with EE-001: the state after a crashed round is *precisely* the state that now
blocks the next round, and the command for recovering from it is the least mechanised in the repo.

---

## 7. EE-007 · S3 · The register is invisible where a founder actually looks

`docs/90-register.jsonl` (added this morning) is read by `ship-gate.sh`, `orchestrator round` and
`/app-status`. It is **not** read by `studio-dashboard.mjs`, `control-room/`, or `portfolio.mjs` —
the three surfaces built specifically for a founder looking across projects.

A portfolio view that cannot say *"project X has nine findings nobody has decided about"* is exactly
the view that lets it happen. The register's whole argument is that an item with no ticket gets
closed by being unmentioned; leaving it out of the cross-project surfaces reproduces that failure one
level up.

---

## 8. EE-008 · S3 · Three commands still describe the pre-wave model

```
$ grep -c wave-integrate commands/app-run.md commands/app-recover.md commands/app-status.md
0  0  0
```

`/app-run` is the **autonomous driver** and the command a founder is most likely to type. Its
operating rules still say *"`verify-done.sh` runs on every developer return"* (it is now `--static`)
and its loop is described as *"merge gate → `qa-engineer` → bug loop"* with no integration step at
all. It delegates to `/app-build` so the behaviour is inherited and correct; the description a human
reads is a version of the studio that no longer exists.

---

## 9. EE-009 · S3 · Intent is traced at the start, at the gate and at release — never during the sprint

`trace.mjs` walks goal → outcome → requirement → criterion → ticket → test → analytics and reports
every break. Its callers: `/app-init`, `/app-run` (before Gate 1), `/app-ship`. **Not `/app-build`.**

So the chain is verified before any ticket exists, and again when it is too late to be cheap. A
ticket created mid-sprint — a `BUG-NNN-fix`, an `AUDIT-NNN`, anything `tech-manager` cuts in
response to QA — attaches to no requirement, and nothing notices until the release gate. That is the
`stranded`-ticket problem one level up: not "a ticket nobody works" but "a ticket nothing asked for".

One `trace.mjs --only trace` in step 0 would cost a second and catch it in the round that created it.

---

## 10. Findings register

| ID | Sev | Finding | Fix size |
|---|---|---|---|
| EE-001 | S1 | Wave model deadlocks the loop after a failed/deferred wave (**regression, mine, today**) | ~10 lines in `merge-reconcile.mjs` |
| EE-002 | S1 | Runbook grew 20% in the commits justified by its length; agent-followability now worse | large — move prose to script headers |
| EE-003 | S2 | Nothing verifies the mid-sprint Q&A produced answers | ~30 lines |
| EE-004 | S2 | Escalations never reach the founder in an autonomous run | one step in `/app-build` step 6 |
| EE-005 | S2 | 4 roles never execute in an autonomous run; roster overstates the team | a decision, then a step |
| EE-006 | S2 | `/app-recover` is 11 lines of prose for the highest-stress moment | wire `run-ledger` + `worktree-reap` |
| EE-007 | S3 | Register invisible to dashboard / control room / portfolio | 3 readers |
| EE-008 | S3 | `/app-run`, `/app-status`, `/app-recover` describe the pre-wave model | doc edit |
| EE-009 | S3 | `trace.mjs` never runs during a sprint | one line in step 0 |

---

## 11. What I would do, in this order, and why

1. **EE-001.** It is an S1, it is a regression from today, and it is ten lines. Until it is fixed the
   studio cannot restart after a failed wave — which is the state a real project reaches on its first
   red suite.
2. **EE-008.** The autonomous driver describes a model that no longer exists. Cheap, and it is the
   document a founder reads.
3. **EE-003 and EE-004 together.** Both are the communication flow's last link, both are small, and
   together they are the difference between a ledger and a conversation.
4. **EE-002.** The largest and the one that decides whether any of this runs unattended. It is also
   the one that must not be done in a hurry: shortening a runbook by deleting the reasons is how the
   reasons get re-litigated in six weeks.
5. Then **E1–E6** from the first review, which remain the only thing that would turn any of this from
   argued into measured.

---

## 12. Not checked

- **`control-room/` (5 screens) and `studio-dashboard.mjs` were not read.** EE-007 is a claim about
  what reads the register, established by grep, not a review of those surfaces.
- **`/app-ship` end to end.** Out of scope here and, per `RESUME.md`, still never executed against a
  real submission.
- **The eval lab's fixtures.** `RESUME.md`'s own caveat stands: 13 of 15 name the detector written
  for them in the same session, so "12/12" measures self-consistency.
- **No agent was spawned for this review**, so the question that matters most — whether an agent
  following these files behaves like a careful hand — is still unanswered, and EE-002 is my estimate
  of which way it has moved, not a measurement.
- Everything here except EE-001 came from reading the call graph. EE-001 was executed.
