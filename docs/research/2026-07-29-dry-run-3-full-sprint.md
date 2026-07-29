# Dry run 3: a full sprint, through review and merge

**Date:** 2026-07-29
**Method:** A three-ticket sprint driven end to end by a human-in-the-loop orchestrator following
`/app-build` literally — board-doctor gate, worktree per agent, `verify-done` before believing any
`DONE`, code review, merge gate. Designed so the v1.3.0 rules would be *exercised* rather than
avoided: a serialized foundation ticket (`APP-010`) owning the cross-cutting concerns, then two
file-disjoint features behind it (`APP-011` add, `APP-012` export), with a deliberate spec ambiguity
planted in `APP-012`.

**Headline:** the review and merge gates work. All three tickets went build → review → merge and are
on `main`. Driving them surfaced **ten** defects — in the tooling, in the process rules, in the
prompts, one a self-contradiction between two rules shipped in the same release, and one an agent
sincerely reporting work it had not done.

---

## Round 1: `APP-010`, the foundation ticket

Full path completed: **build → verify-done → REQUEST CHANGES → fix → APPROVED → merge → qa.**

### The review gate is not a rubber stamp

Two blocking items, both real:

1. **A lost-update race on shared mutable state.**
   `_todos.value = listOf(todo) + _todos.value` and the equivalent in `setCompleted` — non-atomic
   read-then-write on a `MutableStateFlow` explicitly documented as "the single source of truth" for
   a repository *two more features were about to inject*. The reviewer's framing was precise:
   `.update {}` is a CAS-retry primitive, so the fix "closes the race by construction, not just by
   convention — it doesn't depend on callers being disciplined about single-threaded access."

2. **A kdoc asserting a contract the code did not implement.**
   `Todo.kt` claimed `[id]` was caller-supplied; `TodoRepository.add(text)` takes no id and the
   repository generates it. As the reviewer put it: *"This is the foundation doc APP-011/APP-012
   will read to understand the contract — as written it tells the next two developers something
   false about how `add` works."*

Both are the kind of defect that is cheap now and expensive after two features depend on it.

### The reviewer's own discipline held

- **It verified the diff, not the report:** *"Diff verified directly with
  `git diff 1fae419..feat/APP-010-core-todo-store` — not taken on the developer's word."*
- **It refused a false green:** asked to justify approving an atomicity fix with no new test, it
  reasoned that a race-proving test needs artificial interleaving and would be a flakiness risk
  disproportionate to an S ticket — then added, on the mandatory rules line: *"no new lint/CI rule
  was added this cycle… it does not exist yet, so I'm not claiming a false green here."*
- **It escalated instead of guessing.** Hitting the append-only ledger wall: *"Since I can't edit or
  delete a past ledger line myself, this needs your call on how to reconcile — flagging rather than
  guessing."* It also classified both the bad ledger line and the cycle-count mismatch as
  tech-manager items, "not in my remit to edit."

That last behaviour is what exposed finding 2 below.

---

## Findings 1–6: round 1

### 1. A drifted ledger word silently erased a REQUEST CHANGES

The reviewer appended `changes-requested` instead of the canonical `changes`. `parseLedger` filtered
the row out, so the verdict vanished from every mechanical check, the ledger-derived cycle count
stayed at 0, and `board-doctor` reported the **milder** `review_never_started` — actively
misdirecting away from a rejection that had really happened.

Same silent-drop class as a stranded ticket, this time **inside the parser**: it quietly ignored what
it did not understand and reported something softer.

**Fix:** unknown actions are no longer dropped; `ledger_action_unknown` blocks. The legal vocabulary
is printed in the ledger template header the writer sees, and `code-reviewer` names the exact words.

### 2. Fixing (1) immediately created a worse bug

A strict parser over an **append-only** log has no repair path — one typo blocks the board forever,
because the bad line can never be deleted. The reviewer hit this within minutes and correctly
refused to work around it.

**Fix:** a later valid entry for the same ticket counts as the correction, dropping the bad row to
`ledger_action_unknown_superseded` — visible, because the mistake is part of the record, but
non-blocking. An *uncorrected* bad word still blocks. Both directions tested.

### 3. Review verdicts had no home — and the orchestrator hit it

`code-reviewer` wrote its verdict only into its return message. That message went missing in transit,
so as orchestrator I could not re-spawn the developer at all. `/app-build`'s rule "re-spawn the
developer with the reviewer's blocking notes" assumes the orchestrator still holds them in context;
the 2-cycle cap promises to surface "the full reviewer + developer history", which cannot exist if
every verdict lived in a message.

**Fix:** verdicts persist to `docs/53-reviews/APP-NNN-cycle-N.md` before the reviewer returns, and
`/app-build` re-spawns the developer *pointed at that file*, refusing to proceed if it is missing.

Same durability lesson as the daily fragment: **the artifact the process depends on must be on disk,
not in a conversation.** It surfaced only because a message genuinely went missing — it was not
reachable by reasoning.

### 4. The daily fragment is skipped ~85% of the time

Five of six agent-runs never wrote one, though every IC role requires it and it is the *only* input
`tech-manager` has for the standup. At that rate it is a design problem, not an agent problem: the
instruction sat as step 8 of a long list, **after** the commit step, so agents finish at the commit
and report.

**Fix:** it is now a required field in the output contract — something an agent must fill, not a step
it can run past — with the reason stated. `/app-build` refuses to move a row to `review` without it.

### 5. The isolation rule contradicted the artifact conventions

`agent-isolation` said "never leave your worktree". The daily-fragment and review-verdict conventions
both write into shared `docs/`. Both shipped in the same release, and an agent resolved the ambiguity
by writing its fragment to the repo root — so a fragment describing *unmerged* work landed on `main`.

Forbidding all shared writes was not the answer: that would push review verdicts back into ephemeral
messages, which is exactly what finding 3 just fixed.

**Fix — reframed around the real hazard, collision rather than location.** A shared write is safe when
no other agent can write that same path:

| Artifact | Where | Why |
|---|---|---|
| source and tests | worktree only | two agents on one file is the corruption case |
| `docs/daily/<date>-<role>-<id>.md` | worktree, committed on the branch | reaches `main` at merge; unmerged work should not appear in the standup |
| `docs/53-reviews/<id>-cycle-N.md` | shared — safe | unique per (ticket, cycle), and must outlive a rejected branch |
| board, message ledger | shared — append-only | appends from different agents merge cleanly |

### 6. A dependency blocked its dependents until QA, not until merge

`/app-build` treated a dependency as satisfied only at `done`. `APP-010` merged cleanly to `main` and
both features depending on it stayed `todo` — **the sprint had nothing to run** while one QA pass
completed, despite the code already being on the integration branch.

**Fix:** readiness is `qa` **or** `done`. QA failures already re-enter as `BUG-NNN-fix` tickets, so
gating dependents a second time buys nothing and serializes the board behind its slowest stage.

---

## Method note: my own checks failed twice, both "always reports done"

Two throwaway wait-conditions I wrote during this run were broken:

- one matched the *developer's commit* instead of a reviewer verdict;
- one compared `git rev-parse` output (a full SHA) against an abbreviated `1fae419` — always
  unequal, so it reported "fix committed" instantly while nothing had happened.

Both failed in the **success** direction. Written by the same session that was authoring the rules
against exactly this. Ten seconds of running each against a known-not-ready state would have caught
both — which is the argument for applying "watch it fail once" to throwaway checks, not only to
shipped rules.

This is the fourth instance in the programme of the checking tool carrying the defect it checks for.
It is not coincidence; it is the default.

---

## Round 2: two parallel features behind the merged foundation

`APP-011` (add) and `APP-012` (export) — the same *shape* of pairing that produced total corruption
in run 1 and a 7-of-10-file conflict in run 2, now run behind a serialized foundation ticket with
file-disjoint scopes.

| Fix being tested | Run 2 | Run 3 |
|---|---|---|
| Foundation ticket owns cross-cutting concerns | two incompatible analytics layers | **0** `core/` files touched, **0** duplicate abstractions |
| Parallelism judged on files | conflicts on **7 of 10** files | **0 conflicts** |
| Daily fragment as a contract field | 1 of 6 agent-runs | **2 of 2** |

Both approved on the first review cycle and merged clean. All three tickets are on `main`.

### Finding 7: an agent reported work it had not done

`APP-012` was given a deliberate spec ambiguity — the AC never says what exporting an *empty* list
produces. The agent reasoned well, chose an empty string over invented placeholder copy, and wrote
in its **daily fragment**:

> "Raised to tech-lead on the team channel per the ticket instructions — implementation proceeds
> under this assumption pending their answer."

No message existed. `docs/team/messages.md` had never been created; two independent searches
confirmed it. The claim was sincere and false, in the artifact `tech-manager` folds into the
standup — where it would have read as a question awaiting an answer nobody had asked.

`verify-done.sh` checks branch, commits, files, test exit code. **Nothing checked a claim about a
non-code artifact.** Every "second-path check", "shared surfaces touched" and "daily fragment" line
added in this programme was unverified self-report.

**Fix:** `Assumptions & open questions` is a contract field requiring the pasted ledger row or an
explicit `ASSUMED, NOT RAISED`; `/app-build` verifies it against the ledger, files any missing
message itself, and treats the rest of that report as suspect.

The reviewer got the calibration exactly right without being told how:

> "I'm not extending it any benefit of the doubt: every claim above was checked directly against the
> diff and the actual `core/` source… The false claim doesn't change the correctness of the shipped
> code, but it's a trust issue with the developer, not the code — it shouldn't block this ticket's
> merge, but a repeat would be a different conversation."

That is now written into `code-reviewer`: re-verify rather than extend trust, approve the code if the
code is sound, and raise the reporting problem separately.

### Finding 8: the message channel is unused in 10 of 10 runs — structurally

Zero uses across three dry runs. Including the one above, where the agent held the exact command,
decided it *should* ask, and believed it had.

That is not discipline. **An agent that can proceed will proceed.** It cannot block for an answer
inside its own run, so it must decide anyway; sending the message costs a step and buys nothing
before it finishes.

**Fix — split the protocol by role rather than exhort harder.** ICs *declare* assumptions in their
output contract; the orchestrator *routes* them into real ledger rows. The live channel keeps its
one genuine use: a question you can park while working on another part of the same ticket.

### Finding 9: implemented, tested, and dead

The `APP-011` reviewer, unprompted:

> "no composition root exists yet to wire a real (consent-gated) `AnalyticsLogger` into
> `AddViewModel` — **`todo_added` will never fire for real** despite being fully
> implemented/tested here."

A feature that is written, gated, covered by passing tests and never constructed anywhere is dead
code that passes review. `code-reviewer` now has an explicit "is it wired, or merely written?" check.

### Finding 10: reviewers were being told to diff wrongly

The same reviewer noticed that a two-dot `git diff main..branch` renders everything that merged into
`main` while the ticket was in flight as *deletions on the branch* — making a clean ticket look like
it reverted half the repo. It re-diffed against the branch's real parent and said so.

`code-reviewer` now specifies the three-dot merge-base form. (`verify-done.sh` was already correct.)

## What is now proven, and what is not

**Proven end to end:** the board-doctor gate, worktree isolation, `verify-done` (including inside a
worktree), the review gate catching real defects, the review→fix→re-review cycle, and the merge gate
with its non-owner-approval precondition.

**Proven in round 2:** parallel feature development against a merged foundation — no duplication, no
conflicts, both approved first cycle and merged clean; the full board lifecycle `todo → in_progress
→ review → qa` with an append-only ledger that survived a vocabulary error, a supersede, and three
merges; worktree create/clean across two rounds.

**Not proven, and now understood rather than merely missing:** the live message channel. 10 of 10
non-use is a structural result, not a gap in coverage — see finding 8. The declare-and-route design
replaces it for ICs and has had exactly one trial.

**Never exercised:** QA as a stage, and the bug loop back into the board. Every ticket ended at `qa`;
nothing has yet run `qa-engineer`, filed a `BUG-NNN`, or watched a bug re-enter the sprint.
