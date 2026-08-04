# Dry run 6 — hypotheses, committed before the run

**Date:** 2026-08-04
**Question:** does the plugin now have a product-correctness engine, or did I just add prose?

## Why this run exists

Six previous dry runs measured the same result: the gates caught **every** process defect and
**zero** product defects. Today two mechanisms shipped that claim to change that:

- `defect-hunting` §4b — the round trip, required by `code-reviewer.md`
- `scripts/journey-gate.mjs` — a runtime PASS that means a declared journey completed

Both are unit-tested. Neither has been exercised by a real agent that did not know what it was
looking for. **A hypothesis nobody has probed carries no information at all** — dry run 5's phrasing,
and the reason this document exists before the fixture does.

## Method

An Android fixture carrying **planted product defects** of exactly the classes historically missed.
A real `code-reviewer` agent is spawned with **no knowledge that defects were planted** and no
mention of this document. It gets the diff, the ticket, and the studio's own instructions. What it
finds is the measurement.

**The control matters as much as the defects.** The fixture also contains two things that *look*
wrong and are correct. A reviewer that flags everything has not detected anything — it has raised
the false-positive rate, which is the number `eval/clean` exists to keep honest.

## Planted defects

| ID | Class | The defect | Historically missed by |
|---|---|---|---|
| **PD-1** | discarded user value | The date picker's selection is collected, then `save()` writes `System.currentTimeMillis()` | 3 separate reviews of the BP Journal fixture; no gate ever |
| **PD-2** | empty vs lost | Corrupt stored JSON is caught and returns `emptyList()` — data loss is indistinguishable from an empty state | DR6 expert audit A4 |
| **PD-3** | spec value not in built UI | Touch target is 24dp; `docs/13-design-tokens.md` says 56dp minimum | tap-counter dry run, found only by on-device measurement |
| **PD-4** | stale announcement | The count updates; the `contentDescription` is computed once and never recomputed | tap-counter dry run, found by an adversarial reviewer |
| **PD-5** | self-stubbing test | `ReadingStoreTest` asserts against its own in-test fake, never touching `ReadingStore` | tap-counter dry run |

## Controls (correct code that looks suspicious)

| ID | Looks like | Actually |
|---|---|---|
| **CT-1** | A bare `catch (e: Exception)` | Rethrows after logging — the failure is not swallowed |
| **CT-2** | A hard-coded `100` in validation | The documented upper bound for a plausible systolic reading, matching `docs/10-prd.md` |

## Hypotheses

Each is falsifiable by the run's output alone.

| # | Hypothesis | How it is falsified |
|---|---|---|
| **H1** | The reviewer finds **PD-1** (the discarded date) | It does not appear in the verdict |
| **H2** | The reviewer finds **PD-2** (empty vs lost) | It does not appear, or is called a style nit rather than data loss |
| **H3** | The reviewer finds **PD-3** (24dp vs 56dp) **and says whether it measured or read** | It is missed, or asserted without stating which |
| **H4** | The reviewer finds **PD-4** (stale announcement) | It does not appear |
| **H5** | The reviewer finds **PD-5** (self-stubbing test) | It does not appear, or the test is described as passing coverage |
| **H6** | The reviewer flags **neither control** | Either CT-1 or CT-2 appears as a defect |
| **H7** | The verdict **states what it did not do** — §4b requires unchecked items be named | The verdict is silent about round trips it did not run |
| **H8** | The reviewer cites **§4b or the round trip explicitly** — i.e. the new contract is what drove it, not general competence | Findings appear with no reference to the mechanism |

**Predicted weakest:** H3 and H8. H3 needs an on-device measurement the reviewer cannot take with no
emulator — the honest outcome is "stated as unmeasured", and I will score that as a pass only if it
is stated rather than silently skipped. H8 is weak because a good reviewer may find these defects
anyway, which would mean §4b is *redundant* rather than *load-bearing* — a real and important
negative result.

**Prediction I expect to be wrong somewhere.** Dry run 4 falsified zero hypotheses and correctly
called that a warning sign: its hypotheses were calibrated to fixes made hours earlier. These were
written the same day as the mechanisms they test, so the same risk applies. If all eight pass
cleanly, treat that as evidence the fixture was too easy, not that the engine is finished.

## Scoring rules

1. A defect is **detected** only if the verdict names the actual defect, not an adjacent one.
   "Consider adding tests" is not a detection of PD-5.
2. A finding that names a **wrong root cause** is not a detection.
3. A control flagged as a defect is a **false positive**, reported in the headline number.
4. Detection and false-positive rate are reported **separately and never averaged** — the readiness
   charter's own rule, which two prior reports broke.
5. **The deliverable is merged fixes**, not this report. Every finding about the plugin becomes a
   code change with a mirror-tested regression in the same session, or a tracked proposal with an
   owner. Every prior dry run was report-only, and that is precisely why the same findings recurred.
