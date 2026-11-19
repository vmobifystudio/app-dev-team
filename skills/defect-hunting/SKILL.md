---
name: defect-hunting
description: On an app-dev-team project, use when reviewing code, auditing an app, writing a guard rule or test, or certifying a threshold/constant. Used by code-reviewer, qa-engineer, verification-engineer, red-team-agent and /app-audit.
---

# Defect hunting

> Verify the thing that has to be true, not the thing you changed.

Filtering the list is not filtering the parser. Matching the token is not matching the value.
Mutating the file is not confirming the mutation landed.

This file is §1, which every caller needs. The other sections are in `references/` — **read the one
the situation names, and only that one.**

| § | Read it when | File |
|---|---|---|
| 1b | a diff adds a function, component, type, constant or route — prove it has a real caller and its required co-changes (test file, migration, route registration, (de)serialization) exist | `references/1b-reachability.md` |
| 2 | a change adds or edits a threshold, bound, formula, table or rate with a clinical, financial or safety claim — execute it across its range against reference data, never certify by reading | `references/2-execute-constants.md` |
| 3, 3b | you write, review or certify a guard rule, lint rule, CI grep, baseline, or a new/changed test — prove it can fail (mutation applied, fixture reproduces the real condition, red then green) | `references/3-rules-and-tests-that-cannot-fail.md` (authoring a shell guard: also `references/writing-guard-rules.md`) |
| 4 | you own a findings register, an audit, or a sweep — stable IDs, never-blank status, two independent searches for "not found" | `references/4-findings.md` |
| 4b | a change touches a value a user supplies, sees or is told — follow the user's value **across the boundary**: name the read line and the write line, run the round trip with a **distinguishable value** (`1999-01-02`, not today; `73`, not `0`), measure on-device what the spec quantifies, and **reintroduce** the defect to watch the regression test fail | `references/round-trip.md` |
| 5 | always, on a review or audit — run every Tell in `${CLAUDE_PLUGIN_ROOT}/knowledge/failure-corpus.md` and cite the class ID (`FC-004`); a class that recurs after its rule shipped is the most valuable output in the system | below |
| — | attaching a checklist to a `code-reviewer` or audit verdict | `references/review-checklist.md` |

---

## 1. Audit the data's entry points, not the screens

A review organised by screen structurally cannot find the expensive defects: **the audited surface
is correct and the bug is in the second path to the same data** — usually another file, often
another module. The validated add form beside an edit path that validates nothing; the reader beside
a writer that destroys data; the picker's success branch beside a cancel branch that wipes the
existing photo; the purchase flow beside the still-loading entitlement state that paywalls a paying
customer; sync's happy path beside its `RECONCILE_FAILED` branch.

### The question that does the work

> **"What is the second way this value gets written?"**

And its siblings: what is the second way it gets *read*? What happens on cancel? On failure? On
restore? On import? On sync? On each remaining enum case?

### Procedure

Before approving or making any change that touches persisted or user-visible state:

1. Name the data the change touches — the field, the row, the preference, the entitlement.
2. **Enumerate every writer.** `grep` the field name across the whole repo, not the module —
   prefer `ast-grep` where the language has one, because text search false-negatives on a renamed
   reference or a match inside a comment or string. Create, edit, import, sync, restore, migration,
   reset-to-default, and every failure branch.
3. **Enumerate every reader**, same way.
4. Show the invariant holding **on each one**. A validation that one producer applies and another
   walks around is not a validation.
5. If you cannot enumerate them, say so — do not approve on the strength of the path you read.

A one-line fix at the shared choke point beats a guard in every caller, and it is also the *lazier*
fix. Patching only the path the ticket names leaves every sibling caller broken.

## 5. Use the prior — `${CLAUDE_PLUGIN_ROOT}/knowledge/failure-corpus.md`

The rules here are general. The corpus is what *this* codebase has actually produced — one class
per defect shape, each with dated instances and the rule that now claims to catch it. Run its
**Tells** before you improvise your own. Two obligations: **cite the class ID** in any finding it
produced, and treat a class that recurs after its `Rule shipped` date as proof the rule does not
work — `team-doctor` fails on it and `/app-learn`'s failure pass feeds it. The corpus is downstream
of this skill, not a replacement: §1–§4 are how you find a defect nobody has named yet.

Anything you did not check is stated as unchecked in the verdict. An unstated gap reads as a cleared
one.
