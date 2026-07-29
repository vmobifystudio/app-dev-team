# Dry run 4 — hypotheses, written before the run

**Date:** 2026-07-29 · **Against:** `revamp/phase-1-lean` (phases 0–3 + CI) · **Status:** OPEN

Dry runs 1–3 covered two agents colliding, worktree isolation, and a three-ticket sprint through
review and merge. **QA as a stage and the bug loop were never exercised, and nine of the ten
commands have never executed once** — `/app-build` is the sole exception, and even that was driven
by a human orchestrator following the steps by hand.

Today's evidence for doing this: a careful, doctrine-driven review shipped **eleven defects** into a
release themed "gates that fail closed", including a gate that hung forever, a gate that passed
crash-on-launch builds, and a rule that would have emitted an iOS version Apple never shipped. Every
one was found by *running*, none by reading.

Hypotheses are written **first**, so the run can falsify them. Dry runs 2 and 3 each falsified two.
A run that confirms everything is a demo, not an experiment.

## Setup

- Target: `/tmp/dryrun4/tipjar`, empty git repo.
- Product: a tip calculator. Deliberately tiny — 2–3 screens, no backend, no auth, no monetization.
  **Utility tier**, which exercises the new role-activation collapse (`ceo`+`cpo` → founder pass,
  `cto`+`tech-lead` → one technical pass).
- Platform: iOS. `xcodebuild` **is** present on this machine; `adb` is not.
- Driven by a human-in-the-loop orchestrator (me) following the command files verbatim, spawning
  each role as a subagent — the same method as dry runs 1–3, so results are comparable.

## Hypotheses

| # | Hypothesis | Falsified if |
|---|---|---|
| **H1** | `/app-init` runs end to end on an empty directory and produces every doc it claims, with no dead reference. | any promised doc is missing, or any doc references a file no step writes |
| **H2** | Role activation correctly resolves **utility + ios-app**, writes `docs/02-team-roster.md`, and the exec fan-out is visibly smaller than flagship. | the roster is absent, wrong, or the full 18-role exec set spawns anyway |
| **H3** | `/app-plan` accepts a **single-platform** project and produces a board via `board.mjs add`. | it demands an Android spec, or writes table rows by hand (the RV-001 regression) |
| **H4** | `spec-critic` produces at least one question a developer would genuinely have had to guess, and `tech-lead` answers it into the ledger **before** any developer spawns. | it produces nothing, produces only noise, or the answers never reach the ledger |
| **H5** | The event-sourced board refuses at least one illegal transition **during a real run**, not just in a probe. | every transition is legal, i.e. the loop never mis-steps and the guard is untested in anger |
| **H6** | `runtime-gate` returns **CANNOT EVALUATE or FAIL honestly** rather than a false PASS. With Xcode present but a generated project, the realistic outcomes are a build failure or an ambiguous-scheme refusal. | it returns PASS without an app having actually launched |
| **H7** | The **QA stage and bug loop run for the first time** — QA files a defect and it re-enters the board as `BUG-NNN-fix`. | QA is skipped, files nothing, or the bug never becomes a ticket |
| **H8** | `/app-ship`'s gates fire correctly on an incomplete project: `ship-gate` refuses, and the refusal names what is missing. | it clears, or it refuses without saying why |
| **H9** | Metrics from the event log are non-empty and plausible at the end of the run. | metrics are empty, or obviously wrong (zero cycle time, 100% pass with a known rework) |
| **H10** | No agent writes a false claim into its report — every `DONE`, every "raised on the channel", every "tests green" is true. | any claim in any report is contradicted by the repository |

## What I expect to go wrong

Recording predictions so hindsight cannot rewrite them:

- **H6 will not produce a real PASS.** The team writes Swift but nothing generates an `.xcodeproj`
  unless `devops-engineer` runs XcodeGen, and XcodeGen is probably not installed. Expected: a
  CANNOT EVALUATE naming the missing project or scheme. That is the *correct* behaviour, so H6
  passes on a refusal — it only fails on a false PASS.
- **H7 is the highest-risk hypothesis.** It has never run. I expect the bug loop to reveal a wiring
  gap between `qa_failed` and `BUG-NNN-fix` ticket creation.
- **H10 is where dry runs 2 and 3 both found lies.** 1 of 4 agents wrote its daily fragment; one
  claimed to have raised a question it had not. The output contract and the ledger checks were
  built to catch exactly this, and this is their first real test.
- Some command will reference a doc that `/app-init` does not create. There are now 15 skills, 11
  commands and 18 roles; the doc-graph check is new and was written after most of that.

## Ground rule

Findings go into the register verbatim, **including the ones that make today's work look bad.**
Dry run 3 published finding 7 with its correction in place of the original claim; that is the
standard. If the phases shipped today are broken, this document says so.
