---
name: defect-hunting
description: Use when reviewing code, auditing an app, writing a guard rule or test, or certifying any threshold/constant/formula. Finds the defects a diff review structurally cannot see — the second write path, the mis-calibrated constant, the rule that cannot fail. Triggers from code-reviewer, /app-audit, qa-engineer, verification-engineer, and any task that adds a lint rule, architecture test, or CI grep.
---

# Defect hunting

Mined from a real remediation programme where twelve screen-by-screen review rounds found nothing
new, and one round organised differently found dozens of live defects. Every one of these rules is
paid for.

**The sentence that generates all four:**

> Verify the thing that has to be true, not the thing you changed.

Filtering the list is not filtering the parser. Capping the severity is not capping its renderer.
Matching the token is not matching the value. Mutating the file is not confirming the mutation
landed.

---

## 1. Audit the data's entry points, not the screens

A review organised by screen structurally cannot find these, because in every case **the audited
surface was correct and the bug was in the second path to the same data** — usually another file,
often another module:

| What was reviewed | Where the defect actually was |
|---|---|
| Add-form validation | the **edit** path, which validated nothing |
| the dashboard alert banner | the **detail screen** the banner opens — they disagreed |
| the growth-target reader | the **writer**, which destroyed data |
| the photo picker's success branch | its **cancel** branch, which wiped the existing photo |
| the purchase flow | the **still-loading** entitlement state, which paywalled a paying customer |
| sync's happy path | the `RECONCILE_FAILED` branch |

### The question that does the work

> **"What is the second way this value gets written?"**

And its siblings: what is the second way it gets *read*? What happens on cancel? On failure? On
restore? On import? On sync? On each remaining enum case?

### Procedure

Before approving any change that touches persisted or user-visible state:

1. Name the data the change touches — the field, the row, the preference, the entitlement.
2. **Enumerate every writer.** `grep` the field name across the whole repo, not the module.
   Create, edit, import, sync, restore, migration, reset-to-default, and every failure branch.
3. **Enumerate every reader**, same way.
4. Show the invariant holding **on each one**. A validation that one producer applies and another
   walks around is not a validation.
5. If you cannot enumerate them, say so — do not approve on the strength of the path you read.

A one-line fix at the shared choke point beats a guard in every caller, and it is also the *lazier*
fix. Patching only the path the ticket names leaves every sibling caller broken.

---

## 2. Never certify a number by reading it — execute it

An age-aware plausibility envelope read perfectly sensibly, survived 35 sprints and every review.
Executed against the app's own bundled reference table, it rejected the **median** child at 26 of
61 ages: an average 12-month-old was told their measurement looked wrong.

Mis-calibration is invisible to inspection **because the code is correct**. The arithmetic does
exactly what it says. Only the numbers are wrong, and numbers do not read as wrong.

Same failure shape as a fabricated reference standard and a wrong lookup table forced on the wrong
population: plausible-looking numbers that nobody ever ran.

### The rule

Any threshold, bound, formula, coefficient, table, or rate that makes a **clinical, financial, or
safety claim** must be checked by *executing it across its whole input range against reference
data*, and the comparison recorded.

```
for every input across the real range:
    print(input, computed, reference, verdict)
assert no reference-normal input is rejected
assert no known-bad input is accepted
```

"It looks reasonable" is not evidence. Neither is a passing unit test that uses the same constant
the implementation uses — that tests self-consistency, not correctness. Check against a source
that did not come from this codebase.

### Applies to

Pricing and paywall tiers · rate limits and quotas · retry/backoff windows · percentile and score
cutoffs · plausibility and validation ranges · unit conversions · timeout budgets · anything
compared against a published table.

---

## 3. A rule that cannot fail is worse than no rule — it reports success

Ten of nineteen guard rules were bypassable. Every one from the same cause: **`contains()` over
prose.**

| The bypass | What satisfied the rule |
|---|---|
| error-channel rule | a *comment* saying "no error field needed" |
| caller-exists rule | the interface *declaration*, not a call |
| "no `.sp` literals" rule | its own comment *about* `.sp` literals |
| a boolean guard | `-> false \|\| true` — kept the build green and put a data-loss bug back |

A rule scanning text finds its own documentation. It then passes forever, and — this is the damage —
**it stops people looking.** No rule at all leaves the question open. A green rule closes it.

Shell guards are the worst offenders — a pipeline's exit status is the *last* command's, so a
grep that finds nothing still reports success. **If you are writing one, read
`writing-guard-rules.md` beside this file first**; you do not need it to review one.

### Three defences, ascending

1. Strip comments before scanning. *(weakest — still text)*
2. Exclude declarations; require an actual call/usage site. *(better — still text)*
3. **Stop scanning text. Assert the value of a pure function.** *(the only safe one)*

Prefer: import the thing, call it, assert the result. A rule that executes the code under test
cannot be fooled by prose about the code under test.

### Mandatory: prove the rule can fail — all three steps

**A new guard rule, lint rule, architecture test, or CI grep is not done until you have watched it
fail.** But "watch it fail" is three steps, and each one failed separately in a single session:

1. **Confirm the mutation actually applied.** Twice, an edit meant to break the code silently did
   not land, and the suite stayed green — which was then read as "the test is fine". Check with
   `diff -q` or by printing the changed line. An unapplied mutation tests nothing and looks
   identical to a passing test.
2. **Confirm the fixture reproduces the real condition.** A ship-gate test passed under a mutation
   that genuinely broke the gate, because the fixture's data happened not to trigger it — the real
   bug board contained the letter that broke the regex and the fixture did not. A benign fixture
   passes on broken code.
3. **Then watch it go red, and green again on revert.**

Skip step 1 and you have tested nothing. Skip step 2 and you have tested the wrong thing. Both look
exactly like success.

If you cannot make it fail, it is not a rule — it is a comment that costs CI time.

### Baselines

A baseline of 62 against a real count of 44 is eighteen free regressions. Recount from the source
before freezing any baseline, and record how you counted.

### Never cite a gate that doesn't run

Citing a check that isn't wired into CI is **worse than citing nothing**, because it stops people
looking. If it doesn't run on every change, say "not gated".

### The corollary that costs a round to learn

**The tool you build to catch this problem is subject to it too.**

A comment-stripping helper — written specifically to stop rules fooling themselves — silently
rejected every receiver-style call and reported three live builders as dead. It read correctly.
Only executing it exposed it.

Test your checker against a fixture with known-good and known-bad cases before you trust one word
of its output.

---

## 4. Findings discipline

A finding that exists but is scheduled to nobody is a finding that will be silently skipped. Four
adversarial review rounds never caught ~70 such items, because reviewers check *what was done*, not
*what was left out*.

- Every finding gets a **stable ID** and a row in one register, with a status that is never blank:
  `OPEN` / `IN-PROGRESS` / `FIXED` / `DEFERRED(reason)` / `WRONG-FINDING(evidence)`.
  "Not mentioned" is not a status.
- **A sweep is not done until a rule prevents recurrence.** If an item says *sweep*, *every*, *all*,
  or *class*, fixing the named instance does not close it. It closes when a test would fail if the
  pattern reappeared — and that rule must be proven able to fail (§3).
- **A "not found" claim needs two independent searches** — different tool *and* different pattern
  shape. A stale `© 2025` was recorded as a non-issue because the search looked for the literal
  glyph while the source contained `&copy;`. A live defect was documented as imaginary.
- **`FIXED` is a claim about the integration branch**, not about a branch or a working tree. Verify
  it merged before writing a terminal status.
- Diff the register against the source documents **per cluster**, not once at the end.

---

## 4b. Follow the user's value across the boundary — the round trip

§1 asks who else *writes* the value. This asks a different question: **does the value the user
supplied actually arrive?**

Six dry runs of this studio produced a consistent, humiliating result. The gates caught version
mismatches, illegal board transitions, fake test commands, an unspawnable owner — every one a
*process* defect. They caught **none** of these:

| What the user did | What the product did | Why every gate passed |
|---|---|---|
| picked a date in the date picker | saved `System.currentTimeMillis()` | the picker rendered; the save succeeded; the unit test tested the formatter |
| expected a 56dp touch target | got 24dp | the spec said 56dp; the composable compiled; nothing measured the built UI |
| changed the count, using TalkBack | heard the **previous** count | the state updated; the announcement was never re-read |
| had corrupt stored data | saw an empty list | the parse "succeeded" into `[]`; empty state is indistinguishable from data loss |
| ran the device test | exercised the test's own stub | the test passed. It tested itself. |

Every one was found by a reviewer who **went and looked**, or by a human reading the app afterwards.
Not one was found by a gate. That is the single most important measured fact about this system, and
it is why this section exists.

### The shape

**A value crosses a boundary and does not arrive, and nothing on either side notices.** The
collecting surface is correct. The storing code is correct. The test is correct *about the helper it
tests*. The defect lives in the seam, which is exactly where nobody's unit test is.

### The question that does the work

> **"Where is the value the user supplied read, and where is it written — and are they the same value?"**

Not "does the save path work". Not "does the picker render". Name the **line** that reads the user's
input and the **line** that persists it, and put them next to each other. If a literal, a clock call,
a default, or a different variable appears between them, that is the finding.

### Procedure

For any change touching a value a user supplies, sees, or is told:

1. **Name the value** — the date, the count, the label, the announcement, the measurement.
2. **Find the collection site.** The control, the argument, the sensor read.
3. **Find the persistence/render site.** The write, the DAO call, the announced string.
4. **Read the path between them.** Not the function names — the actual assignments.
5. **Execute the round trip.** Supply a distinguishable value (never `0`, never today's date, never
   the default — those are indistinguishable from the bug). Read it back through the product's own
   surface. `1999-01-02` survives; `System.currentTimeMillis()` does not.
6. **Measure what the spec quantifies.** A spec that says 56dp is a claim about the built UI, not
   about the source. Measure it on-device (`uiautomator dump`, accessibility inspector) or state
   plainly that you did not.

### The corollary that costs a product defect to learn

**An empty result and a lost result look identical.** A parse that falls back to `[]`, a fetch that
returns no rows, a restore that finds nothing — each is either "there is nothing" or "there was
something and it is gone." If the code cannot tell those apart, neither can the user, and neither
can you. Make the failure branch say which one it is; that is a three-state contract applied to
data instead of to gates.

### The adversarial obligation

The most valuable behaviour observed in any dry run was a reviewer who, unprompted:

- **re-measured on-device** rather than accepting the developer's stated numbers; and
- **reintroduced the bug** in a scratch edit to prove the new regression test actually caught it.

That was one reviewer having a good day. It is now the contract — see §3's "prove the rule can fail",
of which this is the product-facing half. A regression test nobody watched fail is a regression test
nobody has any reason to trust, and a number you did not measure is a number the developer measured.

---

## 5. Use the prior — `knowledge/failure-corpus.md` beats this skill's own generality

The four rules above are general. They are true of most codebases and were paid for in a different
one. **`knowledge/failure-corpus.md` is specific: it is what *this* codebase has actually produced,
one entry per defect class, each with dated instances and the rule that now claims to catch it.**

A generic checklist enumerates what could go wrong, weighted by nothing. A corpus enumerates what
*did* go wrong here, weighted by how often and how recently — which is the only prior worth having
when you have finite attention and an unbounded space of possible defects. Run its **Tells** before
you improvise your own; they exist because someone already paid for them.

Two obligations, both cheap:

1. **Cite the class ID** in any finding it produced (`FC-004`). An uncited class cannot be checked,
   and cannot be scored for whether it is earning its place.
2. **A class that recurs after its rule shipped is the most valuable output in the system** — it says
   the rule does not work, which you would otherwise learn a third time. `team-doctor` fails on it;
   `/app-learn`'s failure pass is what puts new instances there. Feed it.

The corpus is downstream of this skill, not a replacement for it: §1–§4 are how you find a defect
nobody has named yet, and that is how new classes get written.

---

## Review checklist

Attach to any `code-reviewer` or audit verdict:

- [ ] Ran **every Tell in `knowledge/failure-corpus.md`** against this diff, and cited the class ID
      for each finding it produced

- [ ] Named the data this change touches, and enumerated **every** writer and reader of it
- [ ] Checked the edit / cancel / failure / restore / import paths, not just the happy path
- [ ] **Followed each user-supplied or user-visible value across the boundary (§4b)** — named the
      line that reads it and the line that writes it, and confirmed they are the same value
- [ ] **Ran the round trip with a distinguishable value** (never `0`, never today's date, never the
      default) and read it back through the product's own surface
- [ ] **Measured, on-device, anything the spec quantifies** (touch targets, contrast, timings) — or
      stated plainly that it was not measured
- [ ] **An empty result is distinguishable from a lost one** on every failure branch this diff touches
- [ ] Every constant or threshold with a real-world claim was **executed** against reference data
- [ ] Any new rule or test was **watched failing** before being trusted — including **reintroducing
      the defect** in a scratch edit to prove this diff's own regression test catches it
- [ ] No rule in this diff passes by matching a comment
- [ ] Any "not present" claim was made with two different searches
- [ ] Every finding raised has an ID and a non-blank status

Anything unchecked is stated as unchecked in the verdict. Never let a box go unmentioned — an
unstated gap reads as a cleared one.
