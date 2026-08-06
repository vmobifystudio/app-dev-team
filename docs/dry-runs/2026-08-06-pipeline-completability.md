# Targeted experiment — is the pipeline completable at all?

**Committed before the run.** Engineering rule #2: one hypothesis, one defect class, a fixed budget,
a stopping condition. This is NOT an app build and spawns no agents.

## The question

Across every recorded run: 19 tickets created, 1 reached `closed`. Nobody has ever established
whether that is an AGENT problem or a MECHANISM problem — whether the pipeline can be completed at
all by a caller who knows every rule perfectly.

## Hypothesis

**H1: a single ticket can be driven `created → closed` through the current CLI with no refusal that
lacks a documented remedy.**

If H1 holds, the 1-of-19 is a dispatch/agent problem and the fix is orchestration.
If H1 fails, the pipeline has a structural dead end and no amount of agent quality fixes it.

## Method

Drive `board.mjs` by hand in a scratch project. No agents — deliberately. An agent's ability to
follow instructions is a different question, and mixing the two is how six previous runs produced
anecdotes instead of a number.

## Budget and stopping condition

One ticket. Stop at the first refusal with no documented remedy, and record it verbatim.

## Result

Recorded below after the run, whatever it says.

---

## Result — H1 HOLDS, and the run found something worth more than the hypothesis

A single ticket was driven `created → claimed → done_reported → verified → review_requested →
started → approved → merged → qa_passed → closed`. Every transition legal, audit chain intact at 10
lines, no refusal without a documented remedy.

**So the 1-of-19 is not a structural dead end.** The pipeline is completable. The failure is in
dispatch and follow-through, which is where `orchestrator round`'s new movement check now points.

## The actual finding: the board said `merged` while git had not merged

At step 9 the `git merge` FAILED — a dirty tree refused the checkout. The board did not care:

    git merge          -> error: local changes would be overwritten. Aborting.
    board.mjs merged   -> accepted
    board.mjs qa_passed-> accepted
    board.mjs closed   -> accepted    final state: done

Verified afterwards: `main` does not contain the commit, `feat/APP-001` is not an ancestor of
`main`. **A ticket reached `done` — the strongest claim this system makes — with the code never
integrated.**

That is FC-003 ("green while nothing happened") inside the most consequential transition on the
board, and six dry runs never saw it because none of them checked git against the board afterwards.

**The gate is not wrong to allow it.** `move ... merged` is a PRECONDITION that runs before any git
command by design — that ordering is why an unapproved merge is impossible rather than merely
detectable. What was missing is the confirmation *afterwards*. The window between "allowed to merge"
and "merged" was unobserved.

**Fixed:** `scripts/merge-reconcile.mjs`, wired into `orchestrator round` and `ship-gate.sh`.

## What this experiment cost, and why that matters

Five minutes. No agents spawned. One hypothesis, one stopping condition.

Six previous dry runs spent days building fixture apps and produced reports whose findings were
handed off and never landed. This produced a defect, a fix, and eight regressions, because it asked
one falsifiable question instead of trying to build something.
