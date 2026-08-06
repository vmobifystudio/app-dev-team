# Product failure corpus

**The defects the APPS produce**, as distinct from `failure-corpus.md`, which is the defects **this
studio** produces. That distinction is the reason this file did not exist until 2026-08-06, and it
is the whole explanation for the most-repeated line in our own reports:

> Across six dry runs, **not one product defect was caught by a gate.** Every one came from an
> adversarial reviewer or a human audit.

That was never a mystery. Nothing had been built to catch them. The classes below were observed,
written into dry-run reports, and left there — while `failure-corpus.md` sat alongside holding
seven *studio* classes each with a mechanised Tell. The corpus format was right; it was pointed at
ourselves and never at the product.

**The bar, inherited from `failure-corpus.md` and not softened here:**

> **Tell:** what a reviewer *greps or asks*. **If you cannot mechanise it, the class is not
> finished.**

Each class below states honestly whether it is **MECHANISED** (a scan exists), **PARTIAL** (a grep
narrows it, a human decides), or **REVIEWER-ONLY** (no mechanism; it needs someone to go and look).
Marking a class REVIEWER-ONLY is not defeat — it is the difference between a known gap and a gap
that looks covered.

---

## PF-001 — The user's value is discarded on the way to storage

**Observed:** a date picker whose selection was thrown away; the save path wrote
`System.currentTimeMillis()` instead. The screen looked correct, the write succeeded, and the stored
value was silently *today* for every entry. Found by three separate reviews, never by a gate.

**Why it survives:** every layer is individually correct. The picker returns the right value, the
repository writes what it is given, the database stores what it receives. The defect lives in the
one line where the value stops being the user's.

**Tell:** for any diff that persists something a user supplied, name the line that **reads** the
value and the line that **writes** it, and show they are the same value. A clock call
(`System.currentTimeMillis()`, `Date()`, `.now`, `Instant.now()`), a literal, or a default between
those two lines is the finding. Then run the round trip with a **distinguishable** value —
`1999-01-02`, not today; `73`, not `0` — and read it back through the product's own surface.

**Status: PARTIAL.** A clock call inside a function that also takes a user-supplied parameter is
greppable and worth flagging, but the judgement — *is this timestamp metadata or is it the value?* —
is genuinely a reviewer's. `defect-hunting` §4b is the instruction; it is required of
`code-reviewer` and its output now has to be stated under `## Not checked` if it was not done.

---

## PF-002 — The corrupt-data fallback that is indistinguishable from empty

**Observed:** malformed JSON caught and returned as an empty list. A user whose file was corrupted
saw exactly what a new user sees: nothing. No error, no telemetry, no way for support to tell "you
have no data" from "we lost your data".

**Why it survives:** it reads as defensive programming. The `catch` is *there*, which looks like
care, and the crash it prevents is real. What it destroys is the distinction between two states
that must never be conflated.

**Tell:** every `catch` that returns an empty collection, `null`, or a default instance, where the
`try` was a **read of persisted user data**. Ask: can the caller tell this from a legitimately empty
result? If not, it is a data-loss report rendered as a blank screen.

**Status: MECHANISED** — `scripts/silent-fallback-scan.mjs`.

---

## PF-003 — The durability gap that only appears on a crash

**Observed:** an async `apply()` where the write had to survive process death. Correct in every test,
wrong exactly when it matters, and untestable by anything that does not kill the process.

**Tell:** `apply()` on Android `SharedPreferences` (versus `commit()`), a `Task`/coroutine writing
persisted state with nothing awaiting it, an unflushed file handle on a path the app calls "saved".
Ask what the user was told: if the UI said "saved", the write must have completed.

**Status: PARTIAL.** `apply()` is greppable; whether *this* write needs durability is a judgement.

---

## PF-004 — The measurement nobody took

**Observed:** a 24dp touch target where the spec said 56dp. The source said 56 somewhere; the built
UI rendered 24.

**Why it survives:** a spec figure is a claim about the **built UI**, not about the source. Reading
the source confirms someone typed the right number, which is not the same fact.

**Tell:** for every quantity a spec states — touch target, contrast ratio, font scale, launch time —
either **measure it on the built artifact** (`uiautomator`, an accessibility scan, a trace) or write
that you did not. The best behaviour observed in any dry run was a reviewer re-measuring on-device
with `uiautomator` instead of trusting the developer's numbers.

**Status: PARTIAL.** `accessibility-gate` and `runtime-gate` can measure some of these when a device
exists; nothing forces the measurement when one does not, beyond it being stated as not done.

---

## PF-005 — The accessibility announcement that goes stale

**Observed:** a TalkBack announcement describing a state the screen had already left.

**Tell:** for every dynamic value announced to a screen reader, find the update path for the visible
value and check the announcement is on it. A `contentDescription` set once at bind time, next to a
value that changes afterwards, is the shape.

**Status: REVIEWER-ONLY.** No mechanism. Stated here so it is a known gap rather than an assumed
cover.

---

## PF-006 — The test that exercises its own stub

**Observed:** a device test that drove a fixture and never touched the app under test. It passed,
reliably, forever, and proved nothing.

**Why it survives:** it is green, it is fast, and it is *named* after the feature.

**Tell:** for any test claimed as evidence, name the production symbol it calls. If every symbol in
the test body is defined in the test source or a fixture, the test asserts on itself. `mutate.sh`
applies exactly this technique to our own suite — break the thing, watch the test fail — and it is
the same question asked of an app's tests.

**Status: PARTIAL.** The reasoning is mechanisable per-language and is not built for app code yet.
`verify-done.sh` requires positive evidence a suite *ran*, which is a weaker and different claim.

---

## How to use this

- **`code-reviewer`** — run every Tell against the diff, as with `failure-corpus.md`. Cite the class
  (`PF-002`) in the finding; an uncited class is one nobody can check you against.
- **`qa-engineer`** — PF-004 and PF-006 are test-plan questions before they are review questions.
- **Adding a class:** it must come from a defect that actually happened, with the incident named,
  and it must state its status honestly. A class with an aspirational Tell nobody has run is the
  "rule that cannot fail" (FC-002) wearing a product costume.
