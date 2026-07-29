# Failure corpus — what this codebase actually produces

The rest of `knowledge/` learns from success: `/app-learn` mines **shipped** apps and folds their
conventions into the packs. Nothing accumulated failures. One day of running this system produced 27
dry-run findings and 16 review findings, every one of them in a Markdown document no agent reads as
normative — and none of it would have reached the next project.

That matters because the same defect **class** recurred three times inside that single day. A fix
landed in the mechanism and stopped before the consumer: board IDs were re-upcased by three readers;
`verified_static` was added to the vocabulary but unreachable from the loop and invisible to the ship
gate; `integration-branch` was hardened against an input the pipeline never produced. Had a corpus
existed after the first instance, the second and third were a grep away.

**This file is prior information about the defects this codebase actually ships.** It beats a
generic review checklist for one reason: a generic checklist is a list of what *could* go wrong,
weighted by nothing. Every line below is weighted by an incident that happened here, with a date.

## How to use it

- **Reviewing a diff** (`code-reviewer`): run every **Tell** against the diff. They are greps and
  questions, not judgement calls. A hit is a finding, not a discussion.
- **Certifying a rule** (`verification-engineer`): before you certify a new rule, check it against
  FC-002 and FC-006 — most rules that fail do so by being unable to go red, or by keying on a proxy
  that was absent in the incident they were written for.
- **After a run** (`/app-learn --failures`): harvest `docs/research/*-findings.md` and
  `docs/80-audit.md` into these classes. **Dedupe into an existing class; never append incidents
  forever.** A class with forty instances and no new shape is a changelog, not knowledge.

## How to read an entry

Every class carries five fields, and the parse in `scripts/team-doctor.mjs` requires all of them:

| Field | Why it exists |
|---|---|
| **Shape** | the abstract defect, stated without reference to the file it happened in |
| **Tell** | what a reviewer *greps or asks*. If you cannot mechanise it, the class is not finished |
| **Rule** | the thing that now catches it — an executable check, named by path |
| **Rule shipped** | the date that rule landed. This is the recurrence datum |
| Instances | dated rows. **An instance dated after `Rule shipped` is a RECURRENCE** |

**The recurrence flag is the most valuable output of this file.** A class that recurs *after* its
rule shipped is proof the rule does not work — which is a strictly more useful fact than the
incident itself. `team-doctor` fails on it (`corpus_recurrence`). The exit is not to delete the
instance: it is to strengthen the rule and stamp a new `Rule shipped` date, which is a claim you are
now on the hook for.

---

### FC-001 — The fix that stops one layer short

**Shape:** a defect is repaired in the mechanism that *produces* a value, and every consumer that
*reads* it is left on the old assumption. The fix is real, its test passes, and the bug survives
intact in every reader. The commit message is true and the system is still broken.

**Tell:** the diff touches one file. Grep the whole repo for the symbol, format, event name or path
whose meaning just changed and count the call sites — `grep -rn '<the thing>' agents commands skills
scripts`. If the grep returns more sites than the diff touches, the fix stopped short. Ask the
producer-side question out loud: *who reads this, and did they change?*

**Rule:** `scripts/test.sh` asserts the dashboard and `board.mjs` agree on every ticket's status —
one parser, proven by agreement rather than by an import grep. `scripts/team-doctor.mjs`'s doc graph
(`doc_writer_silent`, `doc_unread`) catches the documentation-side form. `agents/code-reviewer.md`
requires a producer-side fix to name its consumers in the verdict.

**Rule shipped:** 2026-07-29

| Date | Instance |
|---|---|
| 2026-07-29 | DR4-008 — the board CLI stopped upcasing ticket IDs; `parseDependencies`, the doctor and the renderer kept upcasing, so `BUG-001-fix` still rendered `BUG-001-FIX` and the documented spelling still grepped to nothing |
| 2026-07-29 | `verified_static` was added to the event vocabulary, and was unreachable from the `/app-build` loop and invisible to `ship-gate.sh` — the state existed and nothing could enter or observe it |
| 2026-07-29 | `integration-branch.sh` was hardened against a malformed input that no step in the pipeline ever produced |

---

### FC-002 — The rule that cannot fail

**Shape:** a gate, test or assertion structurally incapable of a red outcome — or, its mirror, one
incapable of a green outcome. Either way the result is fixed independent of the system under test.
It reads as protection and supplies none, and it is worse than no rule because it consumes the
attention that would have gone to a real one.

**Tell:** `grep -nE '\|\|[[:space:]]*(true|:)([[:space:]]|$)|continue-on-error:[[:space:]]*true'`
over any CI or script. A build/test command piped into a formatter with no `pipefail`. A test whose
expected value is computed by the code under test. An assertion over a JSON blob that does not
distinguish a blocking finding from a warning. Then the direct question: **what input makes this
print red?** If you cannot name one, it is this class.

**Rule:** `scripts/ship-gate.sh` §5 blocks masked exit codes and unguarded pipes in generated CI.
`CONTRIBUTING.md` requires every new rule to be watched failing once before it is trusted, and
`scripts/test.sh` carries the assertion for each. `skills/defect-hunting` §3 is the prose.

**Rule shipped:** 2026-07-29

| Date | Instance |
|---|---|
| 2026-07-29 | DR4-023 — the generated CI ended both Build and Test with `\| xcbeautify \|\| true`, so a failing test exited zero. It would have shipped a live money bug green, in a repo built around the sentence forbidding it |
| 2026-07-29 | `#expect(result.perPersonShare == 33.34)` could never pass on any host: the `Decimal` literal is `ExpressibleByFloatLiteral` via `Double`. The designated mitigation for the app's only silent-failure risk was itself non-functional, and the code reads perfectly |
| 2026-07-29 | `assert_finding` in the suite grepped the whole doctor JSON, so a check demoted from a finding to a warning still passed — a rule that cannot fail, inside the test file |

---

### FC-003 — Green while nothing happened

**Shape:** the *record* of a process is written although the process did not run. The ledger renders
clean because the reporting step happened, not the work. Distinct from FC-002: the check here is
capable of failing, it just measures the report instead of the event.

**Tell:** for every green signal, name the artifact that would exist **only if the work actually
ran**, and confirm it exists at the path claimed. Grep for states reachable without their
precondition: a message addressed to a party that is not a role, a document committed with no branch
and no daily fragment, a test-plan row reading `NOT PERFORMED` / `by reading` counted as tested,
docs that pre-narrate the expected gate outcome so the gate becomes skippable.

**Rule:** `scripts/team-doctor.mjs`'s doc graph refuses an artifact with no declared writer;
`studio-dashboard.mjs`'s provenance panel surfaces work with no commit behind it;
`agents/code-reviewer.md` requires the evidence path and its commit to be cited, not asserted.

**Rule shipped:** 2026-07-29

| Date | Instance |
|---|---|
| 2026-07-29 | DR4-006 — `spec-critic` answers were addressed to a party that will never read them. The developer got the decisions only because the critic folded them into the spec; skip that fold and the ledger renders green while the developer still guesses |
| 2026-07-29 | DR4-007 — QA wrote `50-test-plan.md` and `51-bugs.md` straight into the shared tree: no branch, no commit, no ticket, no fragment. The best artifact of the run was the one thing with no provenance record |
| 2026-07-29 | DR4-022 — the project docs pre-narrated the expected `CANNOT EVALUATE` so thoroughly that an agent could report it without running the gate |
| 2026-07-29 | DR4-026 — a full review verdict was produced and no ledger row could be appended, so by the reviewer's own rule the gate counts as skipped. A review that happened is mechanically invisible |

---

### FC-004 — The gate that fails open on a renamed input

**Shape:** a check keys on a literal — a column header, a field name, a path, a flag spelling — and
when that literal moves it matches nothing and prints the passing value. **Absence of input is read
as absence of problem.** The gate is loudest exactly when it has stopped working.

**Tell:** find every `grep -c`, awk field index, column lookup and `[ -f ]` in a gate and ask: *what
does this print when the file is missing, empty, or renamed?* If the answer is the passing value, it
fails open. Watch for POSIX traps that match nothing silently — `[^\n]` in a bracket expression is
"not backslash, not the letter n". Run the gate against a deliberately renamed input and confirm it
says UNKNOWN rather than CLEAR.

**Rule:** house rule 3 — gates fail closed, and "cannot evaluate" is a distinct loud outcome, never
CLEAR (`ship-gate.sh`, `runtime-gate.sh`, `verify-done.sh` all exit 2). `ship-gate.sh` delegates the
in-flight check to `ship-inflight.mjs` through `lib/board.mjs` — one parser, no second reader.
`scripts/test.sh` removes each required artifact in turn and asserts exit 2.

**Rule shipped:** 2026-07-29

| Date | Instance |
|---|---|
| 2026-07-29 | `ship-gate`'s inline awk cleared a release on a renamed board column, and fail-opened four separate ways. It was the counterexample that produced the one-parser rule |
| 2026-07-29 | `grep -cE '...[^\n]*...'` reported 0 open S1/S2 bugs while two were open — a ship gate failing open inside the script written to stop gates failing open. Only visible because the behaviour differed between the interactive shell and `sh` |
| 2026-07-29 | `runtime-gate` passed apps that never launched, and `WAIVED:` was enforced by nothing — a line no script wrote and no script read was the only route from a non-pass to a release |

---

### FC-005 — The check whose own input nobody writes

**Shape:** a rule reads an artifact, field or exit code that **no step in the pipeline produces**. It
never fires. The Definition of Done cites it, everyone believes it is covered, and no writer was
ever assigned. The inverse of FC-001: here the consumer shipped and the producer never did.

**Tell:** for every artifact a rule reads, name the step that writes it — a specific agent, command
or skill file. `node scripts/team-doctor.mjs` reports `doc_undeclared` (no writer) and `doc_unread`
(no reader). For an exit code, run the producing script and confirm it can actually emit that code;
a DoD keyed to exit 2 is decorative if the script only ever returns 0 or 1.

**Rule:** `scripts/team-doctor.mjs` `DOC_WRITERS` — every artifact declares its writer, and a writer
that stops mentioning its artifact is a blocking finding (`doc_writer_silent`). Adding a `docs/NN-*`
artifact without a `DOC_WRITERS` row fails the doc-graph check by construction.

**Rule shipped:** 2026-07-29

| Date | Instance |
|---|---|
| 2026-07-29 | DR4-001 — the sprint plan wrote a DoD exemption keyed to `verify-done.sh` exit 2, a state `verify-done.sh` could not emit. The exemption path was unreachable from the day it was written |
| 2026-07-29 | DR4-019 — `/project.yml` was orphaned between two charters: devops owned "plumbing", the iOS developer needed it to compile, neither created it. Nothing detects an unowned artifact |
| 2026-07-29 | DR4-013 — exec agents were required to log divergences to `docs/daily/<today>-<agent>-<ticket>.md`, which needs a ticket ID they do not have. The rule is unfollowable for exactly the roles that diverge most |

---

### FC-006 — The proxy trigger that misses the incident it was written for

**Shape:** a guard fires on a *proxy* for the hazard rather than the hazard itself, and the proxy was
absent in the very incident that motivated the guard. The rule is green in exactly the configuration
it exists to catch. This is the most embarrassing class in the corpus and the hardest to see, because
the rule is correct-looking, tested, and about the right topic.

**Tell:** **replay the originating incident against the new rule before trusting it.** Reconstruct
the incident's actual configuration — not a convenient variant — and watch the rule fire. If the
rule keys on a precondition the incident did not have (worktrees existing, a config file present, a
flag set, a particular cwd), it is a proxy. Also treat any rule whose correctness now depends on an
agent's recollection as this class: the failure moved out of where a reviewer could catch it.

**Rule:** `scripts/test.sh` runs the destructive-git hook assertions in the exact DR4-027
configuration — dirty tree, **no** worktrees — because the first version of that hook keyed on
worktrees existing and was silent in the state it was written for. `CONTRIBUTING.md`: a new rule is
replayed against its motivating incident, and portability traps (BSD vs GNU `sed`) are covered,
because a rule that fails to parse its own input allows everything.

**Rule shipped:** 2026-07-29

| Date | Instance |
|---|---|
| 2026-07-29 | DR4-027 — the destructive-git hook keyed on worktrees existing; the incident happened with no worktrees, so the hook was silent in its own incident. 22 files and 332 insertions were discarded; recovery was luck |
| 2026-07-29 | the hook's first version extracted its payload with a GNU-only `sed` alternation that BSD `sed` fails silently — the command came back empty and it allowed everything. Written on the day this repo spent hunting rules that cannot fire |
| 2026-07-29 | DR4-009 — the min-target rule was rewritten from a checkable formula to "the immediately preceding released major", moving the failure out of the rule, where a reviewer caught it, and into agent knowledge, where nothing does |
| 2026-07-29 | DR4-025 — a clearance sweep covered every decimal literal used as an *expected* value, 27 of them. The defect was in an **input** literal, outside the sweep's population. A clearance claim must state the population it swept |
