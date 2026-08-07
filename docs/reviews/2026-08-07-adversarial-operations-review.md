# Adversarial operations review — 2026-08-07

**Scope:** the regular working process, not the gates' correctness. Communication, conflict
management, ticket assignment, reporting, issue solving, code review of tickets, git strategy,
worktree/storage economics, CI ownership, build-and-test batching, and the issue register.

**Method:** read the loop end to end (`commands/app-build.md`, `agents/tech-manager.md`,
`agents/code-reviewer.md`, `skills/{agent-isolation,parallel-orchestrator,ic-workflow,team-protocol}`,
`scripts/{verify-done.sh,spawn-gate.sh,dispatch-preflight.mjs,contention-check.mjs}`,
`knowledge/git-workflow.md`, `.github/workflows/`), then walked one concrete wave and counted what
it costs. Every finding below names the file and the line that produces it. Nothing here was found
by reading a summary.

**Posture:** this is the critic's document. It does not restate what works. Everything the gates
already do correctly — the event log, the refusal-as-finding discipline, `verified_static`,
`verify-done`'s 1/2 split, the contention wiring into `dispatch-preflight` — is assumed and not
praised.

> **STATUS — the wiring landed on `feat/ops-review-wiring`, 2026-08-07.** Every S1 and the two S2s
> with a mechanical answer are now scripts with exit codes, assertions and mutations. What has NOT
> happened is §5's experiment list: this document was written by reading, and the fixes were verified
> against fixtures, not against a live sprint. E1–E6 remain the honest next step, and E6 (what a wave
> actually costs) is the one that decides whether any of this paid.
>
> | ID | Fix | Where |
> |---|---|---|
> | OPS-001 | CI conclusion read at round start; opt-in, SHA-pinned waiver | `scripts/ci-status.mjs`, `orchestrator round` |
> | OPS-002 | one merge sequence and one push per wave | `scripts/wave-integrate.mjs` |
> | OPS-003 | caches outside every worktree; per-ticket verification goes static | `scripts/build-env.sh`, `verify-done.sh --static` |
> | OPS-004 | one register, terminal status required, ship-gate refuses | `scripts/register.mjs`, `ship-gate.sh` §3b |
> | OPS-005 | slot leased per owner, not per ticket | `scripts/worktree-slot.mjs` |
> | OPS-006 | reaper on every terminal outcome + 5 GB ceiling | `scripts/worktree-reap.mjs` |
> | OPS-008 | conflicts resolved by the integrator, not a cold respawn | `wave-integrate.mjs`, `tech-manager.md` §Merge gate |
>
> **Deliberately not built:** OPS-007 (contention still rests on an optional `--file`), OPS-009
> (answers still cannot re-open a merged ticket), OPS-010 (review is still per ticket), OPS-011
> (retries still start cold), OPS-012, OPS-013, OPS-014. Each needs a decision this review should not
> make on its own — see §5 for the order.

---

## 0. The one-paragraph verdict

The studio has built an excellent **correctness** machine and no **economics** machine. Every gate
asks "is this legal?" and none asks "what did that cost, and did we buy anything with it?" The
consequences compound in exactly the four places the founder named: the loop builds per ticket
instead of per wave, pushes CI per merge and then never reads a CI result, creates one git worktree
per ticket with a removal path that only exists on the happy branch, and tracks the work that
matters — bugs and audit findings, the two registers that drive all re-work — in hand-edited
Markdown with no CLI, no schema and no doctor, while the one register that has all three is
downstream of both.

None of that is a gate failing. It is the absence of an integration role. The loop currently asks
**every developer, every reviewer and every ticket** to carry a share of build, test and merge
responsibility, and the cost is paid N times per wave for a signal that is only meaningful once.

---

## 1. The practical scenario — one wave, counted

**Setup, deliberately ordinary:** an iOS project, sprint 1, wave 1. Three ready tickets:
`APP-001` (store), `APP-002` (list screen), `APP-003` (settings screen), owned
`ios-developer`, `ios-developer`, `ios-developer`. Integration branch `develop`. `.studio-policy.json`
has `requireApprovalBinding: true`. Toolchain present. No `--file` was passed at ticket creation,
because `tech-manager.md` makes it conditional ("**If** the ticket touches a named file").

### What the loop actually does, in order

| # | Step | Command / spawn | Count |
|---|---|---|---|
| 1 | Round preconditions | `orchestrator.mjs round` | 1 |
| 2 | Read state | `board.mjs show --json` | 1 |
| 3 | Assumption routing | `team-message.sh` per `ASSUMED, NOT RAISED` from last round | 0 (round 1) |
| 4 | Mid-sprint Q&A | `messages-render.mjs`, then `tech-lead` spawn if non-empty | 1 + 0 |
| 5 | Dispatch gate | `dispatch-preflight.mjs` **per ticket** | 3 |
| 6 | Claim | `board.mjs move … claimed` per ticket | 3 |
| 7 | Worktrees | `git worktree add .agent-wt/APP-NNN -b feat/…` per ticket | 3 |
| 8 | Isolation gate | `spawn-gate.sh APP-001 APP-002 APP-003` | 1 |
| 9 | Developers | **`ios-developer` spawns** | 1–3 (see §2, OPS-005) |
| 10 | Report contract | `report-check.mjs` per return | 3 |
| 11 | Claim recorded | `board.mjs move … done_reported` | 3 |
| 12 | Base resolution | `integration-branch.sh` | 1 |
| 13 | **Verification** | `verify-done.sh <branch> develop fast` per ticket | **3 cold builds** |
| 14 | Verified | `board.mjs move … verified` | 3 |
| 15 | Route to review | `board.mjs move … review_requested` | 3 |
| 16 | Reviewers | **`code-reviewer` (opus) spawns**, one per ticket | 3 |
| 17 | Reviewer sub-agents | Axiom auditors per review (UI ticket → 2; data ticket → 1) | 3–5 |
| 18 | Reviewer started | `board.mjs move … started` | 3 |
| 19 | Injection tripwire | `injection-scan.mjs` per review | 3 |
| 20 | design-qa gate | `ux-architect` pass on APP-002, APP-003 | 2 |
| 21 | Verdict | `board.mjs move … approved --verdict --bind` | 3 |
| 22 | Binding recheck | `approval-check.mjs` per ticket | 3 |
| 23 | Merge gate | `board.mjs move … merged` | 3 |
| 24 | **Git merge** | `fetch`, `checkout`, `pull`, `merge --no-ff`, **`push`** per ticket | 15 (**3 pushes**) |
| 25 | Worktree cleanup | `worktree remove` + `prune` per merged ticket | 6 |
| 26 | Runtime gate | `runtime-gate.sh` on `develop` | **1 full app build** |
| 27 | Journey gate | `journey-gate.mjs --driver drivers/ios.sh` | 1 |
| 28 | QA ticket | `board.mjs add` + `move claimed` | 2 |
| 29 | QA agent | **`qa-engineer` spawn** | 1 |
| 30 | QA verification | `verify-done.sh … --docs-only` + review + merge chain | ~8 |
| 31 | Close | `qa_passed` + `closed` per ticket | 6 |
| 32 | Standup | `tech-manager` spawn + `board-render.mjs` | 1 + 1 |
| 33 | Journal | `round-journal.mjs append` | 1 |

**Totals for one clean wave with zero retries:**

- **~95 CLI invocations**
- **12–17 agent spawns**, of which 4–8 are opus (`code-reviewer` is `model: opus`, `tech-manager`
  is `model: opus`)
- **4 full builds** — three per-ticket `fast` runs in cold worktrees, plus one wave build
- **3 CI runs on the integration branch** — one per `git push origin develop`
- **3 git worktrees**, plus 3 more created and destroyed inside `verify-done.sh` (`mktemp -d`)

**With one review cycle on one ticket** (the plugin's own measured norm, and well inside the
2-cycle cap): add 1 developer spawn one tier up, 1 cold build, 1 reviewer spawn, 1 auditor set,
1 `approval-check`, 1 more push, 1 more CI run.

**At the spawn budget's ceiling** — 6 developer retries on one ticket — that single ticket alone
costs **7 cold builds and 7 developer spawns**, and nothing in the loop notices the pattern until
the per-ticket cap trips.

### What the wave bought

One answer to "does the app build and launch" (step 26), one answer to "does a P0 journey hold"
(step 27, today almost always `CANNOT EVALUATE` — drivers do not ship), and three answers to "does
`APP-NNN`'s branch pass its own scoped tests" (step 13).

Steps 13 and 24–26 are the expensive ones and they are the ones that are **paid per ticket for a
signal that is only meaningful per wave**. Three individually-green branches say nothing about the
merged tree; the loop's own comment at step 5 of `app-build.md` says exactly this and then still
runs the per-ticket builds anyway.

---

## 2. Findings register

Severity uses the studio's own scale. `S1` = the loop produces a wrong or unverifiable result, or
an unbounded resource. `S2` = the loop produces a correct result at avoidable cost, or a rule that
cannot fire. `S3` = a contradiction or gap that has not yet cost anything.

---

### OPS-001 · S1 · CI is declared a merge gate and implemented nowhere

**Claim.** `knowledge/git-workflow.md` §CI: *"A clean build + green tests is a hard merge gate.
Flagship apps also require a CTO/code-review agent pass (zero Critical + zero Important) before
merge."*

**Reality.** The merge gate is `board.mjs move APP-NNN merged --by tech-manager`
(`agents/tech-manager.md` §Merge gate step 2). It re-derives one thing from the event log: that an
`approved` event exists authored by a role other than the ticket owner. It does not read a workflow
conclusion, a check-run status, or anything on the server. Grepping the whole plugin for `gh run`,
`workflow_run`, `checks green` or a required-status-check read returns **two hits, both inside
`scripts/repo-controls.sh`**, which only *reports* whether server-side protection is configured and
whose `--print` output `devops-engineer` is explicitly forbidden from executing.

**Consequence.** On any project where the user has not personally configured branch protection —
the default state of every project this studio creates — a ticket merges to the integration branch
with CI never consulted, in either direction. CI runs after the push, and if it goes red, nothing
in the loop reads it, nothing blocks the next merge, and the standup does not mention it. The
sentence in the House KB is a rule with no enforcing mechanism, which is the exact shape
`docs/25-engineering-rules.md` was written to stop.

**Fix.** §3.C. The build result must become an input the merge gate consumes, and under the
integrator model that result is produced locally by the integrator, not by the server.

---

### OPS-002 · S1 · CI cost scales with ticket count, for zero information

**Where.** `agents/tech-manager.md` §Merge gate step 3 — `git push origin "$BASE"`, run once per
ticket merge.

**Consequence.** A three-ticket wave pushes the integration branch three times and starts three CI
runs on identical-except-one-commit trees. For an iOS project those are `macos-15` runners at
roughly ten times the per-minute cost of `ubuntu-latest`. All three are read by nobody (OPS-001),
and the first two are superseded before they finish. The plugin's own `checks.yml` carries a long
comment explaining that duplicate triggers were removed because *"pushing six review-stack marker
branches fired six full runs that reviewed nothing"* — and the loop it governs does the same thing
by construction, once per merged ticket, forever.

**Fix.** One merge sequence per wave, one push per wave, one CI run per wave. Information lost:
zero, since nothing reads the intermediate ones. Cost reduction: N×.

---

### OPS-003 · S1 · Every ticket pays a cold build, and the cache is thrown away

**Where.** `scripts/verify-done.sh` §5. When the branch is checked out in a worktree it runs there;
otherwise it does `mktemp -d` + `git worktree add --detach`, runs the test command, and deletes the
directory in the `EXIT` trap.

**Consequence.** Both paths are cold. A per-ticket `.agent-wt/APP-NNN` has never built before; a
`mktemp -d` detached worktree has never built before and is deleted afterwards so it never will
again. Nothing pins `DERIVED_DATA_PATH`, `GRADLE_USER_HOME`, an SPM cache, or a `~/.gradle` share
outside the tree. On iOS a cold `xcodebuild test` on a small app is minutes; on a real one it is
tens of minutes. This is paid **per ticket, per DONE, per retry** — up to 7× for a single ticket at
the spawn budget's ceiling.

The `fast`/`full` scope split (F6, `project-profile.json`) was invented to fix exactly this and
fixes the wrong half: it reduces *which tests run*, not *how many times the toolchain warms up*.
A scoped test suite in a cold tree still pays the full compile.

**Fix.** Two independent changes, both cheap:
1. Pin build caches outside the worktrees (`.studio-cache/DerivedData`, `.studio-cache/gradle`) and
   export them into every test invocation. One env block; largest single infra saving available.
2. §3.C — stop building per ticket at all. Per-ticket verification becomes static; the build moves
   to the wave.

---

### OPS-004 · S1 · There is no register — there are eleven, and the two that drive re-work are hand-edited Markdown

**Inventory of everything the studio currently tracks work in:**

| # | Register | Path | Writer | Machine behind it |
|---|---|---|---|---|
| 1 | Tickets | `docs/31-board-events.jsonl` | `board.mjs` | event log + state machine + doctor |
| 2 | **Bugs** | `docs/51-bugs.md` | **`qa-engineer`, by hand** | **none** |
| 3 | **Audit findings** | `docs/81-findings.md` | **`tech-manager`, by hand** | **none** |
| 4 | Questions / decisions | `docs/team/messages.jsonl` | `team-message.sh` | event log + obligations |
| 5 | Rounds | `docs/33-rounds.jsonl` | `round-journal.mjs` | ceilings |
| 6 | Runs | `docs/team/runs.jsonl` | `run-ledger.mjs` | — |
| 7 | Incidents | `docs/73-incidents/` | `incident-commander` | `incident-ledger.mjs` |
| 8 | Assumptions | `docs/25-assumptions/` | ICs | — |
| 9 | Review verdicts | `docs/53-reviews/` | `code-reviewer` | parsed by `board.mjs --verdict` |
| 10 | Decisions | `docs/16-pdr/`, `docs/24-adr/` | `cpo`/`cto` | `messages.mjs artifact` |
| 11 | Daily fragments | `docs/daily/` | every IC | existence check only |

**The defect.** Registers 2 and 3 are the ones that feed work *back into* the loop — every bug fix
and every remediation ticket originates there. They are the only two with no CLI, no schema, no
append-only log, no validator and no doctor. Everything downstream of them is rigorously
mechanised; the source is a Markdown table an agent edits by hand.

**The link is prose.** `commands/app-build.md` step 1: *"for every open `S1` or `S2`, ensure a
matching `BUG-NNN-fix` row exists on the board; if not, spawn `tech-manager` once."* There is no
gate that fails if that never happens. A bug that never becomes a ticket is invisible to
`board-doctor`, to `orchestrator round`, to the sprint-exit check (step 8 accounts for every
non-`done` **row**, and a bug with no row is not a row), and to `ship-gate.sh`. `tech-manager.md`
already documents this exact failure at scale — *"~70 findings were silently skipped in a real
programme while four review rounds reported nothing wrong"* — and the mechanism that allowed it is
still the mechanism in use.

**A second, sharper edge.** `agents/qa-engineer.md` writes `51-bugs.md` **inside its worktree, on
its branch**, and `app-build.md` step 5 rejects a QA return that does not do this. So the bug list
only becomes visible to the shared tree when the QA ticket merges. Step 1 of the *next* round reads
`docs/51-bugs.md` from the shared tree. If the QA ticket has not merged — it goes through the full
review-and-merge chain like any other — the round reads a stale file and finds no bugs. The register
that re-enters defects into the loop is one merge behind the loop.

**Fix.** §3.D.

---

### OPS-005 · S1 · Worktree-per-ticket and agent-per-owner contradict each other, and no document resolves it

**The two rules.**

- `skills/parallel-orchestrator/SKILL.md` step 2: *"Group by owner. One agent invocation per owner,
  batched. iOS dev gets all their ready tickets in one prompt."*
- Same file, step 2a, and `skills/agent-isolation/SKILL.md` Rule 1, and `scripts/spawn-gate.sh`
  (`DIR=.agent-wt`, checked per ticket ID): one worktree **per ticket**,
  `.agent-wt/APP-NNN -b feat/APP-NNN-slug`.
- `skills/parallel-orchestrator/SKILL.md` step 3: *"Each agent's prompt must name **its worktree
  path** as the project root."*

**The contradiction.** In the §1 scenario one `ios-developer` owns three tickets. It is spawned
once, with three worktrees created for it, and told to use "its worktree path" — singular — as its
project root. There is no such path. The agent has three, and one working directory.

**Both resolutions are broken today.**

- *Work all three in one worktree.* Then `feat/APP-002` and `feat/APP-003` do not exist, or are cut
  from a tree containing the other tickets' files. `code-reviewer` check 9 ("does the branch contain
  **only** this ticket's files") then issues `REQUEST CHANGES` on work that is correct, and its
  instruction — *"a diff carrying another ticket's work means the developer worked in a shared tree…
  the other ticket's branch is probably also wrong"* — sends `tech-manager` hunting a collision that
  the orchestrator caused.
- *Spawn once per ticket.* Correct, and it silently discards the batching that step 2 exists to
  produce: three cold context builds instead of one, three full reads of
  `docs/22-impl-spec-ios.md`, `docs/21-engineering-principles.md`, and the ticket's spec chain.

**This has not been hit yet** because no real multi-ticket-per-owner wave has run — the studio's own
number is 19 tickets created, 1 closed. It will be hit by the first one.

**Fix.** §3.B — lease a worktree **per owner-slot**, not per ticket. The owner works its tickets
sequentially inside its slot, one branch each, committing between. Batching survives; isolation
survives; disk is bounded by parallelism instead of by backlog size.

---

### OPS-006 · S1 · Worktree removal exists only on the happy path; there is no reaper and no cap

**Where.** Removal is specified in exactly three places, all of them the merge path:

- `commands/app-build.md` step 4a: *"After each **merge**, remove the ticket's worktree."*
- `agents/tech-manager.md`: *"`git worktree remove` **after its merge**."*
- `skills/agent-isolation/SKILL.md`: *"Cleanup **after the merge gate**."*

**Not specified anywhere:** removal after `rejected`, after `changes` (the branch is re-worked, so
it survives — but after the 2-cycle cap converts the third `changes` into `blocked`, nothing removes
it), after `blocked`, after a `BLOCKED: APP-NNN` return, at sprint exit (step 8 re-runs the doctor
and prints a summary; it removes nothing), or after a crashed or interrupted round. There is no cap
on concurrent worktrees, no disk budget in `round-journal.mjs`'s ceilings (`--max-rounds`,
`--max-spawns`, `--max-retries`, `--max-spend-usd` — no `--max-disk`), and no reaper anywhere.

**Live evidence, in this repository, right now.** This is the plugin repo, not a generated project,
and the worktrees are the Claude Code harness's rather than `.agent-wt/` — but the leak class is
identical and it is measurable:

```
$ git worktree list | wc -l          → 13   (1 main + 12 agent worktrees)
$ du -sh .claude/worktrees           → 88M
```

Twelve worktrees, several holding branches whose work merged days ago
(`p2-team-expansion`, `revamp/phase-4-lab`, `revamp/phase-6-checks`, `revamp/phase-7-portfolio`).
Nothing reaped them. 88 MB for a repository containing **no application code at all** — only
Markdown and Node scripts.

**Extrapolation to the actual product.** An iOS project's worktree is a full checkout plus, once
`verify-done.sh` builds in it, its own `DerivedData` — commonly 1–3 GB per configuration. Ten
tickets across a sprint, with the failure paths never cleaned, is **tens of gigabytes** of orphaned
build output on the founder's machine, growing per sprint, with no gate that ever mentions it.

**Fix.** §3.B — a bounded slot pool makes the leak impossible rather than reaped, plus a
`worktree-reap` at step 0 that reports reclaimed bytes and refuses the round above a disk ceiling.

---

### OPS-007 · S2 · Conflict avoidance is opt-in on a field nothing requires

**Good news first, since it inverts an obvious criticism:** `contention-check.mjs` **is** wired.
`dispatch-preflight.mjs` composes it, with a comment explaining that a detector nobody calls is
FC-002 with extra steps. That finding is closed and does not need re-opening.

**The remaining hole.** `contention-check` can only see files a ticket *declared*, and declaring
them is conditional:

- `agents/tech-manager.md` §Ticket creation: *"**If** the ticket touches a named file, add `--file
  <path>`… A ticket with no `--file` is unaffected; risk stays unknown rather than defaulting to
  safe."*
- `dispatch-preflight.mjs`, by explicit design: *"Exit 2 (the ticket declares no files, so overlap
  is unknowable) is deliberately **NOT fatal** here… blocking them would make the studio unusable."*
- `--file` is **singular** in `dispatch-preflight`'s own signature. A ticket touching six files
  declares one, and contention is checked on that one.

So the **default** ticket — no `--file`, which is every ticket in §1's scenario — dispatches with no
contention protection whatsoever, and the printed word is `CANNOT EVALUATE`, which the founder will
correctly read as honest and which nonetheless lets both agents go.

**The stated fallback is a guess.** `parallel-orchestrator` step 2b: *"list the files each ticket is
**likely** to touch (from the impl spec and the ticket's own description)."* That is a prediction
made by the role that has never opened the code, about a codebase that may not exist yet. The
studio's own measurement of what happens when this prediction is wrong: *"two 'independent' tickets
in one module produced add/add conflicts on all 8 files."*

**Fix.** Make the file set derived rather than declared. `tech-lead` already writes the impl spec's
module map; a ticket's `--file` set should be generated from the spec section it names at
`/app-plan` time, and a ticket that resolves to no files should be **refused at creation**, not
waved through at dispatch. That converts a `CANNOT EVALUATE` at spawn time (too late, and unusable
to block on) into a refusal at planning time (early, and cheap to fix).

---

### OPS-008 · S2 · A merge conflict costs a full cold developer spawn, and the board has already recorded the merge

**Where.** `agents/tech-manager.md` §Merge gate step 4.

**What happens.** `git merge --abort`, then *"re-spawn the original developer with `BLOCKED: merge
conflict against $BASE on <files>; rebase your branch and re-submit`"*, then `blocked`, then
`unblocked` when the rebase lands.

**Two costs.**

1. **The rebase is done by a cold agent.** The "original developer" is a fresh spawn with no memory
   of the branch; it must rebuild the entire ticket's context — spec, impl spec, its own prior
   design decisions — to perform a mechanical rebase whose conflict hunks the manager is already
   holding. For a textual conflict (import ordering, two additions to the same list, a formatter
   difference) this is the single most expensive way available to resolve it.
2. **The board says `merged` and it is not.** The file itself acknowledges this: *"the `merged`
   event from step 3 cannot be retracted, so the honest record is 'we recorded a merge, it
   conflicted, the ticket is blocked on a rebase'."* Honest, and it means `merged` no longer means
   what every other reader of the log assumes. `scripts/merge-reconcile.mjs` exists precisely to
   detect this gap and is wired into `orchestrator round` and `ship-gate` — so the drift is caught,
   one round late, by a script whose existence is itself the admission.

**Fix.** §3.C gives conflicts an owner. The integrator holds the whole wave in one tree and resolves
textual conflicts itself under the existing rule (`git-pr-strategy` §6: read both sides and the
governing spec, never `ours`/`theirs` blindly). Only a conflict that changes behaviour or contract
becomes a re-ticket — which is what §6 already says should happen and what nothing currently
distinguishes.

---

### OPS-009 · S2 · Answers arrive one round after the code that needed them

**The mechanism, which is well designed in one direction.** An IC cannot block inside its own run
(`team-protocol` §Why ICs mostly won't message), so it declares `ASSUMED, NOT RAISED` and continues.
`app-build.md` step 1a converts those into `question` rows next round, and step 1b batches them to
`tech-lead` **before** the next wave spawns, explicitly so *"a guess becomes a decision before it
becomes code."*

**What it cannot reach.** The guess it is fixing was made on **last round's ticket**, and by the time
the answer exists that ticket has been reported DONE, verified, reviewed, approved and merged. Step
1b protects the *next* wave from inheriting the assumption. It does nothing for the ticket the
assumption is actually in. There is no link from an `answer` back to the ticket that assumed it — no
event, no `changes`, no re-open. The ticket's assumption is now merged code, and the answer is a
ledger row that agrees or disagrees with it silently.

**Measured, by this repo:** *"the live channel was used zero times [in ten agent-runs], so every
ambiguity was resolved by a guess and caught, if at all, in review."*

**Fix.** An `answer` that **contradicts** a recorded assumption on a merged ticket must produce a
board event — the cheapest correct one is a `qa_failed`-shaped re-entry or an auto-filed bug in the
unified register (§3.D), owned by the ticket's owner. The obligation model already requires an
answer to name an artifact; extend it: naming a ticket whose assumption it invalidates is an
artifact update like any other.

---

### OPS-010 · S2 · Review is the most expensive stage and the least batched

**Per ticket, in the §1 scenario:** one `code-reviewer` (`model: opus`), which may itself spawn up
to four Axiom auditors from its canonical table, plus a `design-qa` pass on any user-facing surface,
plus `verification-engineer` whenever the diff carries a constant or a rule. **Worst case: seven
agent spawns for one ticket's review.**

**What is duplicated.** Three reviewers of three tickets in the same module each read, cold:
`docs/22-impl-spec-ios.md`, `docs/21-engineering-principles.md`, `knowledge/failure-corpus.md` (and
run *every* class's Tell against their diff), `knowledge/ios-conventions.md` via `house-conventions`,
the auditor table, `docs/12-flows.md`, `docs/14-components.md`. That shared context is the majority
of a reviewer's input and it is rebuilt once per ticket.

**Why it is not obviously wrong.** Parallel reviewers are genuinely faster in wall-clock, and
independence between reviewers has real value — three reviewers who cannot see each other's findings
is a feature for correctness. This is a cost finding, not a correctness one, and it should be traded
deliberately rather than by default.

**Fix (proportional).** Batch by *module*, not by ticket: one reviewer per module per wave, given
all that module's branches, reading the shared context once and producing one verdict document per
ticket. Keeps the per-ticket verdict artifact (which `board.mjs --verdict` parses and must not
change), keeps independence across modules, and removes the duplication that has no reviewer-value
at all. Where a wave's tickets are all in different modules, this degrades exactly to today's
behaviour and costs nothing.

---

### OPS-011 · S2 · Retries escalate the model and reset the context

**Where.** `app-build.md` step 4 and `parallel-orchestrator` 6a: on `changes`, re-spawn the
developer one tier up, `haiku → sonnet → opus`.

**The gap.** The tier goes up; the context starts from zero. The re-spawned developer receives
`docs/53-reviews/APP-NNN-cycle-N.md` and the ticket, and must re-derive everything it knew — why it
chose the shape it chose, what it already tried, which parts of the spec it had reconciled. With a
6-retry spawn budget, one hard ticket is **seven independent cold context builds**, each more
expensive than the last because the tier is rising.

**The fix already exists in this repo and is not applied here.** `parallel-orchestrator` §Warm
managers describes exactly the right mechanism — a persistent named agent whose durable state is
still in files, so it is a cache and never a source — and scopes it to `tech-manager` and
`tech-lead` only. A developer being re-spawned on the same ticket is the *strongest* case for it:
the work is unfinished, the files are the record, and the retry is by definition the expensive path.

---

### OPS-012 · S3 · The standup can only report merged work, and its own template says otherwise

**The rule.** `ic-workflow` step 8 and `agent-isolation`'s artifact table: the daily fragment lives
in the worktree, is committed on the branch, and *"reaches `main` at merge; a fragment for unmerged
work should not appear in the standup."* This is deliberate and defensible.

**The contradiction.** `agents/tech-manager.md` §Standup builds `docs/daily/<today>.md` by *"reading
all `docs/daily/<today>-*.md` fragments"* — in the shared tree — and concatenating them under
**Shipped**, **In flight**, **Blockers**. A fragment for in-flight work is, by the rule above, not
in the shared tree. A fragment for blocked work never merges at all, so it is never in the shared
tree.

**So the two non-Shipped sections of the daily report are structurally unfillable from their stated
input.** They can only be filled by the manager writing them from its own context — which is exactly
the un-provenanced, compaction-fragile reporting the fragment mechanism exists to replace.

Worth reconsidering: the studio's conclusion that *"five of six dry-run agents skipped the daily
fragment"* is at least partly consistent with agents having written fragments that were on unmerged
branches and therefore invisible to the check that looked for them.

---

### OPS-013 · S3 · `verified_static` has no odometer

`verified_static` is the right mechanism and `ship-gate.sh` blocks on it correctly. But nothing
counts it. It appears in no standup line, no `round-journal` field, and no `orchestrator round`
output. A sprint can run to completion with most of its tickets never having had a test executed,
and the first thing that says so is the ship gate — at the point where the cost of hearing it is
highest.

**Fix.** One line in the round journal and one line in the standup: *"N of M tickets merged
`verified_static` — the executable suite has not run for: …"*.

---

### OPS-014 · S3 · Retry caps are per-ticket; there is no cross-ticket pattern detector

The 2-cycle review cap and the 6-retry spawn budget are per ticket. `round-journal.mjs check`
provides global ceilings (`--max-retries` and friends), which stops a runaway run — good, and it
means this is not S2.

What is missing is the diagnosis in between: three tickets failing review on the **same** finding is
a spec defect, and today each one independently burns its own retries against it before anything
correlates them. The verdict documents are on disk at a predictable path
(`docs/53-reviews/APP-NNN-cycle-N.md`) and the `changes` events are in the log, so the correlation
is cheap. Nothing does it.

---

## 3. The target design

Four changes. They are separable — B and C are the two that matter, and C depends on B.

### 3.A. Principle

**Correctness signals are per ticket. Cost is per wave.** Anything that answers a question about one
ticket's diff (does the branch exist, does it contain only its own files, does the review verdict
parse, does it satisfy its acceptance criteria) runs per ticket and is cheap because it is static.
Anything that requires a toolchain — compile, test, launch, journey, CI — runs **once per wave**, on
the merged tree, owned by one role.

### 3.B. Git strategy — bounded slot pool, shared caches, mandatory reaper

Keep everything the studio already got right: branch per ticket (`feat/APP-NNN-slug`), `--no-ff`
merges (required by `requireApprovalBinding`, per `devops-engineer`'s squash note), integration
branch declared in `docs/23-git-strategy.md` and resolved once per round, no self-approval, no
force-push, explicit-path staging, no repo-wide destructive commands.

**Change four things:**

1. **Worktrees are leased per owner-slot, not created per ticket.** A fixed pool
   `.agent-wt/slot-1 … slot-N`, N = the round's parallelism cap (default 3). A slot is leased to one
   owner for the round; the owner works its tickets **sequentially inside it**, cutting a branch per
   ticket and committing between. Disk is bounded by parallelism, not by backlog. Resolves OPS-005
   in favour of the batching `parallel-orchestrator` already wants, and bounds OPS-006 structurally.
   `spawn-gate.sh` checks *leases*, not `.agent-wt/<ticket>`.

2. **Build caches live outside the worktrees and are shared.** `.studio-cache/DerivedData`,
   `.studio-cache/gradle`, exported into every test and build invocation. One env block. This is the
   single largest infra saving available and it is independent of everything else here — it is worth
   doing even if nothing else in this document is adopted.

3. **A reaper at step 0 of every round.** Removes any slot whose lease has no live ticket, prunes,
   and prints reclaimed bytes. Adds `--max-disk` to the round ceilings so an over-budget round
   refuses like any other ceiling rather than silently filling the disk.

4. **No agent pushes anything but its own feature branch.** The integration branch is pushed by one
   role, once per wave. Enforceable today in the capability manifest that `dispatch-preflight`
   already consults.

### 3.C. The integrator — one role compiles, runs, and attributes

This is the founder's model, made concrete. `tech-manager` gains an explicit **integration pass** at
the end of each wave (or a dedicated `integrator` role if the manager's context proves too loaded —
`manager-harness.mjs` and `manager-failover.mjs` already exist for exactly that question).

**Per ticket — static only, no toolchain, no build:**

- branch exists, has commits, changes files (today's `verify-done.sh` checks 1–4, unchanged)
- diff contains only this ticket's declared paths
- review verdict parses and its three lines are present (today's `--verdict` contract, unchanged)
- contention against everything already merged this wave

Rename the outcome honestly: this is `verified_static` by default, and the current `verified` is
only reachable through the wave build below. That is not a downgrade — it is what the loop has
actually been proving per ticket all along, since a green branch build says nothing about the merged
tree.

*Exception worth keeping:* where the toolchain supports genuinely scoped tests
(`./gradlew :module:test`, `swift test --filter`) **against a warm shared cache**, the `fast` scope
stays per-ticket. That is what F6's `fast` was for, and with 3.B.2 in place it costs seconds instead
of a cold compile.

**Per wave — once, by the integrator, in one slot:**

1. Merge every approved branch into `integration/wave-<n>`, `--no-ff`, in approval order.
2. Resolve **textual** conflicts directly (`git-pr-strategy` §6 rules apply). A conflict that changes
   behaviour or contract is escalated to the contract's owner and re-ticketed — that distinction is
   already written down and currently has nobody to make it.
3. Run **one** full build + **one** full suite + **one** `runtime-gate.sh` + **one**
   `journey-gate.mjs`.
4. **Attribute failures to tickets** using the changed-file map the wave already has, file them into
   the register (§3.D), and re-assign only the owning developers. Passing tickets stay merged on the
   wave branch — they are not re-worked because a sibling failed.
5. Fast-forward `$BASE` to the wave branch and **push once**.
6. The next round's step 0 reads the previous wave's CI conclusion
   (`gh run list --branch "$BASE" --limit 1 --json conclusion`) and **refuses to start on red**.

That last line is the whole of OPS-001's fix, and it costs one command. It gives CI teeth without any
agent ever waiting on a workflow, running one, or being able to trigger one.

**Batching policy, stated once so it stops being re-derived per file:**

| Runs | Per ticket | Per wave | Per sprint | Per ship |
|---|---|---|---|---|
| static verification (branch/commits/files/scope) | ✅ | | | |
| scoped module tests (warm cache only) | ✅ | | | |
| code review + verdict | ✅ | | | |
| full build + full suite | | ✅ | | |
| runtime gate | | ✅ | | |
| journey gate | | ✅ | | |
| CI (one push) | | ✅ | | |
| QA pass | | ✅ | | |
| mutation catalogue | | | ✅ | |
| security + release audit | | | | ✅ |

### 3.D. One register

`docs/90-register.jsonl` + generated `docs/90-register.md`, one CLI (`register.mjs`), kinds:
`ticket | bug | finding | risk | assumption | incident`. Every item carries: id, kind, **status that
is never blank**, owner, raised-by, links (`ticket:APP-004`, `bug:BUG-012`, `finding:AUD-031`),
evidence path.

The board stays the **state machine for tickets** and does not change. The register is the **index of
everything the studio owes**, and a ticket is one kind of item in it. The rule that makes it worth
building — and the rule neither `51-bugs.md` nor `81-findings.md` has ever had:

> **Sprint close and `/app-ship` refuse while any register item lacks a terminal status.**

That single rule is what would have caught the ~70 silently skipped findings, and it is what
`app-build.md` step 8 currently tries to do for tickets only ("a ticket that exists must never be
absent from the summary") while every bug and finding sits outside its reach.

**Lazy first slice, and the one worth shipping alone:** do not migrate all eleven. Registers 4–11
already have logs, CLIs and validators; they are fine. Build `register.mjs` around **bugs and
findings only** — the two with no machine and the two that drive every re-work path — and wire the
sprint-close refusal. Everything else can fold in later, or never.

**Fixes en route:** `qa-engineer` appends to the register via the CLI in the **shared tree**
(append-only JSONL, uniquely-keyed — safe under `agent-isolation`'s own collision test), which
removes OPS-004's one-merge-behind defect without weakening branch discipline for its documents.

---

## 4. Future conflicts these changes create

Stated up front, because a redesign that lists no new risks has not been thought through.

1. **Wave integration widens the `merged`-vs-actually-merged gap.** Today `board.mjs move merged` is
   the gate and the git merge follows within seconds. Under wave integration, the gate fires per
   ticket and the merge happens at wave end — minutes to hours later, and possibly not at all if the
   wave build fails. `merge-reconcile.mjs` already exists and is already wired into
   `orchestrator round` and `ship-gate`; it must now run at **wave end**, not just at round start.
   Cleaner alternative: add an `integrated` event distinct from `merged`, so the log says which of
   the two happened. That is a schema change and needs `board-doctor` and `foundation-conformance`
   updated with it — do not do it casually.

2. **`requireApprovalBinding` under a wave branch.** `approval-check.mjs` proves the approved SHA is
   still an ancestor. Merging `feat/APP-001` into `integration/wave-1` and then fast-forwarding
   `$BASE` preserves ancestry under `--no-ff`, so binding holds. **Any squash anywhere in that chain
   breaks it** — already documented in `devops-engineer` for the single-merge case, and the wave
   branch adds a second place to get it wrong. It needs saying explicitly in
   `docs/23-git-strategy.md`.

3. **Later feedback per defect.** Static-only per-ticket verification means a failing test surfaces
   at wave end rather than at the ticket's own DONE. That is a real regression in feedback latency,
   traded for a large reduction in cost. Mitigation is the scoped-`fast`-on-warm-cache exception in
   3.C; if a project's toolchain cannot scope tests, the trade is unmitigated and should be a
   per-project decision recorded in `project-profile.json`, not a global default.

4. **The integrator is a context hog and a single point of failure.** It holds the whole wave.
   Mitigation is the rule already stated for warm managers: it holds **files**, not context — the
   register, the log, the wave branch — so `manager-failover.mjs` can replace it cold. That
   constraint must be enforced, not assumed, or the integrator becomes the one place where state
   lives only in an agent's head.

5. **Slot leasing changes what `spawn-gate.sh` means.** It currently answers "does
   `.agent-wt/<ticket>` exist". It must answer "does this owner hold a lease". The existing
   assertions in `scripts/test.sh` around spawn-gate will need rewriting, and per the studio's own
   mutation rule a new gate needs a mutation proving it can fail.

6. **Refusing a round on red CI can deadlock the loop.** If CI is red for an environmental reason
   (a runner outage, an expired secret), the studio stops entirely. It needs the same
   three-way split every other gate here has — `PASS` / `FAIL` / `CANNOT EVALUATE` — where an
   unreachable `gh` is a loud 2, not a red 1, and an operator waiver exists that is recorded rather
   than assumed.

7. **Batched module review reduces reviewer independence.** One reviewer seeing three branches in a
   module can carry a finding across them — which is the point — and can also carry a *mistake*
   across them. Where correctness matters more than cost (billing, migrations, auth — the paths
   `risk-router.mjs` already classifies `high`/`critical`), keep one reviewer per ticket.

---

## 5. What to do next, in order, with a falsifiable check on each

The studio's own most valuable lesson, from `docs/RESUME.md`: *"Three experiments with one
falsifiable question each, a stopping condition, and no agents produced four fixes and a killed
hypothesis in fifteen minutes."* Everything above is a hypothesis until run. Run these **before**
building any of §3 — they are minutes each, and any of them coming back FALSIFIED removes work.

| # | Question | How | Predicted |
|---|---|---|---|
| **E1** | Do two tickets with no `--file` both dispatch onto the same file? | Create two tickets without `--file`, run `dispatch-preflight` on both | **CLEAR twice** → OPS-007 holds |
| **E2** | Does anything refuse a merge while `$BASE`'s CI is red? | Push a red commit to a fixture's integration branch, run the merge gate | **Nothing refuses** → OPS-001 holds |
| **E3** | Does a rejected ticket's worktree survive to sprint exit? | Drive one ticket to `rejected`, then to sprint exit; `git worktree list` | **It survives** → OPS-006 holds |
| **E4** | Does a bug on an unmerged QA branch produce a `BUG-NNN-fix` ticket? | Write a row to `51-bugs.md` on a branch, run `/app-build` step 1 against the shared tree | **No ticket** → OPS-004 holds |
| **E5** | What does one owner with three tickets actually receive? | Run `parallel-orchestrator` steps 2–3 by hand for one owner, three tickets | **One prompt, three worktrees, one cwd** → OPS-005 holds |
| **E6** | What does a wave cost? | Instrument one 3-ticket wave: CLI calls, spawns, cold builds, wall clock, MB of `.agent-wt` | §1's counts, ±20% |

**Then, in cost-benefit order:**

1. **Shared build caches** (3.B.2) — hours of work, largest single saving, breaks nothing, needs no
   other change. Do this first regardless of what happens to the rest.
2. **One push and one CI run per wave** + **read CI at step 0** (3.C.6) — closes OPS-001 and OPS-002
   together, and is roughly two commands.
3. **The reaper and the disk ceiling** (3.B.3) — closes OPS-006 without waiting for slot leasing.
4. **`register.mjs` over bugs + findings, with the sprint-close refusal** (3.D) — closes OPS-004,
   the highest-severity *silent* failure here.
5. **Slot leasing** (3.B.1) — closes OPS-005 and OPS-006 structurally; the largest change, and the
   one to do after E5 has shown exactly what breaks.
6. **The integration pass** (3.C) — the biggest win and the biggest risk; it depends on 5 and should
   follow it.

---

## 6. Not checked

Stated because an unstated gap reads as a cleared one.

- **`/app-ship` and the release path** — out of scope here, and per `RESUME.md` it has never run
  against a real submission. Nothing in this document touches it.
- **`control-room/`, `portfolio.mjs`, `studio-dashboard.mjs`** — the reporting surfaces. Not read.
  The reporting findings above (OPS-012, OPS-013) are about the standup and the round journal only.
- **The 1240-assertion suite** — not run, not audited. No claim here about whether the mechanisms
  described in the prose files behave as their prose says, **except** where I read the script
  (`verify-done.sh`, `spawn-gate.sh`, `dispatch-preflight.mjs`, `contention-check.mjs`).
- **Nothing here was executed.** Every finding is derived from reading files and from two shell
  commands (`git worktree list`, `du -sh .claude/worktrees`). §5's experiments exist because that is
  precisely the weakness this studio has already measured in its own six dry runs — the reports whose
  findings read well and were never run.
- **Cost figures are counts of invocations and builds, not tokens or dollars.** The harness does not
  report spend here (`round-journal`'s `--spend-usd` is `null` for the same reason), so no monetary
  claim is made.
