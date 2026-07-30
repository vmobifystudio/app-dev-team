---
name: mutation-testing
description: Use when adding or reviewing a gate, guard rule, CI grep, or test assertion in this plugin's own scripts — and whenever a suite is green and you need to know whether that means anything. Runs scripts/mutate.sh, which breaks the code on purpose and reports which assertions failed to notice. Triggers from code-reviewer, verification-engineer, and any change under scripts/ or hooks/.
---

# Mutation testing

`defect-hunting` §3 says a new rule is not done until you have watched it fail, in three steps. That
instruction was followed by hand, when someone remembered. On 2026-07-29 the suite read
**385 passed, 0 failed** while containing a `grep -E` with a PCRE lookahead (a syntax error, stderr
to `/dev/null`, `|| ok` every time), two doctor assertions that a demoted gate could not turn red,
and a hook that stood down in exactly the incident it was written for.

**A green suite is evidence only to the extent its assertions can go red.** `scripts/mutate.sh` is
that, executable.

## Running it

```sh
sh scripts/mutate.sh                # all 16 catalogued mutations (~1 min each — the whole suite runs)
sh scripts/mutate.sh --list         # the catalogue, plus what it cannot test and why
sh scripts/mutate.sh --only M04     # one mutation, while you iterate on an assertion
sh scripts/mutate.sh --sample 4     # what CI runs on every PR
```

Exit `0` all caught · `1` something SURVIVED · `2` could not run (baseline not green, anchor drifted).

Three verdicts matter:

- **CAUGHT (n assertions)** — the gate bites.
- **SURVIVED** — the gate can be deleted and the suite stays green. **That is a hole**, and it is a
  finding at the same severity as the bug the gate was supposed to catch.
- **CAUGHT, but NOT by the assertion written for it** — some unrelated assertion noticed. Not a hole
  today; the named guard is decorative, and the next refactor that touches the unrelated one takes
  the coverage away silently. Fix the named assertion.

## The rule

**A new gate ships with a mutation proving its assertion bites.** Adding a check to
`board-doctor`, `ship-gate`, `verify-done`, `spawn-gate`, a hook, or `scripts/test.sh` is not done
until `scripts/mutate.sh --only <your-id>` prints CAUGHT and names *your* assertion.

Adding one is four fields in the catalogue at the top of `scripts/mutate.sh`:

```
M17@@scripts/your-gate.sh@@<exact text to break>@@<replacement>@@<the test.sh label that must fail>
```

- The find text must occur **exactly once** in the file. Zero or many exits 2 — a mutation anchored
  at an arbitrary one of several sites proves nothing, and a drifted anchor must be loud rather than
  a phantom survivor.
- Break the *behaviour*, not the message. Inverting an exit code, demoting a finding to a warning,
  flipping `-gt` to `-lt`, `if false`, neutering a regex, or returning the fallback instead of
  refusing are the seven shapes in the catalogue — all seven are things that really shipped here.
- The last field is a substring of the real label in `scripts/test.sh`, so the tool can tell
  "the suite noticed" from "the assertion I wrote noticed".

## When you cannot test it

Some assertions need Xcode, a simulator, or a network. **Do not fake coverage.** Add them to
`excluded()` in `scripts/mutate.sh` with the reason; they are printed with every score and counted
in neither numerator nor denominator. A mutation score that quietly omits the untestable parts is
the same lie as a green suite full of decorative assertions.

A gate with no fixture that reaches it belongs there too, with that reason — reporting it as a hole
would be a false alarm, and a tool that cries wolf gets switched off.

## Safety

Mutations are applied to a copy in `$TMPDIR`; the real tree is never written to. `.git` is not
copied (in a worktree it points at the real repository). Restore is a trap, and on exit the tool
compares `git status --porcelain` against the snapshot it took at start and fails loudly if it moved.

## Manual fallback

No Node or a hostile environment: pick the assertion you doubt, edit the line it guards to invert
it, run `sh scripts/test.sh`, and confirm **that assertion by name** is in the FAIL list. Then
`git checkout -- <the one file you edited>` — never a repo-wide revert. That is `defect-hunting`
§3's three steps done by hand: confirm the edit landed, confirm the fixture reaches it, watch it go
red and green again.
