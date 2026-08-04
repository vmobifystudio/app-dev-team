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
   sh "${CLAUDE_PLUGIN_ROOT}/scripts/ship-gate.sh" . --record
   ```

   `--record` writes this verdict to `docs/team/ship-gate-verdict.json` so the control room's
   Mission Control panel can defer to it instead of only sweeping ticket/bug state — dry run 5
   (Android fixture) found that narrower sweep could say `clear` while this gate had just returned
   BLOCKED.

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
      `WAIVED: <artifact> — <who waived it> — <reason>`. Then **re-run `ship-gate.sh`** — it reads
      `docs/60-releases.md`, and it is the gate itself that decides the waiver applies, not you.
      A waiver it accepts comes back as `WAIVED: <artifact> by <who> — <reason>` in its output;
      repeat that line in the release summary and in step 4's confirmation question.

      `<artifact>` must be the exact path the gate named (`docs/51-bugs.md`, `docs/50-test-plan.md`),
      and **all three fields must be present** — the gate rejects a waiver with no name or no
      reason and stays at `CANNOT EVALUATE`, saying the waiver was malformed. That is deliberate:
      an unsigned, unexplained waiver is a skipped gate wearing a decision's clothes. If the gate
      still says `CANNOT EVALUATE` after you wrote a waiver, the waiver did not count — do not
      proceed on the strength of having written it.

      **Once this project has a canonical version** (a `## vX.Y.Z` heading exists anywhere in
      `docs/60-releases.md`), a waiver must name it as a fourth field —
      `WAIVED: <artifact> — <who waived it> — <reason> — vX.Y.Z` — or it does not count. This
      closes the gap an external audit found and reproduced: an old waiver written for a prior
      version silently cleared a check for a new one. Write the field yourself; the gate will not
      infer it.

      **A waiver is a founder decision, so it is recorded as one.** After the user approves it here,
      append the matching line to `docs/00-founder-intent/decisions.md`:
      `<date> FOUNDER DECISION: waiver — <artifact>, <reason>. Approved by <who>.`
      `scripts/trace.mjs --only gates` detects every `WAIVED:` line and stays red until that record
      exists — which is the point: the release record says a gate was skipped, and only the founder
      record says a human chose it.

   Asking this is not a third human gate: `/app-ship` **is** Gate 2, and produce-or-waive is part of
   the ship conversation the user is already in. Under `--yolo` from `/app-run`, do not auto-waive —
   `--yolo` skips gates the user would have approved, and nobody has approved shipping without a QA
   pass. Carry the `CANNOT EVALUATE` to Gate 2 as a blocker for the user to resolve.

   **A waived gate must never look like a skipped gate.** Both are absent from the checks; only the
   waiver says a human decided, who, and why. That is the whole reason this is a recorded waiver and
   not a conditional check that quietly stops applying — a gate that silently stops applying to
   brownfield projects is indistinguishable, six months later, from a gate that was never there.

   **And a `WAIVED:` is never an `N/A:`.** A gate whose owning role is `off` in
   `docs/02-team-roster.md` is *structurally inapplicable* — a `backend-service` has no store
   listing to be ready — so it is recorded as
   `N/A: <gate> — <role> is off(<reason>) per docs/02-team-roster.md`, printed in the release
   summary and appended to `docs/60-releases.md` alongside any waivers. A waiver says a human
   decided to proceed without a gate that applied; an N/A says there was nothing to decide.
   Writing either one as the other is a lie in the release record: the first invents a decision
   nobody made, the second hides one somebody did. Read the roster before you reach for `WAIVED:`.

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

   **Then the journey gate — the runtime gate above proves the app is ALIVE, not that it WORKS.**

   ```bash
   # Pick the driver for the platform under test. `[--driver <path>]` used to be a LITERAL
   # placeholder here, which meant journey-gate was always invoked without one — so the drivers
   # described as "the seam the gate was built around" were unreachable, and every declared journey
   # was CANNOT EVALUATE for a reason nobody could see. A detector nobody calls is FC-002 with extra
   # steps; this is the call.
   #
   #   android  scripts/drivers/android.sh   drives adb + uiautomator; needs a device or emulator
   #   ios      scripts/drivers/ios.sh       launches and screenshots; step execution needs XCUITest
   #
   # With no device attached either driver returns CANNOT EVALUATE naming the missing thing, which
   # is the correct answer and NOT a pass.
   node "${CLAUDE_PLUGIN_ROOT}/scripts/journey-gate.mjs" --root . \
     --driver "${CLAUDE_PLUGIN_ROOT}/scripts/drivers/android.sh"   # or drivers/ios.sh
   ```

   Six dry runs measured the gates catching every process defect and **zero** product defects. An
   app that launches and sits there satisfies `runtime-gate.sh` exit `0` completely. This is the
   only precondition in this command that asks whether the product does what it is for.

   - Exit `0` → a declared P0 journey completed with its assertions holding. Quote the evidence.
   - Exit `1` → **stop.** Same standing as a runtime FAIL: a release candidate whose P0 journey
     does not complete is not a release candidate. Note the gate distinguishes a failing product
     from a broken driver, so do not waive one believing it is the other.
   - Exit `2` → **CANNOT EVALUATE — not a pass**, and it is reached two different ways that must be
     recorded differently:
     - **No journey declared** → this is a *planning* gap, not a tooling one. `ux-architect`'s
       screen-and-state inventory already names the ids. Declare at least one P0 journey (see
       `docs/team/journeys/README.md`) and re-run — do not waive it, because the waiver would be
       recording that nobody ever stated what this product must do.
     - **No driver available** → follow step 1a's produce-or-waive rule: make it evaluable, or
       record `WAIVED: journey gate — <who waived it> — <reason>` in `docs/60-releases.md` and
       repeat it in the release summary and step 4's confirmation. **Drivers do not ship yet**, so
       this is the expected path today and the waiver is the honest record of it.

   **Product types the script cannot see are N/A, not waived — and not unchecked.** `runtime-gate.sh`
   detects iOS and Android only, so a `backend-service`, `web-app`, `cli` or `library` reaches exit
   `2` structurally, every time, and waiving it every release would train everyone to waive it.
   Record `N/A: runtime gate — product type <type> is outside runtime-gate.sh's detection`, **then
   run the equivalent for that type and quote its output**: does the service start and answer a
   health check, does the page render, does the CLI run `--help` and exit 0, does the library build
   and pass its own suite. Same three-state contract, same rule — nothing ships that nobody ran.
   (Extending the script's detection is the planned home for this; until then it is executed here
   and the evidence is quoted here, never assumed.)

   A waiver here is a human stating on the record that this build is going to users without anyone
   having watched it start. That should read as uncomfortable, because it is — but a recorded
   uncomfortable decision beats a silently skipped check, which is indistinguishable six months
   later from a gate that was never there. Under `--yolo` from `/app-run`, do not auto-waive.

   Where the Axiom toolchain is present, the `runtime-gate` skill escalates past launch to driving
   the PRD's P0 journey. On a release, prefer that: launching is the floor.

2. **Spawn the `active` roles among `security-reviewer`, `verification-engineer`, `privacy-reviewer`,
   `reliability-engineer`, `red-team-agent`, `aso-specialist`,
   and `data-analyst` in parallel** in a single message. Read `docs/02-team-roster.md` first — for
   an `off` role, print its gate as `N/A: <gate> — <role> is off(<reason>) per
   docs/02-team-roster.md` (see step 1a: an N/A is not a waiver) and record the same line in
   `docs/60-releases.md`. `security-reviewer` and `verification-engineer` are never off at any tier
   or product type, so an N/A for either is a defect in the roster, not a release decision:
   - `security-reviewer` produces `docs/70-security-review.md`. Open `critical`/`high` → stop.
   - `verification-engineer` produces `docs/71-verification.md` — it **executes** every constant
     that makes a real-world claim against outside reference data, and proves every guard rule in
     the release can actually fail. `VERIFICATION: FAIL` → stop. This is the gate that catches a
     mis-calibrated threshold and a green rule that cannot fail, neither of which any amount of
     reading will find.
   - `privacy-reviewer` produces `docs/73-privacy-review.md` — data inventory, consent, retention,
     third-party sharing, regional obligation. `PRIVACY: FAIL` → stop. **On a utility project this
     role is `off` and the gate is NOT `N/A`:** `security-reviewer` runs it as its privacy *mode*
     and returns the `PRIVACY:` line as well (`role-activation` §Tier deltas). Utility means one
     reviewer, never one checklist — an `N/A` here would be recording a decision nobody made.
   - `reliability-engineer` produces `docs/75-reliability-review.md` — offline, retries,
     idempotency, sync conflict, state restoration, recovery. `RELIABILITY: FAIL` → stop; data loss
     is not a note.
   - `red-team-agent` produces `docs/74-red-team.md` — it attacks the product **and** the studio's
     own assumptions, including which gate should have caught the last defect in
     `knowledge/failure-corpus.md`. `RED TEAM: FAIL` → stop.
   - `aso-specialist` runs the store-readiness gate (`docs/15-aso.md`, screenshots, compliance).
     It returns `ASO READY` or `ASO BLOCKED` with the missing items — **or `ASO: CANNOT EVALUATE —
     docs/15-aso.md` when the doc does not exist**, which follows step 1a's produce-or-waive rule,
     not a silent skip. That file is written by `/app-init` "if store work in scope" and by no other
     flow, so a brownfield or internal-distribution release legitimately has none: waive it with
     `WAIVED: docs/15-aso.md — <who> — no store submission in this release` in
     `docs/60-releases.md`. **Do not skip the gate merely because store work looks out of scope** —
     that judgement is the user's, it gets recorded, and it is wrong exactly when someone assumed a
     store upload was not happening.

     The one case that is *not* a waiver: `aso-specialist` is `off` in the roster because the
     product type has no store at all (`backend-service`, `cli`, `library`, `web-app`). Then the
     gate never applied and the line is `N/A: store readiness — aso-specialist is off(no app-store
     listing) per docs/02-team-roster.md`. Missing artifact on a product that *does* ship to a
     store is still a waiver decision, and still the user's.
   - `data-analyst` confirms P0 features are instrumented and the consent gate works.
   If any returns a blocker, stop and surface the combined list; do not proceed to release.

3. **Spawn `release-manager`** as a Task with the version (if given) and the precondition checklist. It either returns `SHIP CANDIDATE: vX.Y.Z` or `BLOCKED: ...`.

3a. **Spawn `release-auditor`** — *you* spawn it, **never `release-manager`**, and only after step 3
   has assembled the candidate. It reads the artifacts, not the summaries: `docs/60-releases.md`,
   `docs/50-test-plan.md`, `docs/54-evidence/`, `docs/51-bugs.md`, and every gate verdict above. It
   writes `docs/72-release-audit.md` and returns `RELEASE AUDIT: PASS | PASS WITH NOTES | FAIL`.

   **`release-manager` cannot satisfy this gate.** The actor performing an irreversible action must
   not be its sole evaluator, so:
   - `release-auditor` is spawned by this command directly and takes no input from `release-manager`
     other than artifacts it can read itself;
   - an artifact whose only witness is `release-manager` is a *claim*, and the auditor marks it
     `unverified`;
   - **a test claim with no discoverable evidence bundle stays `unverified`** (`team-protocol`
     §Evidence bundle), and a release whose critical journeys are `unverified` is a `FAIL`;
   - `release-manager` may correct a fact and the audit re-runs; it may never grade the verdict.

   `RELEASE AUDIT: FAIL` → stop, print the audit's checklist verbatim, and do not ask the upload
   question. Only a **human** may waive, and the waiver is recorded in `docs/60-releases.md` in the
   `WAIVED: <artifact> — <who> — <reason>` form with a real name.

4. **If SHIP CANDIDATE and `RELEASE AUDIT` is not `FAIL`**: print release-manager's output, the audit
   verdict, and the submission checklist from `docs/60-releases.md` verbatim. **The studio's work is
   done at this point — nobody here uploads or submits anything.** Tell the user plainly: the signed
   build is ready at the paths release-manager named; the checklist above is the founder's own
   action list for App Store Connect / Play Console. There is no confirmation question to ask,
   because there is no upload command for the studio to run.

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

- **Never upload or submit to a store, at any track.** The studio's function ends at a signed,
  submission-ready build and a written checklist — App Store Connect / Play Console actions are
  exclusively the human founder's. This is not a confirmation gate to pass; there is no command
  here that performs the upload, confirmed or not.
- Never ship across an open S1/S2 bug or a critical security finding.
- **Never ship a build nobody launched.** `RUNTIME GATE: FAIL` has no waiver; `CANNOT EVALUATE`
  needs a recorded one naming who decided and why.
- Never bump major version without explicit user instruction.
