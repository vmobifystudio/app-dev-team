# QA / testing audit — main f62f5a1 — 2026-11-21

QA-1 [High] Android journey driver reports PASS for the exact defects it exists to catch
**Where:** scripts/drivers/android.sh:91-95 (`node_for`), :96 (`attr`)
**What happens:** `tr '>' '>\n'` maps a character to a character. It does not insert newlines, and `printf 'a>b>c' | tr '>' '>\n' | wc -l` prints 0. `uiautomator dump` writes the hierarchy as one line, so `node_for <id>` returns the whole dump whenever the id appears anywhere in it. `attr` is a greedy `sed .*bounds="…"`, so it then reads the attributes of the LAST node in the file. Repro: a fake `adb` on PATH served a dump where `saved_date` has text="2026-11-21", bounds 66px at 440dpi (24dp) and an empty content-desc, followed by a second node with text="1999-01-02". The journey asserted `value_equals saved_date 1999-01-02`, `min_touch_target saved_date 48` and `announces saved_date "Saved on 1999-01-02"`. All three should FAIL. Instead `journey-gate.mjs --driver drivers/android.sh` printed `RESULT: PASS` and wrote `docs/team/journey-result.json` with result PASS. Taps also land on the last node's centre, not the target's. android.sh and ios.sh are never executed by scripts/test.sh and have no mutants in scripts/mutate.sh. Only web.sh is tested.
**Why it matters:** On Android, the one gate that is supposed to catch product defects (the date picker, the 24dp target and the stale announcement named in journey-gate.mjs:6-12) certifies them as working. qa_passed and readiness then accept that PASS as valid evidence.
**Fix:** In `node_for`, split nodes with `sed 's/></>\n</g'` or `tr '>' '\n'`, then grep. Add one test.sh section that runs android.sh against a stub `adb` with a single-line dump, plus one mutant.

QA-2 [High] No iOS journey can ever pass, so every iOS release needs a human waiver
**Where:** scripts/drivers/ios.sh:118-131; journey-gate.mjs:57-58 / validate() (needs ≥1 non-`screen` assert); commands/app-ship.md "A waiver is the exception: android, ios and web drivers all ship"
**What happens:** validate() refuses any journey that has no substantive assertion. ios.sh returns CANNOT_EVALUATE on every step other than launch. So every valid iOS journey ends CANNOT EVALUATE. app-ship step 1b, and again at 3b, then requires `WAIVED: journey gate — <who>` from a human. Driving the app with Axiom's simulator-tester (runtime-gate SKILL "Escalate") cannot produce a journey PASS either, because only the plugin's own drivers count (journey-gate.mjs:269-277). During the build loop, iOS QA passes on the unit-suite fallback record, so no agent ever drives the iOS app through a journey.
**Why it matters:** The brief says humans are only for store, signing and money. Here every iOS ship stops for a waiver, and the waiver means "nobody checked the product works".
**Fix:** Make ios.sh run the project's own XCUITest: `xcodebuild test -only-testing:<UITests>/Journey_<id>` and read the xcresult. Have ios-developer or test-automation-engineer generate one XCUITest per `docs/team/journeys/*.json` as a ticket. Until that lands, change the app-ship sentence so it stops claiming parity.

QA-3 [High] The Android journey gate as written in the commands is always CANNOT EVALUATE
**Where:** commands/app-build.md:416, commands/app-ship.md:226/327, journey-gate.mjs:310 (driver argv), android.sh:71, ios.sh:67
**What happens:** The drivers need `STUDIO_ANDROID_PACKAGE` / `STUDIO_IOS_BUNDLE` or `--package/--bundle`. journey-gate never forwards either, and no command, agent, skill or doc mentions those variables (grep of agents/ commands/ skills/ docs/ knowledge/ finds nothing). Repro: the documented invocation gives `UNKNOWN log-entry … "no package id — pass --package or set STUDIO_ANDROID_PACKAGE"`, and the overall result is CANNOT EVALUATE. runtime-gate.sh already derives the package and bundle id, but does not pass them on.
**Why it matters:** The documented path yields "no driver available". Rows then advance on unit tests alone and /app-ship asks a human for a waiver. Combined with QA-2, mobile QA never drives a journey by default.
**Fix:** Have journey-gate read the package/bundle id from `docs/team/runtime-result.json` (or the project profile) and pass `--package/--bundle` to the driver. Put the env var in the app-build and app-ship snippets.

QA-4 [Medium] A journey FAIL or runtime FAIL has no owner, and `qa_failed` is not linked to a bug
**Where:** commands/app-build.md:406-424, build-loop-branches.md §Step 5 "qa_failed → the fix", scripts/board.mjs (no BUG-/51-bugs validation)
**What happens:** Both gates run on the integration tip after the whole wave has merged. "Re-spawn the owner" does not say which owner when a wave holds several tickets, so the orchestrator guesses. `qa_failed --detail "BUG-NNN"` is free text. Nothing checks that BUG-NNN exists in docs/51-bugs.md, or that a BUG-NNN-fix ticket was cut. If QA forgets the row, the ticket sits in `qa` until ship-gate.sh:450 refuses the release. No mid-sprint detector exists for it (board-doctor and scheduler have none).
**Why it matters:** The failure→rework loop depends on the orchestrator reading prose correctly every wave. A dropped bug only surfaces at ship, which wastes a whole cycle.
**Fix:** `board.mjs move … qa_failed` should require `--detail BUG-NNN`, check that the id is a row in 51-bugs.md, and add the `BUG-NNN-fix` ticket itself (owner = the failed ticket's owner, depends on it). For a gate FAIL on a multi-ticket wave, bisect with the gate over the wave's merge commits, or else assign to every wave ticket that touches the failing journey's screens (impact-map.mjs already exists).

QA-5 [Medium] Fixed bugs do not become regression journeys
**Where:** agents/qa-engineer.md "Bug filing" / "You re-test fixed bugs and close them"; build-loop-branches.md §Step 5
**What happens:** A bug fix needs a regression unit test, and only through code-reviewer.md:76. Nothing turns a fixed S1/S2 user-visible bug into a journey step. Only `docs/team/journeys/*.json` is re-run on every wave and at ship, and those files are written once, as P0 happy paths.
**Why it matters:** The automatic regression loop at the user level covers only the original P0 paths. A fixed user-visible bug can come back without any gate noticing.
**Fix:** Add one rule to qa-engineer: closing an S1/S2 with a UI symptom appends its repro as steps (or a new P1 journey) in `docs/team/journeys/`. Journey-gate already runs them.

QA-6 [Medium] Three evidence systems for one claim. The hand-written 12-field bundle adds cost and catches nothing
**Where:** agents/qa-engineer.md "Evidence bundles" (`docs/54-evidence/<journey>-<build-id>.md`, 12 fields), team-protocol §Evidence bundle, release-auditor reads them
**What happens:** journey-gate already writes its own evidence: the screenshot plus digest under docs/54-evidence/journeys, the raw log, the result bound to HEAD, and the driver sha. verify-done writes test-evidence/v1. On top of that, QA hand-writes a 12-field Markdown bundle with build id, device, hash and so on. No script checks it, and an agent can fill it with anything. Release-auditor then grades the prose.
**Why it matters:** Every critical journey, every wave, costs extra tokens to restate machine evidence by hand, with nothing machine-checked in it.
**Fix:** Delete the hand-written bundle requirement. Have release-auditor read `journey-result.json` and `docs/team/evidence/`. Keep a free-text note only for manual or exploratory passes.

QA-7 [Medium] criterion-check.mjs is dead code: no flow calls it and nothing writes criteria.json
**Where:** scripts/criterion-check.mjs (whole file); the only caller is scripts/foundation-conformance.mjs:438
**What happens:** A grep of commands/ agents/ skills/ hooks/ finds no invocation and no writer of `docs/team/criteria.json`. It exists only to be tested by the conformance script.
**Why it matters:** It looks like per-criterion proof and is listed as if it closes "P0-08", but it never runs. It is maintenance surface that claims a coverage nobody has.
**Fix:** Delete it and its conformance check. Per-criterion proof already comes from journey assertions mapped to AC ids, so add `requirement_ids` to journey/v1 if that traceability is wanted.

QA-8 [Medium] The eval lab's 12/12 score is self-graded and never exercises the journey gate
**Where:** scripts/studio-eval.mjs, eval/*/manifest.json, scripts/financial-constant-scan.mjs (30 lines), subscription-restore-scan.mjs (33), analytics-coverage-scan.mjs (21), privacy-disclosure-scan.mjs (38); eval/manifest.json
**What happens:** `node scripts/studio-eval.mjs` printed "DETECTION SCORE: 12/12". Each planted defect is caught by a detector written for that fixture. For example, financial-constant-scan is one regex (`bankers|toNearestOrEven|halfEven|HALF_EVEN`) gated on "half-up" appearing in the PRD. No fixture plants a defect that only a running app would show, so the journey drivers are never measured. QA-1 would have been caught by one such fixture. In eval/manifest.json, 5 of the 7 cases are `grep -q "<phrase>" agents/*.md`, so they test wording, not behaviour, and ship-gate.sh:265 runs that manifest as a detector.
**Why it matters:** The score reports progress the studio has not made on product-defect detection, and nothing flags its blind spot.
**Fix:** Add one journey fixture per driver: a stub adb/xcrun or a static web page with a wrong round-trip value, with expected exit 1. Delete the 5 prose-grep cases from eval/manifest.json, because test.sh already pins that wording.

QA-9 [Medium] The plugin's own suite pins prose heavily, `--only` is unreliable, and mutation testing costs about 7 hours
**Where:** scripts/test.sh (13,581 lines, 204 sections, ~1050 assertions), scripts/mutate.sh (452 mutants, "~1 min per mutation — the whole suite runs")
**What happens:** About 116–135 assertions grep exact sentences in agents/, commands/ or skills/*.md, for example test.sh:10604 `grep -q 'then \*\*`product-designer` once `ux-architect` has returned\*\*'`. Most assertions do exercise scripts, which is good. `--only "W1 / G-F5"` gave 79 passed and 14 failed, and `--only "F14/F15"` also failed. The failures are missing-fixture faults from shared setup (the header admits this), so the inner loop does not work for the core evidence sections. A full mutate.sh run is 452 × full suite ≈ 7.5 hours, so in practice nobody runs it whole.
**Why it matters:** Prose pins make every doc edit a test edit and do not show behaviour. They are a big part of why changes cost "eight full runs".
**Fix:** Keep prose pins only for the strings scripts or hooks parse, and delete the rest. Give each section its own fixture setup so that `--only` is real. Have mutate.sh run only the section that names the mutant's label, not the full suite.

QA-10 [Low] Per-ticket qa_passed cites the same global evidence, and first declarations need two QA spawns
**Where:** agents/qa-engineer.md "Recording the verdict"; build-loop-branches.md "First declarations land before verdicts"
**What happens:** Every ticket's qa_passed cites the same docs/team/journey-result.json (or the same full-suite record), each with its own token. In the wave where journeys are first declared, QA must return without verdicts, land, wait for the gate to re-run, and be re-spawned for a verdict pass.
**Why it matters:** One QA spawn per wave is used up just ordering the landing, and the per-ticket token ceremony adds no information the wave verdict lacks.
**Fix:** Let the orchestrator record qa_passed for every wave ticket from a fresh journey-gate PASS on the wave tip. QA records qa_failed only, and only for tickets it rejects. Then the second spawn is not needed.

QA-11 [Low] The web driver breaks on ids that are not valid CSS
**Where:** scripts/drivers/web.sh:57 (`#${CSS_escape(id)}`, :111)
**What happens:** A leading digit (`#1st-item`) makes an invalid selector, which throws. The driver reports this as CANNOT EVALUATE "driver error", not as a missing element.
**Fix:** Drop the `#id` branch and use `[id="…"]`.

## Plugin test suite run
- The full `sh scripts/test.sh` in a copy was still running when this report was written; result line below if it finished.
- `--only "I-09"`: 80 passed, 0 failed. `--only "Sprint 7 U2"`: 127 passed, 0 failed (31s). `--only "W1 / G-F5"`: 79/14 (subset fixture faults). `node scripts/studio-eval.mjs`: 12/12, 0/3 false positives.

## Top 3 blockers to an autonomous end-to-end ship
1. QA-2 + QA-3: no mobile journey runs by default (iOS never, Android needs an env var nobody sets), so every mobile ship needs a human waiver.
2. QA-1: when the Android journey does run, it passes broken products.
3. QA-4: journey or QA failures have no owner and no enforced link to a bug ticket, so rework relies on the orchestrator getting the prose right every wave.

## Checked and found fine
- lib/test-evidence.mjs classifier: zero-test runs, bare keywords and missing toolchains are never green. The ordering is right.
- journey-gate refusals work: missing or empty evidence, a mismatched journey_id, a non-plugin driver, "today"/"0" inputs and screen-only journeys are all refused.
- web.sh drives a real Chromium and does real assertions (round-trip value, bounding box), and its behaviour is tested.
- evidence-check / readiness STALE binding to HEAD and digests: correct.
- Forging evidence by hand: a stated bound (lib/evidence.mjs C3G-17, contract-hooks guard). Not re-reported.
- ship-gate blocks on open S1/S2, on a latest qa_failed, and on undecided register items.
