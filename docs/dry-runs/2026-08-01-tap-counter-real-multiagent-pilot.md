# Tap Counter — third dry run: real multi-agent execution, not simulation

**Date:** 2026-08-01
**Pilot:** `dry-runs/tap-counter`
**Run by:** Claude Code, as the studio's own orchestrator — genuinely isolated `Agent` tool
spawns of the plugin's real subagent types (`ceo`, `tech-lead`, `devops-engineer`,
`tech-manager`, `android-developer`, `code-reviewer`, `qa-engineer`), each a separate process
with no memory of the others' internal reasoning, communicating only through the same durable
files and CLIs a real team would use.
**Comparison baseline:** the two earlier same-day pilots
([android-small-app](./2026-08-01-android-small-app.md),
[daily-reading-log](./2026-08-01-daily-reading-log-workflow-review.md)) — both explicitly named
"real multi-agent execution" as their sharpest unproven gap: their artifacts were produced by one
session simulating role identities sequentially. This run exists specifically to close that gap.
**Primary objective:** prove the founder's own stated success criterion — "real tickets, real
code, a real code review with at least one round of changes requested, and QA signing off before
it's called done" — with genuinely isolated agents, not narration.
**Change boundary:** only the dry-run fixture and this report were created. No plugin source was
intentionally edited during the run; concrete findings below are handed off, not fixed in place.

## Verdict

**The gap is closed.** This was real multi-agent execution: seven separate agent spawns, each
with no shared memory of the others' reasoning, coordinating entirely through the same durable
board, files, and CLI this repo's own team uses. The founder's exact success criterion happened,
for real, with evidence:

```
requested (17:55) → started (17:56) → changes (17:56) → requested (18:02, after a real fix cycle)
  → approved (18:12) → merged (18:16)
```

Fifteen real board events, a real git merge with a real conflict encountered and resolved, a real
QA pass with real device testing, one real (correctly-scoped, non-blocking) bug filed. Along the
way, the agents surfaced **four genuine plugin-level defects** that no single-session simulation
could have found, because they only exist when isolated processes actually touch the same shared
state concurrently or in the wrong order.

## What actually happened, step by step

1. **Founder intent recorded for real** — `founder-intent.mjs --write` hash-recorded a genuine
   brief, not a template.
2. **Roster computed against the real matrix** (by the orchestrator, following
   `skills/role-activation/SKILL.md` exactly) — utility tier, android-app: `ceo` absorbs `cpo`,
   `tech-lead` absorbs `cto`, `android-developer` is the only implementation IC, `ux-architect`/
   `product-designer` off (one screen), `aso-specialist` on by matrix default but not exercised
   (scope stops before `/app-ship`).
3. **`ceo`** (isolated spawn) wrote vision, PRD, and backlog in one utility-tier founder pass.
   Found and flagged, unprompted: rotation/config-change survival wasn't explicit in the brief
   ("persists across restarts" doesn't strictly cover it), no accessibility floor was named, first-
   launch state was undefined. Turned each into an explicit decision or ticket rather than leaving
   it implicit.
4. **`tech-lead`** (isolated spawn, absorbing `cto`) wrote architecture, engineering principles,
   and the implementation spec. Diverged from the house knowledge pack's `minSdk 23` guidance to
   `24`, with recorded reasoning (the KB floor exists for ad-mediation SDKs this app has none of).
   Chose DataStore with atomic `edit {}` read-modify-write specifically to close a real concurrency
   race the PRD's "50 rapid taps" criterion implies. **Found a real environment bug**: the system
   `ANDROID_HOME` env var pointed at a path that does not exist; the real SDK was elsewhere.
   Refused to claim `connectedDebugAndroidTest` would pass without running it.
5. **`devops-engineer`** and **`tech-manager`** ran in parallel. `devops-engineer` built a genuinely
   working Android skeleton and **caught a real AGP 9.0.1 plugin-conflict bug** (the separate
   `org.jetbrains.kotlin.android` plugin is now rejected outright) that would have blocked the
   developer's first build had it shipped as tech-lead's spec literally described. Verified the
   wrapper for real: `./gradlew assembleDebug` produced a genuine unsigned APK.
   `tech-manager` created four real tickets via `board.mjs add` with `--file`-derived risk (all
   `medium`, policy default) and **found a real bug in `risk-router.mjs`'s policy**: the `critical`
   rule's `store` substring is case-sensitive-fragile and would false-positive on an ordinary
   lowercase `store`-named Android file.
6. **`qa-engineer`** wrote a 14-case test plan in parallel with the two above, correctly ending
   with `QA VERDICT: HOLD` since nothing existed to test yet.
7. **`android-developer`** implemented APP-001 in an isolated worktree/branch: real DataStore
   wrapper, real ViewModel, real Compose screen, real unit tests including a 1,000-concurrent-
   increment race test on real threads, and one real instrumented UI test executed on a live
   booted emulator. All green, for real, before handoff.
8. **Orchestration mistake, caught by the system itself**: the orchestrator sent the ticket
   straight to `code-reviewer` without routing it through `tech-manager`'s `verify-done` →
   `verified` → `review_requested` sequence first. `code-reviewer` correctly refused to forge that
   board transition — it still did the real review and recorded its findings to a file, then named
   the exact fix. This is the event-sourced board's transition-legality guard working exactly as
   designed, catching an orchestration bug a narrated simulation would never have hit.
9. **`tech-manager`** ran the real `verify-done.sh` (which first correctly rejected a naive test
   command that proved nothing, then accepted one that read real JUnit XML) and moved the ticket
   to `review_requested`.
10. **`code-reviewer`** did a genuine adversarial review and returned **REQUEST CHANGES** with
    three real, measured findings: an increment button that renders at 24dp instead of the
    required 56dp (a Compose modifier-ordering bug, confirmed with real on-device `uiautomator`
    measurements, not inferred), TalkBack announcing a stale "Count: 0" before the real value
    loads, and a device test that exercised its own local stub instead of the actual app. Also
    independently judged a developer-flagged AndroidX permission as a genuine non-issue, with
    reasoning, rather than reflexively flagging it.
11. **`android-developer`** fixed all three for real, with measured before/after evidence
    (24.0dp → 56.0dp on the real device), and re-ran the full suite green.
12. **`tech-manager`** re-verified and re-routed to review (cycle 1/2).
13. **`code-reviewer`** did a genuine independent re-verification — re-measured the button itself
    rather than trusting the developer's numbers, and **spontaneously reintroduced the original bug
    in a scratch edit to prove the new regression test actually catches it** (this repo's own
    "prove it can fail" discipline, applied by the agent without being told to) — then **APPROVED**.
14. **`tech-manager`** merged for real. Hit a real `git merge --squash` conflict from stale
    untracked files left over from an earlier attempt, diagnosed the actual cause (not a symptom),
    resolved it, and merged cleanly. Confirmed post-merge that `board-doctor` still reports
    coherent.
15. **`qa-engineer`** ran the real suite again against the merged code on `main`, executed a real
    device pass (rotation, dark mode, font scale, and two real process-death scenarios — one of
    which required `adb root && kill -9`, since a plain `am kill` was a no-op on the foreground
    process), filed one real S4 bug (dark mode isn't implemented — cosmetic, non-blocking, correctly
    scoped), and wrote a `QA VERDICT: PASS` line explicitly scoped to APP-001 only, explicitly
    stating the other three tickets remain unbuilt.

## Confirmed real, independently, by the orchestrator

```
$ cat docs/31-board.md   # review ledger, generated from the event log
requested (17:55:33) → started (17:56:28) → changes (17:56:33)
  → requested (18:02:28) → approved (18:12:59) → merged (18:16:22)

$ wc -l docs/31-board-events.jsonl
15

$ node scripts/board-doctor.mjs docs/31-board.md
Board is coherent. Safe to spawn.

$ git log --oneline main
bfca9a8 Merge APP-001: Build the single screen: count display + increment button
5ab3e40 chore: init tap-counter dry-run fixture

$ grep "QA VERDICT" docs/50-test-plan.md
QA VERDICT: PASS — scoped to APP-001 (F-001) only. ...
```

## New findings — genuine plugin-level defects this run surfaced

These could only be found by real isolated processes touching shared state, not by a single
session narrating what agents would do.

### DR-TC-P0-001 — `board.mjs` run from inside a worktree forks the event ledger

An agent operating with `cwd` inside `.agent-wt/<TICKET>` and calling `board.mjs` reads/writes a
**separate copy** of `docs/31-board-events.jsonl` inside the worktree, not the real one at the
project root — because a worktree is a separate working directory with its own relative-path
resolution. In this run the fork stayed a strict subset of the real ledger (every event that
landed in the fork also landed in the root file via a later call from the project root), so no
data was lost — but that was luck, not a guarantee. Two isolated agents each convinced they are
writing the single source of truth is exactly the failure the event-sourced board was built to
prevent.

**Required fix:** `board.mjs` should resolve `--log`/`--board` relative to the git repository
root (or refuse to run with an unclear ambiguity) rather than the process's `cwd`, so a worktree
can never silently fork the ledger.

### DR-TC-P0-002 — `--bind` takes the wrong commit when invoked from inside a worktree

`board.mjs move ... approved --bind` computes the bound commit via `git rev-parse HEAD` in the
process's `cwd`. Run from inside a per-ticket worktree, that is the ticket branch's HEAD (correct).
Run from the project root — which is where `board.mjs` must now be invoked to avoid
DR-TC-P0-001 — `HEAD` is whatever `main` happens to be, not the reviewed branch. The two fixes are
in tension as written; whichever role runs `--bind` needs an explicit `--commit <sha>` escape
hatch rather than relying on `cwd` to always be the right worktree.

### DR-TC-P0-003 — squash-merge git strategy breaks `requireApprovalBinding`'s ancestor check

This project's `docs/23-git-strategy.md` (written by `devops-engineer`, a real project-specific
decision) mandates squash-merge with linear history — directly conflicting with
`agents/tech-manager.md`'s documented `git merge --no-ff`. Under squash-merge, the approved commit
SHA is **never an ancestor of the integration branch** after merge, because squash creates a brand
new commit. `approval-check.mjs`'s binding verification (`git merge-base --is-ancestor`) would
fail to find a legitimately approved, legitimately merged commit as an ancestor of `main` on any
project using this git strategy. `requireApprovalBinding` is not enabled on this dry-run project
(no `.studio-policy.json`), so this did not fire here — but it would on the first real project that
combines squash-merge with that P0 trust control on.

**Required fix:** either `approval-check.mjs` needs to accept a squash-merge commit whose message
carries the approved SHA (as `tech-manager` did by hand this run) as a valid binding, or the
plugin's own git-strategy guidance needs to state plainly that squash-merge and
`requireApprovalBinding` are incompatible as currently implemented.

### DR-TC-P1-004 — `risk-router.mjs`'s `critical` rule's `store` token is unanchored and case-fragile

The critical-risk rule matches the bare substring `store` (case-sensitive in this instance, so
`CounterStore.kt` escaped only because of its capital S). A lowercase variant — `counterstore.kt`,
or any file under an ordinary `store/` package, a common Redux/DataStore naming convention in
mobile codebases — would route as `critical`, demanding a security review and runtime evidence for
what is often an unrelated local-state file. The rule is clearly aimed at *app store* / storefront
submission work.

**Required fix:** anchor the pattern to the actual intent — something like
`app.?store|play.?store|storefront` — rather than a bare `store` substring.

## What worked — genuinely, not narrated

1. **Founder-intent recording, real hash verification.**
2. **Role-activation matrix, computed correctly** for a novel tier/product-type/scope combination
   not seen in either prior dry run.
3. **Non-trivial, well-reasoned technical decisions** made independently by isolated agents:
   `ceo` surfacing implicit requirements the brief didn't state; `tech-lead` diverging from house
   defaults with recorded justification and closing a real concurrency race by construction;
   `devops-engineer` catching a real toolchain compatibility break before it could cost the
   developer their first build.
4. **The event-sourced board's transition-legality guard caught a real orchestration mistake** —
   an illegal `changes` event was refused rather than silently accepted, and the refusal correctly
   pointed at the actual missing step.
5. **`verify-done.sh`'s "green while nothing happened" defense worked as designed** — it rejected
   a test command that proved `BUILD SUCCESSFUL` but not that a suite ran, and only accepted a
   command that read real JUnit XML evidence. Initially looked like a possible bug in this run's
   first report; independently re-checked and confirmed it was the gate working correctly.
6. **A genuine adversarial code review found genuine, measured bugs** — not manufactured for the
   pilot — including a real device measurement (24dp vs. the required 56dp) and a real
   accessibility defect, and distinguished a real non-issue (the AndroidX permission) from a real
   problem with actual reasoning in both directions.
7. **A reviewer applying this repo's own mirror-testing discipline unprompted** — reintroducing a
   bug to prove its regression test would actually catch it, then reverting, before approving.
8. **A real merge conflict, encountered and correctly diagnosed to its root cause** (stale
   untracked files from an earlier attempt, not a code conflict), not scripted around.
9. **QA distinguishing what it actually tested from what remains unprovable in this environment**,
   filing one real bug at the correct (non-blocking) severity, and scoping its PASS verdict
   explicitly rather than letting it read as "the whole app is done."
10. **The founder-only-submission boundary held**: no store credential, API, upload, or submission
    path was ever touched. This run stopped, by design, before `/app-ship`.

## What remains open

- **APP-002, APP-003, APP-004 are still `todo`** — this run deliberately stopped after proving the
  review-reject-retry-merge-QA loop once, for real, rather than repeating it three more times for
  diminishing evidence. The founder's stated success criterion was about seeing the loop work, not
  about completing all four tickets.
- **No candidate/handoff aggregate** — same gap the `/app-ship` end-to-end audit and both prior
  dry runs already named. Unchanged by this run; out of scope for it.
- **This run used one IC (`android-developer`) for one ticket** — it did not exercise true
  *parallel* isolated agents on independent tickets, retry escalation, or agent crash/recovery.
  Sequential real isolation is a real step beyond narrated simulation, but the fully parallel case
  (both prior dry runs' recommended next pilot) remains untested.

## Recommended next steps

1. Fix DR-TC-P0-001/002/003 — all three are correctness gaps in trust-critical mechanisms
   (`board.mjs`'s single-source-of-truth guarantee, and `requireApprovalBinding`), not app bugs.
2. Fix DR-TC-P1-004 (`risk-router.mjs` pattern anchoring) — small, mechanical, same shape as this
   session's earlier `risk-router.mjs` fixes.
3. Run APP-002/APP-003/APP-004 in parallel (they fan out from the same merged APP-001) to finally
   exercise genuinely concurrent isolated agents, not just sequential ones — the one axis this run
   still didn't touch.
4. Once the board/worktree fixes above land, re-run this exact scenario as a regression check.

No store credentials, store APIs, uploads, submissions, staged releases, or production actions
were needed or used for this run.
