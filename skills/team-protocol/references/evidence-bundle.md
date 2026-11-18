# team-protocol §Evidence bundle — what makes a test claim believable

Loaded by `qa-engineer`, `test-automation-engineer` and `release-auditor`. The twelve field names are also listed in `team-protocol` SKILL.md, which `team-doctor` checks.

A test result is a **claim by the actor that ran it**. `release-auditor` will not accept one, and
neither should anyone else, unless it resolves to a discoverable evidence bundle.

**A test claim with no discoverable evidence bundle stays `unverified`.** Not failed — unverified,
which is a different and more honest thing: nobody knows. A release whose critical journeys are
`unverified` does not ship.

Bundles live at `docs/54-evidence/<journey>-<build-id>.md`, one per critical journey per build,
written by `qa-engineer` and `test-automation-engineer`. Twelve fields, every one required:

| Field | Why it is required |
|---|---|
| `Build id:` | which artifact — a result about another build is about another product |
| `Device:` | the device class from the matrix, named, not "a phone" |
| `OS:` | version, because the defect is usually version-specific |
| `Inputs:` | the exact inputs used, so the run can be repeated |
| `Screenshot/recording:` | a path in the repo — the thing a human can look at |
| `Logs:` | a path — what the machine saw while the human was looking |
| `Analytics events:` | the events actually emitted, because instrumentation is a shipped feature too |
| `Result:` | `pass` · `fail` · `unverified`, and nothing else |
| `Requirement IDs:` | what this proves, back to `docs/10-prd.md` — a result proving nothing is noise |
| `Tester identity:` | which agent or human ran it, so self-approval is visible |
| `Timestamp:` | ISO 8601, so ordering against the build is checkable |
| `Artifact hash:` | ties the evidence to the binary — this is what stops evidence drifting builds |

A field you cannot fill is not omitted: write it with `unknown` and set `Result: unverified`. An
omitted field reads as a bundle that passed, which is exactly the failure this contract exists to
stop.
