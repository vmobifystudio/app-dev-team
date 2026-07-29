---
description: Ship a release — runs security review, then release-manager, gating on QA sign-off and clean bug board
argument-hint: [version override, e.g. 1.2.0, optional]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-ship — Cut a release

Version (optional, otherwise release-manager picks): $ARGUMENTS

## Steps

1. **Sanity check the board.** Run the board doctor — a release is the worst possible moment to
   discover a stranded ticket:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board-doctor.mjs" docs/31-board.md
   ```

   Exit `1` → stop. Then read `docs/31-board.md`: if anything is `todo`, `in_progress`, or `review`,
   stop and tell the user "Sprint isn't done — run `/app-build` first."

1a. **Run the ship gate.** These preconditions are a script, not prose to improvise — improvising
   them produced three silent, confident failures in one session (a guard that could not fail, a
   field-index mistake, a regex that reported zero open S1/S2 bugs while two were open; see
   `defect-hunting`):

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/ship-gate.sh" .
   ```

   - Exit `0` → **CLEAR.** Continue.
   - Exit `1` → **BLOCKED by a real condition** — an open S1/S2, a ticket still in flight
     (including `blocked`), a QA hold. Print its blockers verbatim and stop.
   - Exit `2` → **CANNOT EVALUATE.** A required input is missing or unparseable. The gate prints one
     missing input per line; **surface those lines verbatim** under
     `SHIP GATE: CANNOT EVALUATE` at the top of your output. This is a stop that names what is
     absent — never a pass, and never an unrecoverable error.

   On exit `2`, offer the user exactly two ways forward per missing input, and take the one they
   choose:

   1. **Produce it.** Name the owning role and spawn it. A brownfield project reaching `/app-ship`
      without `docs/50-test-plan.md` has simply never run a QA wave — that file is only ever written
      inside a `/app-build` QA pass — so `qa-engineer` writes and executes one against the shipped
      surface. Then re-run the gate.
   2. **Waive it, with the reason written down.** Append to `docs/60-releases.md` under this
      version — the release record `release-manager` already owns — a line reading
      `WAIVED: <artifact> — <who waived it> — <reason>`. Then continue, and repeat the waiver in the
      release summary and in step 4's confirmation question.

   Asking this is not a third human gate: `/app-ship` **is** Gate 2, and produce-or-waive is part of
   the ship conversation the user is already in. Under `--yolo` from `/app-run`, do not auto-waive —
   `--yolo` skips gates the user would have approved, and nobody has approved shipping without a QA
   pass. Carry the `CANNOT EVALUATE` to Gate 2 as a blocker for the user to resolve.

   **A waived gate must never look like a skipped gate.** Both are absent from the checks; only the
   waiver says a human decided, who, and why. That is the whole reason this is a recorded waiver and
   not a conditional check that quietly stops applying — a gate that silently stops applying to
   brownfield projects is indistinguishable, six months later, from a gate that was never there.

   The gate checks board coherence, that no ticket is still in `todo`/`in_progress`/`review`, that
   no `S1`/`S2` bug is open, and that a test plan exists — and it *notes* (without blocking) open
   S3/S4 bugs, any QA hold, and test-plan rows that were reasoned rather than executed.

   What it deliberately does **not** do is decide for you. Read its notes:

   - `docs/51-bugs.md` — **any open `S1` or `S2` stops the release.**
   - `docs/50-test-plan.md` — check the **exit criteria** QA wrote, and whether each row is marked
     executed or only reasoned. A test plan whose rows all say "not performed" is not a QA pass.
   - **`qa-engineer`'s ship recommendation is a first-class input, and it can differ from the
     reviewers without either being wrong** — per-ticket review is scoped to a diff and structurally
     cannot see that the sprint's core journey was never wired together (observed live: three
     individually-approved tickets, no composition root).

   **If QA recommends holding, stop and surface its reasoning verbatim, with the specific tickets
   that would close it. Never net a hold against a set of approvals.**

1b. **Run the runtime gate.** `ship-gate.sh` proves the *process* completed. This proves the app
   exists as a working artifact. Shipping something nobody ever launched is the exact failure it
   closes, and no other precondition in this command would notice:

   ```bash
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/runtime-gate.sh" --project-root .
   ```

   - Exit `0` → the app builds and launches. Quote the evidence paths from
     `docs/evidence/runtime-<date>-<platform>.png` in the release summary.
   - Exit `1` → **stop.** Print the compiler/gradle output verbatim. There is no waiver for this
     one: an app that does not build or does not launch is not a release candidate, and no human is
     entitled to record that it is.
   - Exit `2` → **CANNOT EVALUATE — not a pass.** Follow step 1a's produce-or-waive rule exactly:
     either make it evaluable (install the toolchain, or run the release from a machine that has it
     — the gate names what was missing), or record
     `WAIVED: runtime gate (<platform>) — <who waived it> — <reason>` in `docs/60-releases.md` and
     repeat the waiver in the release summary and in step 4's confirmation question.

   A waiver here is a human stating on the record that this build is going to users without anyone
   having watched it start. That should read as uncomfortable, because it is — but a recorded
   uncomfortable decision beats a silently skipped check, which is indistinguishable six months
   later from a gate that was never there. Under `--yolo` from `/app-run`, do not auto-waive.

   Where the Axiom toolchain is present, the `runtime-gate` skill escalates past launch to driving
   the PRD's P0 journey. On a release, prefer that: launching is the floor.

2. **Spawn `security-reviewer`, `verification-engineer`, `aso-specialist`, and `data-analyst` in
   parallel** in a single message:
   - `security-reviewer` produces `docs/70-security-review.md`. Open `critical`/`high` → stop.
   - `verification-engineer` produces `docs/71-verification.md` — it **executes** every constant
     that makes a real-world claim against outside reference data, and proves every guard rule in
     the release can actually fail. `VERIFICATION: FAIL` → stop. This is the gate that catches a
     mis-calibrated threshold and a green rule that cannot fail, neither of which any amount of
     reading will find.
   - `aso-specialist` runs the store-readiness gate (`docs/15-aso.md`, screenshots, compliance).
     It returns `ASO READY` or `ASO BLOCKED` with the missing items — **or `ASO: CANNOT EVALUATE —
     docs/15-aso.md` when the doc does not exist**, which follows step 1a's produce-or-waive rule,
     not a silent skip. That file is written by `/app-init` "if store work in scope" and by no other
     flow, so a brownfield or internal-distribution release legitimately has none: waive it with
     `WAIVED: docs/15-aso.md — <who> — no store submission in this release` in
     `docs/60-releases.md`. **Do not skip the gate merely because store work looks out of scope** —
     that judgement is the user's, it gets recorded, and it is wrong exactly when someone assumed a
     store upload was not happening.
   - `data-analyst` confirms P0 features are instrumented and the consent gate works.
   If any returns a blocker, stop and surface the combined list; do not proceed to release.

3. **Spawn `release-manager`** as a Task with the version (if given) and the precondition checklist. It either returns `SHIP CANDIDATE: vX.Y.Z` or `BLOCKED: ...`.

4. **If SHIP CANDIDATE**: print release-manager's output verbatim. Ask the user one question before any upload command runs: "Confirm upload to TestFlight + Play internal track for vX.Y.Z?" Do not push without explicit confirmation.

5. **If BLOCKED**: print the blocker list and the proposed unblock. Suggest the right command (`/app-build` for missing tickets, `/app-status` for context).

6. **Harvest the learnings** (after a confirmed release, not after a blocked one). Every agent is
   told by `house-conventions` to write a `LEARNING:` line into its daily fragment when it discovers
   a reusable convention. Until this step existed, nothing ever read them and the "living knowledge
   base" never actually lived. Collect them into the inbox:

   ```bash
   { echo; echo "## Harvested $(date +%F) — <version>";
     grep -r 'LEARNING:' docs/daily/ 2>/dev/null | sort -u; } >> docs/90-learnings.md
   ```

   Keep the `path:line` prefix `grep -r` emits — a learning with no source fragment cannot be
   checked against what actually shipped. If the harvest is empty, say so; an empty sprint of
   learnings is a real result, not a reason to skip the step.

   Then run `/app-learn` on this project so the inbox is folded into `knowledge/`. Its conflict
   rules still apply: additions auto-apply, conflicts wait for the user.

## Safety

- Never auto-confirm a store upload.
- Never ship across an open S1/S2 bug or a critical security finding.
- **Never ship a build nobody launched.** `RUNTIME GATE: FAIL` has no waiver; `CANNOT EVALUATE`
  needs a recorded one naming who decided and why.
- Never bump major version without explicit user instruction.
