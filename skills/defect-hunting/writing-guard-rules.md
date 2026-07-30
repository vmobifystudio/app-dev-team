# Writing guard rules that can actually fail

Reference for the `defect-hunting` skill §3. Read this when you are **authoring** a shell guard,
CI grep, lint rule, or architecture test. Reviewing a diff does not need it.

The rule it serves stays in the skill: *a rule that cannot fail is worse than no rule — it reports
success, and that stops people looking.*

## Shell guards fail open by default

The most common unfailable rule is not a `contains()` in application code — it is a shell check
whose exit status comes from the wrong command:

```bash
grep -E "pattern" file | sed 's/^/  /' || echo "NOT FOUND"    # sed succeeds on empty input
cmd | head -1 || handle_error                                  # head's status, not cmd's
[ -n "$(grep x f)" ] && ok                                     # fine, but silent when grep errors
```

A pipeline's status is the *last* command's. Gate on the test itself — `if ! grep -q ...; then` —
and prove it by running the guard against an input you know should fail it.

## `[^\n]` is not "any character except newline"

In a POSIX bracket expression it means "not a backslash and not the letter n". `grep` is
line-oriented, so `.` already excludes newlines — write `.*`.

Using `[^\n]*` made a release gate report zero open blocker bugs while two were open, and the
behaviour differed between an interactive shell and `sh`, so it passed by hand and failed in the
script. This was violated while writing the rules against it: a merge-gate precondition printed
nothing, returned success, and let a merge through.

## Before you commit the guard

Run the three-step proof in `SKILL.md` §3 *Mandatory: prove the rule can fail* — confirm the
mutation applied, confirm the fixture reproduces the real condition, then watch it go red and
green again. Skipping either of the first two looks exactly like success.
