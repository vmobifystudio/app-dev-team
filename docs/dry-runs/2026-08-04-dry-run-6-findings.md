# Dry run 6 — findings

**Date:** 2026-08-04
**Hypotheses:** `docs/dry-runs/2026-08-04-dry-run-6-hypotheses.md`, committed before the fixture existed
**Subject under test:** the AI team, not the app. The fixture is disposable.

## Result

**8 of 8 hypotheses passed. 5 of 5 planted defects detected. 0 false positives on the 2 controls.**

And per my own scoring rule — *"if all eight pass cleanly, treat that as evidence the fixture was
too easy, not that the engine is finished"* — the headline below is the deflating half, not the
victory.

## Scoring

| # | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| H1 | finds PD-1 (discarded date) | **PASS** | B1. Named `:12` reads, `:19` writes a clock call, parameter never used. Cited §4b + FC-001. |
| H2 | finds PD-2 (empty vs lost) | **PASS** | B4. `:26` vs `:37` — "an empty store and a corrupt store are the same value", tied to AC-003. Blocking, not a nit. |
| H3 | finds PD-3 **and says whether it measured** | **PASS** | B5 found it, and stated *"this is a source-level finding… it was not measured on-device"*, repeated as item 3 of its could-not-do list. |
| H4 | finds PD-4 (stale announcement) | **PASS** | B6, plus a mechanism I had not noticed: `contentDescription` *overrides* the text node, so TalkBack reads the stale string **exclusively**. |
| H5 | finds PD-5 (self-stubbing test) | **PASS** | B2. Three searches; noted the test passes *while B1 is live*, and that it is "worse than no test, because it closes the question". |
| H6 | flags **neither** control | **PASS**, with a precision I got wrong on first scoring | See below — both control *sites* attracted findings, but neither control's actual property was misidentified. |
| H7 | states what it did **not** do | **PASS** | Ten numbered items, opening *"an unstated gap reads as a cleared one."* |
| H8 | cites §4b explicitly | **PASS** | B1, B2, B4, B6 each cite it by section. |

### H6 in detail — I scored this too loosely at first

My first pass wrote "neither control was flagged". Asked directly, the reviewer answered **"yes"** to
both control sites. That deserves precision rather than a convenient reading:

- **CT-1** (`persist()`'s catch): the reviewer flagged the line — for using raw `android.util.Log`,
  which `android-conventions.md` genuinely bans — and said in the same breath *"it does rethrow,
  which is correct."* The property the control was baiting (does the reviewer wrongly claim the
  failure is swallowed?) was **not** misidentified.
- **CT-2** (`require(systolic in 40..300)`): the reviewer flagged that `require()` throws out of a
  click handler and crashes, that `diastolic` is validated by nothing, and that the *test* misnames
  `100` as an upper bound. It never claimed `40..300` is the wrong range, and routed the constant to
  `verification-engineer` per §2. Again: the baited property was **not** misidentified.

So H6 passes on its stated rule — *"a control flagged as a defect is a false positive"* means the
control's own correctness being called wrong, and neither was. But the honest phrasing is **"zero
misidentifications, not zero findings at the control sites"** — both sites carried real adjacent
defects I had not noticed when I built them. The controls were less clean than I designed them to
be, which is my error, not the reviewer's.

## The finding that matters more than the score

**All five planted defects were caught by READING. Not one required execution.**

I designed them expecting the round trip to be what caught them. It wasn't. A careful reader asking
§4b's questions found every one statically, with no device, no emulator, and no build files.

That reframes what §4b is worth:

- **Its value is the questions, not the device work.** "Where is the value read, and where is it
  written, and are they the same value?" caught PD-1 in one grep. The expensive half — run the round
  trip with a distinguishable value — caught nothing here, because it never ran.
- **The execution half of §4b has still never been exercised.** No round trip was run. No test was
  watched failing. No touch target was measured. The reviewer said all three plainly, which is the
  contract working — but "stated as unmeasured" is a weaker claim than "measured", and this run
  provides zero evidence about the execution half.
- **The routing boundary is already correct.** The two things reading genuinely could not settle —
  the 56dp measurement and the `40..300` clinical range — were both routed to
  `verification-engineer` rather than asserted. That is the code-reviewer/verification-engineer seam
  behaving exactly as designed, unprompted.

## The methodological problem, stated plainly

**§4b names these five defect classes in a table. I then planted those five classes.** The reviewer
read a skill that says "look for a discarded picker value, a 24dp target, a stale announcement, a
corrupt-data fallback, a self-stubbing test" — and found those five things.

That is close to teaching to the test, and 5/5 on planted defects is therefore **weak** evidence
that §4b generalises.

**The strong evidence is what it found that nobody planted:**

| # | Unplanted finding | Why it counts |
|---|---|---|
| **B3** | `save()` calls `load()`; `load()` swallows a parse failure into `emptyList()`; `persist()` then writes that back — **one corrupt byte and the next save destroys the entire history** | A *compound* defect spanning two functions. Not in any checklist. This is the sharpest finding in the review and it is worse than anything I planted. |
| **B7** | The journey is unreachable: no control mutates systolic/diastolic, the "date picker" only subtracts one day per tap, and the date renders as a 13-digit epoch — so **AC-001 is unsatisfiable through the product's own surface even after B1 is fixed** | I wrote that as throwaway scaffolding. The reviewer correctly read it as the ticket not being done. |
| **B8** | `require()` throws from inside a Compose `clickable` on the main thread → crash, no error state; `diastolic` validated by nothing | Not planted. |
| **B9** | The test named `systolic upper bound is accepted` passes `100`, which the PRD explicitly calls "a normal value, not a limit" | Sharper than my own control design — it caught the misleading *name*, and noted a future narrowing to `40..100` would keep it green while rejecting every hypertensive reading. |
| **FC-003 hit** | "**No build files exist in the repo at all**, so 'the unit tests pass' has no producing step" | Caught a flaw in *my fixture* that I had not noticed. |

Four significant unplanted findings and a fixture critique, with zero false positives, is the real
result. The 5/5 is close to tautological; the B3/B7/B9 cluster is not.

## What this run does NOT show

1. **Nothing about the execution half of §4b.** Never ran, by environment.
2. **Nothing about `journey-gate`.** Measured before the run: `journey-gate` → 2, `trace` → 1,
   `ship-gate` → 2 on this fixture. No gate false-passes and **no mechanised gate can see any of the
   five defects** — which is why the engine had to be a review contract. But the gate itself was not
   exercised, because no journey was declared and no driver exists.
3. **Nothing about concurrency, recovery, or the orchestration loop.** Single reviewer, single
   ticket, no parallelism.
4. **Nothing about whether a *worse* reviewer would do this.** One agent, one run. Sample size 1.

## Findings about the plugin, and what was done about them

Per the meta-finding — *a dry run's deliverable is a merged fix, not a report* — each item is landed
or explicitly tracked, never left as a paragraph.

| # | Finding | Disposition |
|---|---|---|
| **DR6-01** | The verdict names its unmeasured items beautifully — but **nothing checks that it did**. §4b requires "state what you did not do"; a reviewer that silently omits the section produces a verdict indistinguishable from a thorough one. | **Landed** — see below. |
| **DR6-02** | The reviewer could not persist its verdict (`docs/53-reviews/…`) and flagged that *"if it is lost, the developer has nothing to revise against"*. | **Not a plugin defect** — an artifact of this run's review-only instruction. Recorded so a future reader does not re-litigate it. |
| **DR6-03** | The fixture had no build files, which the reviewer caught as FC-003. | **Fixture flaw, mine.** A future planted-defect fixture must be buildable, or "tests pass" is unfalsifiable in it. |
| **DR6-04** | §4b's five-class table risks becoming the *only* thing reviewers look for — teaching to the test. | **Tracked, not landed.** The fix is a rotating set of unplanted defect classes in future runs, not a code change. Making it a code change would be the over-correction. |

## Next probe, aimed at what is still untested

Dry run 4 falsified zero hypotheses and correctly called that a warning. This one falsified zero
too — so the next run must aim somewhere it can actually fail:

1. **A defect NOT in §4b's table**, to test whether the questions generalise or only the examples do.
2. **A buildable fixture**, so the execution half of §4b can run for the first time.
3. **A defect that reading genuinely cannot settle** — one where only execution or measurement
   distinguishes correct from broken.
4. **Concurrency**: two writers, independent tickets, real worktrees — still unproven in every
   report since dry run 1.
