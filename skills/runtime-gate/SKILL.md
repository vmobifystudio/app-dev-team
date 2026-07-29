---
name: runtime-gate
description: Use before advancing a ticket past QA and before any release — builds the app and launches it, then drives the P0 journey where UI automation exists. Triggers from /app-build's QA wave, /app-ship, qa-engineer and verification-engineer, and any moment someone is about to certify that an app works without having run it.
---

# Runtime gate

Every other gate in this plugin verifies that the **process** was followed. `verify-done.sh` checks
the branch exists and the test command exited zero. `board-doctor` checks the board is coherent.
`ship-gate.sh` checks nothing is in flight and no S1/S2 is open. `code-reviewer` checks the diff
reads correctly. A sprint can run green through all four on an app that does not compile in Xcode,
does not launch, or launches to a blank screen — because nothing ever ran it.

This is `defect-hunting` §2 — *never certify by reading, execute it* — pointed at the app itself.

## Run it

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-gate.sh" [--platform ios|android|auto] [--project-root .]
```

| Exit | Meaning | What to do |
|---|---|---|
| `0` | PASS — built **and** launched | Record the evidence path. Continue. |
| `1` | FAIL — does not build, or does not launch | **Blocks the row.** Re-spawn the developer with the compiler output the gate printed, verbatim. |
| `2` | CANNOT EVALUATE — the toolchain is not on this machine | **Not a pass.** Report it as CANNOT EVALUATE in the standup and in the verdict block. |

**Exit 2 is the point of the script.** A machine without Xcode is a normal state — a CI runner, a
Linux box, an Android-only project. It is not an error and it is not a pass. The gate prints what
was missing and what would make it evaluable; surface those lines rather than paraphrasing them.

Two traps it already closes, so do not re-open them by hand: `command -v xcodebuild` succeeds on a
Command-Line-Tools-only Mac where every invocation fails, and a build that compiles is **not** a
pass — "BUILDS, but launch UNKNOWN" is exit 2. Timeouts are stated and enforced; a hung simulator
produces CANNOT EVALUATE, never an infinite wait.

## Escalate past the script when the toolchain allows

The script is the floor — it proves the app starts. On iOS the Axiom toolchain, when installed,
gives far more, and you should route to it:

- `axiom:simulator-tester` — drives the running app, captures screenshots, reads the log for
  crashes and errors. This is what turns "it launched" into "the journey works".
- `axiom:test-runner` — runs XCUITests and parses the `.xcresult` for real failure detail.
- XcodeBuildMCP (the `xcodebuildmcp` skill) — build, install, launch and UI automation as tools.

Absent toolchain → **degrade to the plain script and say so**. Never silently skip a step: an
unavailable capability produces a stated CANNOT EVALUATE for that step, never a quiet pass. An
unstated gap reads as a cleared one.

## Drive the P0 flow, not just the launch

Building and launching is the floor. Where UI automation is available, exercise the **primary user
journey** and capture evidence at each step.

Pick the flow this way:

1. `docs/10-prd.md` — take the P0 features in priority order. The first P0 journey is the one that,
   if broken, makes the release pointless.
2. The ticket's acceptance criteria — the `Given / When / Then` rows are already the script. Drive
   them literally: the `When` is the interaction, the `Then` is what the screenshot must show.
3. `docs/50-test-plan.md` — qa-engineer's rows for those tickets, if the plan exists.

A journey that cannot be driven is stated as not driven, with the reason.

## Evidence discipline

The script writes `docs/evidence/runtime-<date>-<platform>.png` on a successful launch. Anything
you drive beyond that writes its own artifact to `docs/evidence/` too — a screenshot, or a log
excerpt for a step with nothing visual to show.

**Reference the artifact by path in the DONE report, the QA verdict, or the ship summary.** A claim
with no artifact behind it is exactly the class of self-report this whole system exists to distrust
— and per `defect-hunting` §4, a finding with no evidence and no owner is one that gets silently
skipped.

## Never

- Never report a pass for a platform the gate could not evaluate.
- Never treat "it compiles" as "it works". They are different exit codes for a reason.
- Never paraphrase a failure. The compiler already said exactly what is wrong; pass it through.
