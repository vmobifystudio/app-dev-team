# Targeted experiment — why do tickets die at `merged` and `qa_passed`?

**Committed before the run.** One hypothesis, one stopping condition, no agents.

## The question

Of 19 tickets across every recorded run: 4 ended at `merged`, 2 at `qa_passed`, 1 reached `closed`.
Six tickets got their code integrated and then stopped.

The two previous experiments both found the same shape — FC-005, a consumer with no producer. H1
found the pipeline completable when driven by hand; H2 found the loop could not start because four
manifests had no writer.

## Hypothesis

**H3: the transitions out of `merged` require artifacts that no step in the pipeline reliably
produces — so a ticket whose code is integrated cannot be closed, for the same reason a planned
ticket could not be claimed.**

Specifically: `qa_passed` needs a QA pass recorded against a test plan, and `closed` needs a real
`verified` (not `verified_static`). If either input has no writer, the ticket parks.

## Method

Take a ticket to `merged` in a scratch project, then attempt each remaining transition exactly as
the documented path prescribes. Record the first thing that cannot be satisfied and who was
supposed to produce it.

## Stopping condition

The first refusal whose remedy is not produced by a documented earlier step.

## Result

Recorded below after the run, whatever it says.

---

## Result — H3 FALSIFIED, and the run found a defect in the instrument instead

The transitions out of `merged` work cleanly. `qa_passed` and `closed` both succeed with no missing
artifact and no test plan required at the board level:

    APP-001 merged    -> qa
    APP-001 qa_passed -> qa
    APP-001 closed    -> done

**So the six post-merge tickets are NOT a missing-writer problem.** Nothing was structurally
blocking them. Unlike H2, there is no artifact with no producer here — the loop simply stopped
driving them, most plausibly because each dry run's declared scope ended.

That is a real negative result and worth having: two of three hypotheses held, this one did not.
A hypothesis nobody has probed carries no information, and one that survives every probe usually
means the probes were aimed at ground already cleared.

## The finding: my own stall detector was blind to these exact tickets

Having falsified H3, the follow-up question was whether the movement check built this morning would
have SEEN those six tickets. It would not have.

`TERMINAL` was written as `['done', 'qa']`. A ticket at `qa` has merged and still owes `qa_passed`
and `closed` — it is not terminal. Of the 19 recorded tickets, 4 ended at `merged` and 2 at
`qa_passed`; **all six sit at `qa`**, and the detector built to find parked tickets would have
reported that board as moving fine.

An instrument with a blind spot over its own subject is worse than no instrument, because it
answers.

**Fixed:** `TERMINAL = ['done']`. Verified: `STALLED APP-001 [qa] — 13 board events have happened
since this one moved`. Locked with a regression.

## What the three experiments together say

  H1  the pipeline is completable once a ticket is claimed          HELD
  H2  a planned project could not dispatch at all                   HELD — the whole of 11-of-19
  H3  post-merge transitions are blocked by a missing artifact      FALSIFIED

Two structural defects found and fixed, one hypothesis correctly killed, and one defect found in the
instrument itself — in about fifteen minutes across three experiments, none of which spawned an
agent or built an app.
