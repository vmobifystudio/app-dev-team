# team-protocol §Evidence — what makes a test claim believable

Loaded by `qa-engineer`, `test-automation-engineer` and `release-auditor`.

A test result is a **claim by the actor that ran it**. `release-auditor` will not accept one unless
it resolves to a record a script wrote, not one an agent typed.

**A test claim with no discoverable evidence stays `unverified`.** Not failed — unverified: nobody
knows. A release whose critical journeys are `unverified` does not ship.

The records, and what binds each:

| Record | Written by | Bound by |
|---|---|---|
| `docs/team/journey-result.json` + screenshots (SHA-256 each) | `journey-gate.mjs` | `evidence-check.mjs --head`, `release-candidate.mjs verify` |
| `docs/54-evidence/journeys/` | `journey-gate.mjs` | the digest in the result above |
| `docs/team/evidence/` (test, runtime logs) | `verify-done.sh`, `runtime-gate.sh` | `evidence-check.mjs` |

Why no hand-written bundle: twelve typed fields duplicated what these scripts record, nothing checked
them, and an agent can type any of them. A manual exploratory pass may add free-text notes next to
the record; the notes are context, never the evidence.
