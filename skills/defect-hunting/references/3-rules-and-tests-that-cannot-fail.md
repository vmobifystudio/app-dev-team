# defect-hunting §3 and §3b — a rule or a test that cannot fail is worse than none

Loaded from `defect-hunting` SKILL.md when you write, review or certify a guard rule, lint rule, architecture test, CI grep, baseline, or a new or changed test.

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

### Corollary

**The tool you build to catch this problem is subject to it too.** Test your checker against a fixture with known-good and known-bad cases before you trust one word
of its output.

---

## 3b. A test that cannot fail is worse than no test

§3 is about guard rules and lint checks. This is the same failure shape one level down, in ordinary
unit and regression tests: **a test that is green regardless of whether the code is correct.**
Checking *whether tests ran* is not checking *whether they could catch anything* — different gaps.

### The shapes to grep for, in review of any new or changed test

| Shape | What it actually verifies |
|---|---|
| Tautology | the test's own literal, restated (`assertEqual(2+2, 4)`, or asserting a constant against itself) |
| Framework re-verification | that the test framework, mocking library, or language runtime works, not that this code does |
| Identity mock | a mock configured to return exactly what the assertion checks for — the test cannot see the code under test at all |
| Call-sequence-only | asserts a function was *called*, never asserts what it *did* or *returned* |
| Self-referential fixture | the "expected" value is computed by the same logic being tested, not an independent reference |

### The check

**Reintroduce the bug this test is supposed to catch (§3's mutation step, applied here) and confirm
the test goes red.** A test that stays green through a real mutation is exactly as worthless as a
guard rule that stays green through one — it is not a weaker test, it is not a test.
