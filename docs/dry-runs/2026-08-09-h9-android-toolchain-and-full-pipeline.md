# H9 — a real Android toolchain, a real multi-role pipeline

**Date:** 2026-08-09
**Fixture:** `dry-runs/h9-bp-journal` (copied from `dry-runs/blood-pressure-journal`, own nested git repo)
**What this tests:** everything H7/H8 had not yet touched — a real (non-Node) platform toolchain, and the
full `cpo -> tech-lead -> developer -> code-reviewer -> tech-manager` pipeline running concurrently, with
communication, board state, and review all real rather than played by this session.

## Why this shape

The user's explicit steer for this run: deprioritize the emulator/instrumented-test proof (H9 was going to
get one anyway, as a side effect) and prioritize breadth — "how agents take tickets, work with themselves,
how all roles contribute, communicate, workflow, review, tickets etc." So H9 is not one ticket end to end;
it is two tickets, five distinct role agents, and every hand-off between them left to run for real.

## Toolchain, found not assumed

This machine's default `java` is JDK 17 and `ANDROID_HOME`'s conventional default
(`~/Library/Android/sdk`) doesn't exist. Rather than treat the host as toolchain-incapable, the sibling "AI
Baby Growth Android" project's own `local.properties` was checked (per the user's own hint) and pointed at
a real, already-configured toolchain:

- JDK 21 at `/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` (keg-only, not on `PATH` or
  registered with `/usr/libexec/java_home`)
- Android SDK at `/opt/homebrew/share/android-commandlinetools` (platforms 35/36, build-tools 34/35/36, a
  real `adb`)
- A real, already-configured emulator AVD, `baby_growth_test`

Real signing credentials also live in that sibling project's `local.properties`
(`RELEASE_KEYSTORE_PASSWORD=...` etc.) — deliberately not read, used, or exposed at any point.

First proof this was real: a cold `./gradlew assembleDebug` on the fixture, BUILD SUCCESSFUL in 2m37s, a
real APK. First genuine Android compile of this whole engagement.

## The pipeline, run for real

- **h9-cpo** added PRD feature F-008 (dashboard range summary) and its SRS acceptance criterion.
- **h9-tech-lead** wrote impl spec `§5-APP-007` — exact file (`ReadingSummary.kt`), exact function shape,
  exact test cases, including the window-boundary edge case (this session added `§5-APP-006` by hand for
  the first ticket; APP-007's spec is entirely the agent's own).
- **h9-android-developer** implemented APP-006 (an instrumented persistence/relaunch test) — real code,
  real tests, committed to a real branch, reported via `team-message.sh`.
- **h9-android-developer-2** (APP-007, first attempt) correctly `BLOCKED` — see defect 1 below.
- **h9-android-developer-3** (APP-007, retry after the fix) implemented `ReadingSummary.kt` and 5 JVM unit
  tests, matching the tech-lead's spec including the boundary case.
- **h9-review-app006** / **h9-review-app007**: independent `code-reviewer` spawns, each re-running the
  tests and hand-running mutation checks before approving — neither rubber-stamped.
- **tech-manager** (this session, orchestrating, not implementing) ran both waves through the real
  `wave-integrate.mjs`: merge once, run the full suite once, push once per wave.

Wave 1 (APP-006) and wave 2 (APP-007) both reached `WAVE RESULT: GREEN` against the real emulator:

```
Starting 3 tests on baby_growth_test(AVD) - 16
Finished 3 tests on baby_growth_test(AVD) - 16
BUILD SUCCESSFUL in 2m 45s
```

Both tickets reached `closed` on the board through the real event-sourced state machine — not hand-edited.

## Two real defects, found by running it

### 1. Uncommitted shared-tree writes blocked a real ticket

`h9-android-developer-2` was leased a worktree for APP-007 and reported `BLOCKED`: the SRS entry, the PRD
section, and the impl spec that `h9-cpo` and `h9-tech-lead` had just written to the shared tree "did not
exist" from inside its worktree. This was not a bug in the developer agent — it was correct. `git worktree
add --detach <path> <base>` snapshots the last **commit** on `<base>`, never the live working directory,
and cpo/tech-lead's writes were still sitting uncommitted in the shared tree when the lease was cut.

Fixed two ways:
- `skills/house-conventions/SKILL.md` gets a new numbered rule: shared-tree writers commit before handing
  off. This skill is referenced by 26 of 30 role files — the highest-leverage single place to close this
  class of gap for every role, not just cpo/tech-lead.
- `scripts/worktree-slot.mjs lease` now captures `git status --porcelain` (excluding `docs/team/`, which
  churns on every lease/release call and would otherwise make the warning fire on nearly every invocation —
  "which is how a gate gets ignored") before leasing, and prints a NOTE if the tree is dirty.

### 2. A third RAN-regex gap — this time AGP's own output

Even after the JDK/SDK were pinned and the emulator run genuinely produced `BUILD SUCCESSFUL`,
`wave-integrate.mjs --wave 1 --push` first failed with `CANNOT EVALUATE`. Root cause: `project-profile.json`
hadn't pinned `JAVA_HOME`, so Gradle's own toolchain auto-provisioning failed
(`Toolchain download repositories have not been configured`) — fixed by embedding `JAVA_HOME`/`PATH`/
`ANDROID_HOME` directly into both `test.fast` and `test.full` commands (`wave-integrate.mjs` runs them via
`sh -c`, inheriting only its own process environment).

With that fixed, the *same* run failed **again** with `CANNOT EVALUATE`, despite the real emulator output
clearly showing `Starting 3 tests on baby_growth_test(AVD) - 16` / `Finished 3 tests...` / `BUILD
SUCCESSFUL in 5m 12s`. This is the third distinct RAN-evidence regex gap found this way (after two
TAP-format gaps in H7/H8) — `wave-integrate.mjs` and `scripts/verify-done.sh`'s shared regex didn't
recognize AGP's own `connectedAndroidTest` completion line. Fixed by adding `|Finished [0-9]+ tests? on` as
an alternative, verified against the exact real output string in Node before and after.

Both fixes are proven with a live `test.sh` fixture and a `mutate.sh` mutation
(`M80`/`M81`) that reverts each fix and expects the suite to go red; two pre-existing mutations
(`M77`/`M78`) whose anchors drifted when the new regex alternative was inserted were widened rather than
left stale. Full suite after all fixes: **1451 passed, 0 failed**. Mutation run
(`--only M77,M78,M80,M81`): **4/4 caught**.

## What this does and doesn't prove

Proves: a real non-Node toolchain works end to end through this plugin's own scripts, unmodified beyond the
project-profile command strings any Android project would need; five distinct role agents ran the real
pipeline concurrently with genuine hand-offs, not a scripted narrative; the review step is not decorative
(two independent reviewers ran real mutation checks); the board's state machine reflects only work that
actually merged.

Does not prove: cost/economics at any scale beyond two small tickets (see H7's E1–E6 for the only measured
wave-cost baseline so far); iOS toolchain readiness (untested); a fully autonomous, unattended run — this
session still acted as tech-manager's own orchestrator for the wave-level `wave-integrate.mjs` calls, same
caveat H8 already logged.
