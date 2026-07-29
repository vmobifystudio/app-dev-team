# Dry run 4 — findings

**Date:** 2026-07-29 · **Against:** `revamp/phase-1-lean` (phases 0–3 + CI) · **Hypotheses:**
`2026-07-29-dry-run-4-hypotheses.md`

First end-to-end run of the pipeline. Nine of the ten commands had never executed once. Eight roles
ran; 18 documents were produced; one real defect was found; **no false claim of progress was made
anywhere.**

## Headline

**The sprint produced zero merged code, and that is the result.** Three tickets, all `blocked`. No
`verified`, no `approved`, no `merged` in the event log. The host has no iOS SDK, every gate said
so, and each said which one it was.

The same pipeline this morning would have reported a **successful sprint** on the same machine:
`ship-gate` cleared on a renamed column, `runtime-gate` passed apps that never launched, `WAIVED:`
was enforced by nothing, and `verify-done` discarded the output it told the loop to relay. The
failure mode moved from **falsely complete** to **honestly blocked** — which for an autonomous
system is the whole point. A team that stops and says why can be left running; a team that reports
success it did not earn is worse than no team.

## Hypotheses

| # | Verdict | Evidence |
|---|---|---|
| H1 | **CONFIRMED w/ friction** | `/app-init` produced every doc; several dead references found (see DR4-003/004/012) |
| H2 | **CONFIRMED** | `docs/02-team-roster.md` written; utility+ios-app resolved; `cpo`/`cto` collapsed as designed |
| H3 | **CONFIRMED** | single-platform accepted; board built via `board.mjs add`, no hand-written rows |
| H4 | **CONFIRMED, emphatically** | spec-critic found a silent **10× money bug** in the spec before any code existed |
| H5 | **CONFIRMED** | doctor blocked twice, including against the tech-manager's own legal action |
| H6 | **CONFIRMED** | `runtime-gate` exit 2 `CANNOT EVALUATE — this is NOT a pass`; never a false PASS |
| H7 | **CONFIRMED** | QA filed BUG-001 → `BUG-001-FIX` created on the board. **First time this path has ever run** |
| H8 | **NOT REACHED** | run ended at the blocked board; `/app-ship` not exercised |
| H9 | **CONFIRMED** | metrics non-empty and correct: `gateFires {blocked:3}`, `reviewPassRate null` (nothing was reviewed — accurate) |
| H10 | **CONFIRMED** | every developer claim verified true against the repo: 15 test cases, fragment committed, files present. It reported `NOT RUN` rather than claiming green |

**Falsified: none. Not reached: H8.** Two prior runs falsified two each; this one falsified zero,
which is itself a signal — the hypotheses were written against a system that had just been hardened
for eight hours, so they were calibrated to what had already been fixed. **The friction findings
below are where the real information is.**

## The best result: a bug found by executing, not reading

`#expect(result.perPersonShare == 33.34)` **can never pass on any host.** `Decimal` is
`ExpressibleByFloatLiteral` via `Double`; `33.34` is not exactly representable, so the literal
carries `33.34000000000000512` while the calculation's Decimal arithmetic produces exactly `33.34`.

QA compiled the file standalone, ran all 34 assertions (33 passed, this one failed), then swept all
27 expected-value literals for the same artifact — only this one is affected.

**Why it matters beyond one literal:** `docs/20-architecture.md` §9 R-2 names *"rounding is the only
place this app can be wrong, and it is wrong silently"* as the app's chief risk, and designates
**this exact assertion** as the mitigation. The safeguard for the only silent-failure risk in the
app was itself non-functional. The production logic is correct; the test protecting it was not. No
review would have caught it — the code reads perfectly. This is `defect-hunting` §2 validated live.

---

## Register

Severity: **S1** breaks a run · **S2** silently wrong · **S3** friction.

### S1 — breaks a run

| ID | Finding | Where |
|---|---|---|
| DR4-001 | **`verify-done.sh` has no cannot-evaluate state for the test command.** It runs the string and branches on zero/non-zero, so *a missing toolchain* is indistinguishable from *a failing test*. It exited **1 — REJECTED**, whose literal instruction is "re-spawn the developer with these failures verbatim" — sending a developer to fix a bug that does not exist. The sprint plan predicted exit 2 and wrote a DoD rule keyed to it, so that exemption path is unreachable. `runtime-gate` distinguishes UNKNOWN from FAIL; this does not. The three-state contract was applied to two gates and missed the third. | `scripts/verify-done.sh` |
| DR4-002 | **No board state means "reviewable, but not runnable."** `board.mjs` refuses `review_requested` without a prior `verified`, and `verified` cannot honestly be written when the toolchain is absent — so a ticket blocked on the *environment* also loses *static* review, though the DoD defines four checks needing only `git diff` and `grep`. **`code-reviewer` never ran in this entire sprint.** Design gap introduced in Phase 2. | `scripts/board.mjs`, `scripts/lib/events.mjs` |
| DR4-003 | **`ceo.md`'s mandated handoff names roles that are off.** It requires ending with `NEXT: - cpo: … - cto: …`; on utility tier both are merged away. An orchestrator parsing it literally stalls or double-writes the PRD. The utility section corrects the deliverables and forgets the handoff. | `agents/ceo.md:80-82` |
| DR4-004 | **The documented pointer chain produces a backlog the pipeline cannot consume.** `ceo.md` → `cpo.md` for the backlog spec; `cpo.md` never mentions feature IDs. The mandatory `[F-NNN]` lives in `prd-builder`, which `ceo.md` never names. Those IDs are what `sprint-planner` puts on the board and what `code-reviewer`/`qa-engineer` use to fetch acceptance criteria. The agent only got it right by reading `skills/` unprompted. | `agents/ceo.md`, `agents/cpo.md:33` |
| DR4-005 | **Bug intake is unsatisfiable when the original ticket is blocked.** The rule says a `BUG-NNN-fix` inherits the owner and depends on the original *being `done`*. If the original is blocked, depending on it strands the new ticket instantly (observed: one `add` broke a board that had just been repaired); dropping the dependency is a lie. There is also no `--status` on `add`, so a row cannot be created already blocked — it takes `add` then `move`. | `agents/tech-manager.md:108`, `scripts/board.mjs` |

### S2 — silently wrong

| ID | Finding | Where |
|---|---|---|
| DR4-006 | **`spec-critic` answers are addressed to a party that will never read them.** It is not a role, appears in no org-chart row, and its own skill says not to create an agent for it — yet its example uses it as `--from`, so `answer` rows are addressed back to it. The developer received the decisions **only** because the critic folded them into the spec. Skip that fold and *the ledger renders green while the developer still guesses* — a metric that cannot fail. | `skills/spec-critic/SKILL.md`, `skills/team-protocol/SKILL.md:63-71` |
| DR4-007 | **QA bypassed the protocol entirely and nothing caught it.** `50-test-plan.md` and `51-bugs.md` were written straight into the shared tree — no branch, no commit, no ticket, no daily fragment — while the DOC profile states `Branch:` is required in both profiles. **The best artifact of the run, the BUG-001 investigation, is the one thing with no provenance record.** Invisible to the doctor, the CLI, `verify-done` and the merge gate. | `agents/qa-engineer.md`, `commands/app-build.md` |
| DR4-008 | **The board CLI upcases ticket IDs.** `BUG-001-fix` is stored and rendered as `BUG-001-FIX`, while `tech-manager.md` and `/app-build` mandate the lowercase form. Anything grepping the documented spelling misses it. | `scripts/board.mjs`, `scripts/lib/board.mjs` |
| DR4-009 | **The min-target rule is now correct and unverifiable.** Rewritten this morning from "latest major minus one" (which would emit a version Apple never shipped) to "the immediately preceding released major". The pack refuses to pin it, so the number comes from the agent's recollection with no way to check it offline. The tech-lead recorded a value and noted: *"if the model's picture of released majors is wrong, that number is wrong and nothing in this pipeline will catch it."* The failure moved out of the rule, where a reviewer caught it, and into agent knowledge, where nothing does. | `knowledge/stack-defaults.md:12` |
| DR4-010 | **Three artifacts disagree with themselves.** Three different simulator names across four files (and the sync rule names only two of them); two branch-naming conventions, with the outlier being the doc that *owns* the branch model; `23-git-strategy.md` mandates squash-merge + linear history while `tech-manager.md` mandates `git merge --no-ff`. | `docs/23-git-strategy.md`, `agents/tech-manager.md` |

### S1/S2 — found by `code-reviewer`, which ran after the register's first draft

| ID | Finding | Where |
|---|---|---|
| DR4-023 | **The generated CI cannot fail.** Both the Build and Test steps end `\| xcbeautify \|\| true`, so a failing test exits zero. It would have shipped BUG-001 green. An agent spontaneously reproduced the exact anti-pattern `defect-hunting` §3 exists to forbid — *"a rule that cannot fail is worse than no rule"* — while working in a repo built around that sentence. **S1.** No gate inspects generated CI. Add one: generated CI must not mask exit codes. | generated `.github/workflows/*.yml`; no rule in `devops-engineer` or the review gate forbids it |
| DR4-024 | **The generated CI installs a banned tool.** It runs `brew install swiftlint` and `swiftlint --strict`, while the project's own `21-engineering-principles.md` bans SwiftLint by name. Two artifacts of the same run contradicting, and the pipeline performs an **install** nobody asked for. **S1** — generated CI must not install anything, and must be checked against the project's own dependency rules. | same |
| DR4-025 | **A clearance sweep had a blind spot exactly where the money path is most fragile.** QA cleared the suite by scanning every decimal literal *used as an expected value* — 27 of them. `33.33` is an **input** literal, so it was outside the sweep, and it is the deliberate exact midpoint (`4.9995`) that certifies half-up rounding; one ulp low rounds to `4.99` and fails. The second gate caught what the first gate's *methodology* could not see. **S2** — and a lesson: a clearance claim must state the population it swept, so the gap is visible. | `docs/51-bugs.md` methodology; `defect-hunting` should name this class |
| DR4-026 | **A review that happened is mechanically invisible.** The reviewer produced a full verdict but could not append its ledger rows (`started`/`changes`) because the board is CLI-owned and it was not permitted to run the CLI. By the reviewer's own rule, a ticket with no `approved` line counts as having skipped the gate — so a real review leaves no trace. Also: `code-reviewer.md` and the board's ledger header state **two different closed sets** of ledger actions, both as strict; and the cycle number in the verdict filename is derived differently by the role file (`Cycles`=0 → `cycle-0`) than by the loop (`cycle-1`), so a downstream reader looks for a file that does not exist. **S2.** | `agents/code-reviewer.md:70-76,158`, `scripts/board.mjs` |

### S3 — friction

| ID | Finding |
|---|---|
| DR4-011 | External skills (`axiom-*`, `ui-design`, `aso-screenshots`) are referenced with no marker that they come from another plugin. An agent hunts the local `skills/` dir, fails, and files a false defect. Mark them external-and-optional at the point of reference. |
| DR4-012 | `house-conventions` claims "every IC and exec agent invokes this first" but its pack table has no row for writing a vision or PRD, so an exec invokes a skill whose entire procedure is inapplicable. |
| DR4-013 | **Exec agents have nowhere legal to record a divergence.** The rule requires logging to `docs/daily/<today>-<agent>-<ticket>.md`, which needs a ticket ID. A spec-writing exec has none — so the rule is unfollowable for exactly the roles that make the largest divergences. |
| DR4-014 | `board-doctor`'s guidance for `stranded` on a generated board says "something wrote the Markdown directly — find what did it." Wrong: `stranded` is an emergent graph property the CLI can produce legally. Sends you hunting a hand-edit that never happened. |
| DR4-015 | `runtime-gate`'s error string is truncated mid-path (`'/Library/Deve`), making the most-copied line in the round unquotable from the gate's own output. |
| DR4-016 | `runtime-gate` gives a materially different reason depending on cwd (`no project found` vs `xcodebuild unusable`), both exit 2. On a project whose `.xcodeproj` is generated and gitignored, the default answer is indistinguishable from "wrong directory". |
| DR4-017 | The standup instruction says to read fragments from `docs/daily/` on the integration branch and delete them once consumed. Fragments live on feature branches per `agent-isolation`, and deleting them means committing to a branch pending review. Unrunnable as written. |
| DR4-018 | A role was spawned before its declared inputs existed (`devops-engineer` before `20-architecture.md`), and nothing detected it. The agent handled it well — derived what it could and wrote its assumptions into the CI file — but the ordering hazard is undetected. |
| DR4-019 | An artifact was orphaned between two charters (`/project.yml`: devops owns "plumbing", iOS dev needs it to compile; neither created it). Resolved by the tech-manager finding the spec's own race note, but nothing detects an unowned artifact. |
| DR4-020 | A stray `docs/32-board-view.md` appeared untracked, mentioned in no role or skill. On a board whose premise is "one generated file, one writer", a second rendering is exactly the drift the doctor should catch and does not. |
| DR4-021 | Ceremony performed for a shape the project does not have: an Android stack section on an iOS-only app, "consult tech-lead about capacity" with one active IC, `-resolvePackageDependencies` on a project forbidden from having packages. |
| DR4-022 | The project docs pre-narrate the expected CANNOT EVALUATE outcome so thoroughly that an agent could report it without running the gate. **When the docs describe the expected result, the check becomes skippable and nobody would notice.** |

---

## The four pillars

| Pillar | Verdict | Evidence |
|---|---|---|
| **Communication** | **works** | spec-critic caught a 10× money bug pre-code; questions raised, answered, folded back into the spec; developer implemented a *resolved* contract. Three prior runs had **zero** channel usage. Flaw: DR4-006 — answers addressed to a non-role. |
| **Management** | **works with friction** | board refused twice, incl. against its own operator; manager marked blocked rather than unblocking on a lie; recorded an inapplicable rule as `N/A` with a citation. Friction: DR4-005, DR4-008. |
| **Orchestration** | **works with friction** | right roles, right order, correct collapse on utility tier. Friction: DR4-018 (role before its inputs), DR4-019 (orphaned artifact), DR4-003 (handoff to off-roles). |
| **Efficient workflow** | **weakest** | only **two roles ever acted on the board**; `code-reviewer` never ran at all (DR4-002). Waste: re-reads from role/project contradictions (DR4-004, DR4-012), ceremony for absent platforms (DR4-021), a false-defect hunt (DR4-011). |

## What this changes

1. **DR4-002 is the most expensive finding.** A strict state machine without a lane for
   inspectable-but-not-runnable work cost this sprint its entire review stage. Fix before anything
   else.
2. **DR4-001 completes the three-state contract.** Two gates have it; the most-used one does not.
3. **DR4-007 and DR4-006 are the same class**: a process that renders green while the thing it
   measures did not happen. Both are "rules that cannot fail", which this codebase calls worse than
   no rule.
4. **Zero hypotheses falsified is not a victory.** They were written against a system hardened
   hours earlier and were calibrated to known fixes. The 22 friction findings are the yield.
   Next run's hypotheses should target the *unknown* — the review stage, `/app-ship`, and a second
   round with a real merge.
