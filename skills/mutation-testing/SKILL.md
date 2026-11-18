---
name: mutation-testing
description: Use when adding or reviewing a gate, guard or test assertion — and whenever a green suite needs to prove it can go red. Used by code-reviewer and verification-engineer. mutate.sh covers this plugin's own scripts only; app projects revert the diff instead.
---

# Mutation testing

`defect-hunting` §3 says a new rule is not done until you have watched it fail. Done by hand, that
is done only when someone remembers — and a fully green suite can hide assertions that cannot fail.

**A green suite is evidence only to the extent its assertions can go red.** `scripts/mutate.sh` is
that, executable — **for this plugin's own `scripts/` and `hooks/` only.** Its catalogue names
plugin files and its runner is `scripts/test.sh`; it cannot mutate an app project.

## On an app project

Mutation-test the project's own suite against the ticket's diff: revert the diff's changed
production lines (in a scratch copy or throwaway worktree, never the shared tree), run the new
tests, and confirm they **fail**; restore the lines and confirm they pass. A new test that stays
green with the change reverted proves nothing about the change. Report it as
`Mutation: reverted <file:lines> -> <test> FAILED as expected`, or name the test that survived.

## Running it

```sh
sh scripts/mutate.sh                # every catalogued mutation (85 today: --list | grep -c '^M[0-9]')
sh scripts/mutate.sh --list         # the catalogue, plus what it cannot test and why
sh scripts/mutate.sh --only M04     # one mutation (or a list: --only M38,M39), while you iterate
sh scripts/mutate.sh --sample 4     # what CI runs on every PR
sh scripts/mutate.sh --full-suite   # run the whole suite per mutation instead of its section
```

By default each mutation runs only its `test.sh` section, which takes seconds; that can hide the
"CAUGHT, but NOT by the assertion written for it" verdict, so the nightly full run passes
`--full-suite`.

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
M87@@scripts/your-gate.sh@@<exact text to break>@@<replacement>@@<the test.sh label that must fail>
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
