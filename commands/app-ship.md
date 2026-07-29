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

2. **Spawn `security-reviewer`, `verification-engineer`, `aso-specialist`, and `data-analyst` in
   parallel** in a single message:
   - `security-reviewer` produces `docs/70-security-review.md`. Open `critical`/`high` → stop.
   - `verification-engineer` produces `docs/71-verification.md` — it **executes** every constant
     that makes a real-world claim against outside reference data, and proves every guard rule in
     the release can actually fail. `VERIFICATION: FAIL` → stop. This is the gate that catches a
     mis-calibrated threshold and a green rule that cannot fail, neither of which any amount of
     reading will find.
   - `aso-specialist` runs the store-readiness gate (`docs/15-aso.md`, screenshots, compliance).
     Returns `ASO READY` or `ASO BLOCKED` with the missing items.
   - `data-analyst` confirms P0 features are instrumented and the consent gate works.
   If any returns a blocker, stop and surface the combined list; do not proceed to release.

3. **Spawn `release-manager`** as a Task with the version (if given) and the precondition checklist. It either returns `SHIP CANDIDATE: vX.Y.Z` or `BLOCKED: ...`.

4. **If SHIP CANDIDATE**: print release-manager's output verbatim. Ask the user one question before any upload command runs: "Confirm upload to TestFlight + Play internal track for vX.Y.Z?" Do not push without explicit confirmation.

5. **If BLOCKED**: print the blocker list and the proposed unblock. Suggest the right command (`/app-build` for missing tickets, `/app-status` for context).

## Safety

- Never auto-confirm a store upload.
- Never ship across an open S1/S2 bug or a critical security finding.
- Never bump major version without explicit user instruction.
