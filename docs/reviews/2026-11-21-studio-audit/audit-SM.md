SM-1 [High] One deliberately blocked ticket stops every build round once 10 other board events have happened
**Where** scripts/orchestrator.mjs:304-345 (`TERMINAL = {'done'}`, and `movement()` never skips `blocked`), :560-567 (stalled + all other checks clear → exit 1)
**What happens** Scratch repo `$TMPDIR/studio-audit-sm-strand`. I added AUDIT-001, then `move AUDIT-001 blocked --detail "needs-approval: risky"` (this is how `/app-run --yolo` defers Risky work, app-run.md:83). I took an unrelated APP-006 through claim → review → changes → review, which is 11 events. `orchestrator.mjs round` then printed `STALLED AUDIT-001 [blocked] — 11 board events…` and `RESULT: BLOCKED — … do not run another round around it`, with exit 1. The remedy it prints ("claim it, block it with a reason, or close it") cannot be followed: the ticket is already blocked, and blocked tickets can only be `unblocked` or `reopened` (events.mjs:147-148). A ticket at the review cap waiting on the founder, a `BLOCKED:` return, and an APP ticket sitting in `qa` after `qa_failed` while its BUG-fix runs all hit the same trip. The BUG-fix's events do not reset the clock, because `mine` only covers the ticket's own deps.
**Why it matters** Any normal blocked ticket halts all independent work in an unattended run. app-build step 0 forbids spawning on exit 1, so only a human can restart it.
**Fix** Skip `blocked` tickets in `movement()`. Also skip a `qa` ticket that has a `qa_failed` and an open dependent. `stranded` and the standup already report blocked tickets.

SM-2 [High] A ticket the team decides not to do has no exit, so the run can never ship
**Where** scripts/lib/events.mjs:33-60 (no cancel/descope event), :147-148, scripts/lib/board.mjs:78 (`IN_FLIGHT_STATUS` includes `blocked`), scripts/ship-gate.sh:307-313
**What happens** In the same repo, `ship-inflight.mjs docs/31-board.md` lists `AUDIT-001(blocked)` and `APP-005(blocked)`, and ship-gate refuses on "tickets still in flight". Risky audit items that `--yolo` marks "DEFERRED", P1s cut at scope-lock, a superseded or split ticket, and a review-capped ticket the founder chooses not to reopen all stay `blocked` forever. They also feed SM-1. The register has DEFERRED/WONTFIX; the board has nothing equivalent.
**Why it matters** A real team de-scopes all the time. Here that leaves only two options, both bad: do work nobody approved, or never pass the ship gate.
**Fix** Add one `descoped` event. It is tech-manager only, needs `--detail`, is legal from `todo` and `blocked`, and leads to a terminal status that is excluded from IN_FLIGHT, from stall detection and from `stranded`. Its dependents become `stranded` again so they get re-planned.

SM-3 [High] Budget ceilings count over the whole project and never reset, so one realistic sprint uses them up
**Where** scripts/round-journal.mjs:49 (`rounds 12, spawns 60, agentSpawns 20`), :270-284 (totals over the whole `docs/33-rounds.jsonl`); app-plan.md has no reset step
**What happens** I journaled 7 rounds at 3 ios-developer and 3 code-reviewer spawns each. `round-journal.mjs check` returned `BUDGET: CEILING REACHED — agent ios-developer 21 / 20 · agent code-reviewer 21 / 20` with exit 1. app-run step 4 pairs every P0 with an `-analytics` ticket, so 10 P0 features means 20 or more tickets. Each one gets at least one code-reviewer spawn, plus design-qa spawns. Sprint 1 cannot finish under the default, and sprint 2 starts already blocked. Raising a ceiling is explicitly the user's call (app-run.md:113).
**Why it matters** A normal-sized app stalls for a human mid-sprint, and the stop is caused by a default, not by runaway cost.
**Fix** Scope the check to the current sprint: add a `--sprint` field on `append` and have `check` sum only that sprint. Or derive the defaults from the ticket count, roughly 4 spawns per ticket. Also enforce the per-ticket retry limit (SM-5), which is the brake that actually matches the failure.

SM-4 [High] A `qa_failed` after `qa_passed` does not revoke the pass, so the ticket can still be closed
**Where** scripts/lib/events.mjs:529-531 (reducer leaves `qaPassed` untouched), :138 (with `qaPassed` set, `closed` is legal and `rework` is not)
**What happens** I fed created → … → merged → `qa_passed` → `qa_failed "BUG-009 S1 crash"` into the real `reduce`/`validate`. Result: `status qa qaPassed true qaFailures 1`, `closed -> {"ok":true}`, and `rework -> not legal`. app-build.md:457 schedules exactly this sequence: verdicts first, then land the QA ticket, re-run the journey gate, then close. A regression found on that re-run, or by the next wave's QA, does not stop `closed`.
**Why it matters** A ticket with a recorded S1 failure gets marked done and ships.
**Fix** One line in the reducer: `case 'qa_failed': state.qaPassed = false; state.qaFailures += 1;`. Closing then needs a fresh `qa_passed`.

SM-5 [Medium] The wave-fail rework loop and the verify-reject loop have no per-ticket bound
**Where** scripts/lib/events.mjs:512-515 (`rework` does not increment `cycles`), :804-811; app-build.md:532 ("at most 6 developer retries per ticket" exists only as prose, with nothing in scripts implementing it)
**What happens** A probe looped done_reported → verified_static → review_requested → approved → merged → `rework "wave i: FAIL"` 10 times. All 10 were accepted, and `cycles` stayed at 0. `--retry`'s model escalation applies only after `changes`, so a ticket that keeps failing its wave is retried at the same model tier forever. Only the project-wide retries total of 30 stops it.
**Why it matters** One broken ticket can consume the whole run's budget (SM-3), and a spec problem never gets escalated.
**Fix** Count `rework` and `rejected` in a per-ticket counter, checked in `validateTransition`. Past 6, force `blocked` the same way the `changes` cap does at :814-821, and route it to tech-lead.

SM-6 [Medium] If a developer agent dies, its `in_progress` ticket is left orphaned and the loop does not see it
**Where** commands/app-build.md:510 (the loop ends when there are no ready `todo` rows "and nothing in `review`/`qa`"; `in_progress` is ignored); parallel-orchestrator SKILL.md:18 (ready means `todo` only); scripts/orchestrator.mjs:345-387 (`run-doctor` is not among the round checks); `run-doctor` is wired only into app-recover.md:26
**What happens** I claimed APP-007 and then ran nothing. `orchestrator explain APP-007` lists `done_reported`/`blocked`/`assigned` but never says that no agent holds the ticket. `status` counts it as "with a legal next transition". After a crash or compaction, the loop exits at step 7 and the ticket only appears in the step-8 summary.
**Why it matters** A silent drop that needs a human to run `/app-recover`.
**Fix** Add `run-doctor` to the `round` steps. It should report an expired lease on an `in_progress` ticket as `RESPAWN <owner> <ID>`. Add `in_progress` to the step-7 condition.

SM-7 [Medium] Nothing in the loop ever unblocks a ticket, and one blocked dependency stops the whole round
**Where** commands/app-build.md (the only `unblocked` mention is the table at :55); scripts/board-doctor.mjs (`stranded` is a blocking anomaly)
**What happens** I blocked AUDIT-001, which has a dependent APP-005. The next `round` returned `BLOCKED board doctor`, with `APP-005 stranded … Refusing to spawn`, even though APP-006 was ready and independent. The orchestrator has to block each dependent by hand, even though the CLI already printed the cascade. Later, when tech-lead answers the blocking question in step 1b, no step appends `unblocked` to the blocker or to its dependents.
**Why it matters** Every `BLOCKED:` return costs a manual repair step, and the tickets stay blocked even after the cause is fixed, which then feeds SM-1 and SM-2.
**Fix** Have `stranded` downgrade to a warning when the dependency is `blocked` (the CLI cascade has already reported it). In step 1b, append `unblocked` for every ticket whose blocking question now has an `answer` row.

SM-8 [Medium] The autonomous run covers exactly one sprint: it never chooses sprint scope, never re-plans, and never measures velocity
**Where** commands/app-run.md:86-100 and :141 (step 5 goes straight from "board drained" to ship); skills/sprint-planner/SKILL.md:12-16 (capacity hard-coded at "default 3", no rule for which backlog items join the sprint, never reads `deriveMetrics` or the round journal); scripts/lib/events.mjs (no sprint field on events); agents/tech-manager.md:213 ("say the sprint is done and ask what's next")
**What happens** `/app-plan` either puts the whole backlog on one board, which is not a sprint, or plans a subset that `/app-run` then ships without. S3/S4 bugs marked "queued to sprint N+1" never get a sprint N+1. `deriveMetrics` (cycle time, pass rate) is printed and never consumed.
**Why it matters** The velocity and carry-over loop a real team depends on is missing, so the plan never improves from one sprint to the next.
**Fix** sprint-planner should take P0 items first, sized by the last sprint's tickets-per-round from `deriveMetrics`. Tickets should carry `--sprint`. app-run step 5 should loop back to step 3 while P0 or approved backlog rows remain. This also scopes SM-3.

SM-9 [Low] Three ceremonies are rituals with no effect: the sprint goal, the Definition of Done, and the retro
**Where** skills/sprint-planner/SKILL.md:138-158 (the DoD goes "at the top of the board", but the board is generated: events.mjs:894-901 renders no DoD, and any hand edit is overwritten); the same DoD says "`fast` per ticket, `full` at merge", which contradicts app-build.md:216-219 (static per ticket, full suite per wave); app-build.md:512-515 (the exit check never compares the result to the goal printed at app-plan.md:137); retros happen only at `/app-ship` (app-learn.md:113)
**Why it matters** These cost tokens every sprint and influence nothing. The DoD as written points agents at the wrong verification lane.
**Fix** Delete the DoD block and point to app-build's verification table. Add one line to step 8: "Sprint goal: MET / NOT MET — <why>". Harvest `LEARNING:` lines at step 8 instead of only at ship.

SM-10 [Low] The procedure docs contradict each other on S1 handling and on prompt batching
**Where** agents/tech-manager.md:202-204 vs commands/app-build.md:117-118; skills/sprint-planner/SKILL.md:236-239 vs parallel-orchestrator SKILL.md:37
**What happens** On an open S1 against a P0, tech-manager says to "block the round … start no new feature work until it closes", while app-build cuts a `BUG-NNN-fix` and keeps going. The planner's handoff format shows "ios-developer ← APP-001, APP-004" in one line, while parallel-orchestrator says to never batch an owner's tickets into one prompt.
**Fix** Keep app-build's S1 behaviour and delete the tech-manager line. Change the handoff format to one line per ticket.

**Top 3 blockers to an autonomous end-to-end ship**
1. SM-1 + SM-7: one ordinary blocked ticket stops every round through the stall detector or the `stranded` anomaly.
2. SM-2: de-scoped or deferred work has no terminal state, so ship-gate refuses forever.
3. SM-3: lifetime budget defaults (20 spawns per role) are exhausted within a single normal-sized sprint.

**Checked and found fine**
- The review-cycle cap is enforced at write time and converted to `blocked`. `reopened` adds exactly one extra cycle.
- `claimed` refuses a dependent until its dependency is merged and its wave has landed, including after a `rework` of the dependency.
- `verified_static` correctly allows review and merge but refuses `closed`.
- Every refusal names the legal next events, and `orchestrator explain` uses the same validator as the CLI.
- The kill switch is honoured by both `round-journal check` and `spawn-gate`.
- WIP is capped through the scheduler and the slot leases. One slot per ticket holds.
- A stalled board, as opposed to a single blocked ticket, is caught as intended. The flaw is only the blocked-ticket case in SM-1.

Scratch repos are `$TMPDIR/studio-audit-sm`, `$TMPDIR/studio-audit-sm-stall` and `$TMPDIR/studio-audit-sm-strand`. The two reducer probes are `$TMPDIR/sm-probe.mjs` (SM-4) and `$TMPDIR/sm-probe2.mjs` (SM-5).
