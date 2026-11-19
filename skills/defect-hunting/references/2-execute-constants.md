# defect-hunting §2 — never certify a number by reading it; execute it

Loaded from `defect-hunting` SKILL.md when a change adds or edits a threshold, bound, formula, table or rate. Mis-calibration is invisible to inspection because the code is correct: the arithmetic does what it says and only the numbers are wrong.

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
