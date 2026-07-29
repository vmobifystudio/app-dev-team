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

### Shell guards fail open by default

The most common unfailable rule is not a `contains()` in application code — it is a shell check
whose exit status comes from the wrong command:

```bash
grep -E "pattern" file | sed 's/^/  /' || echo "NOT FOUND"    # sed succeeds on empty input
cmd | head -1 || handle_error                                  # head's status, not cmd's
[ -n "$(grep x f)" ] && ok                                     # fine, but silent when grep errors
```

A pipeline's status is the *last* command's. Gate on the test itself — `if ! grep -q ...; then` —
and prove it by running the guard against an input you know should fail it.

**And `[^\n]` is not "any character except newline".** In a POSIX bracket expression it means "not a
backslash and not the letter n". `grep` is line-oriented, so `.` already excludes newlines — write
`.*`. Using `[^\n]*` made a release gate report zero open blocker bugs while two were open, and the
behaviour differed between an interactive shell and `sh`, so it passed by hand and failed in the
script. This was violated while
writing the rules against it: a merge-gate precondition printed nothing, returned success, and let a
merge through.

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

## Review checklist

Attach to any `code-reviewer` or audit verdict:

- [ ] Named the data this change touches, and enumerated **every** writer and reader of it
- [ ] Checked the edit / cancel / failure / restore / import paths, not just the happy path
- [ ] Every constant or threshold with a real-world claim was **executed** against reference data
- [ ] Any new rule or test was **watched failing** before being trusted
- [ ] No rule in this diff passes by matching a comment
- [ ] Any "not present" claim was made with two different searches
- [ ] Every finding raised has an ID and a non-blank status

Anything unchecked is stated as unchecked in the verdict. Never let a box go unmentioned — an
unstated gap reads as a cleared one.
