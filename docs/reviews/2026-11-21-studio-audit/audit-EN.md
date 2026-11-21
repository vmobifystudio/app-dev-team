EN-1 [Medium] Two architecture specs that disagree. Both are live, and the CTO is told to follow both.
**Where** `agents/cto.md:12` ("Invoke the `architecture-builder` skill") and `agents/cto.md:44-70` (Deliverables 1–9), against `skills/architecture-builder/SKILL.md:12-62`.
**What happens** Each file lists the nine `docs/20-architecture.md` sections, and the lists have already drifted apart.
- Only `cto.md` has the web, backend-service and library stack rule (`cto.md:65-70`), the kill switch / forced update and push decision (§4), and the store platform requirements with check dates (§7).
- The skill still describes a mobile-only document, with fixed "§2 iOS stack" and "§3 Android stack" headings.
- `team-doctor.mjs:581-582` registers both files as producers of the same two docs.
**Why it matters** A CTO, or a utility-tier tech-lead, that follows the skill writes an architecture with no web section and no kill-switch decision. `release-manager` blocks later on the missing §7 store dates.
**Fix** Delete the section list from `architecture-builder/SKILL.md` and point it at `cto.md` §Deliverables, or move the list into the skill and delete it from `cto.md`. Keep one copy and update the `team-doctor.mjs:581` map to match.

EN-2 [Medium] The default house structure is heavy for every new app, and nothing scales it down for a v1.
**Where** `knowledge/README.md:53-56` (Flagship is the default unless the project declares utility), `knowledge/stack-defaults.md:48`, `knowledge/android-conventions.md:9-21`, `knowledge/ios-conventions.md:10-20,93-95`, `agents/tech-lead.md:41-46` ("Module list — feature modules (one per top-level feature) + shared modules (network, design-system, persistence, analytics)"), `skills/architecture-builder/SKILL.md:56-63`.
**What happens** A new two-screen app gets the full structure by default:
- **Android:** an `app` module, four `core/*` modules, an engine module, `feature/*` and `service/*` modules, convention plugins in `build-logic/`, Hilt, and a UseCase layer.
- **iOS:** five layers (View → ViewModel → Service → Repository → Persistence), Display DTOs, and a separate engine package with a 90% coverage floor.
- **Specs and principles:** the tech-lead's impl spec must list a module per feature plus four shared modules. The principles call for a snapshot test on every screen and a README at every module root.
- **No trigger:** nothing anywhere says when to split, so the full layout is required from ticket 1.
**Why it matters** Sprint 1 spends its foundation tickets on module wiring and empty Service/Repository pass-throughs, not product. Every later ticket touches four or five files per feature. Reviewers then flag "doesn't follow the layering" on code that has no reason to be layered. This is the over-engineering the brief asks us to flag.
**Fix** Add a v1 rule to `stack-defaults.md` and the tech-lead spec contents: one app module plus one pure domain package, and Service/Repository only where there is real IO. Split a module when a stated trigger fires, using the existing 600/800 LOC guidance or the number of features. Make the Clean Architecture module list the target layout, not the day-1 layout. Drop the per-module README rule.

EN-3 [Medium] Utility-tier Android rules contradict themselves and the agents.
**Where** `knowledge/android-conventions.md:96-100` and `knowledge/stack-defaults.md:60-64` ("ViewBinding (no Compose)… `TinyDB`", Activity-based), against `stack-defaults.md:52` ("**Never SharedPreferences**"; TinyDB is a SharedPreferences wrapper), `skills/architecture-builder/SKILL.md:31` ("UI: Jetpack Compose") and `agents/android-developer.md:38` ("Jetpack Compose unless the spec says otherwise").
**What happens** `house-conventions` step 2 tells a project that declares utility tier to "apply the Utility branch". That branch describes the older utility apps' stack, and both the architecture skill and the IC contradict it.
**Why it matters** Tech-lead and the Android IC can each pick a different side and both cite house law. That causes review churn, or a new app ships on ViewBinding.
**Fix** Retitle the utility deltas as "existing utility apps (brownfield reference only)". State that new utility apps use Compose and DataStore with Koin and a single module.

EN-4 [Medium] Process-tiering and code-reviewer disagree on how much review an XS ticket gets.
**Where** `skills/process-tiering/SKILL.md:17` says "`code-reviewer` still runs the full review". `agents/code-reviewer.md:15-18` defines a reduced `floor` track for XS.
**What happens** The planner records `floor` while reading that the review is full. The reviewer runs the reduced list.
**Why it matters** Whoever reads the skill (sprint-planner, tech-lead, a human) believes XS work got a full review when it did not.
**Fix** Replace that sentence in `process-tiering` with "code-reviewer runs its `floor` track (see the `agents/code-reviewer.md` table)".

EN-5 [Medium] The studio's own lessons are written down but never read back, so it does not improve from run to run.
**Where** `commands/app-learn.md:104-145` and `scripts/memory-curator.mjs`.
**What happens** Running `grep -rn "memory.jsonl\|memory-curator" scripts/*.mjs agents skills commands` finds only writers, a path inventory and documentation:
- Writers: `app-learn.md`, `app-memory.md`, `incident-commander.md`.
- Inventories: `team-doctor.mjs:741`, `team-protocol/SKILL.md:110`.
Neither `spawn-prompt.mjs` nor any agent reads promoted entries. The ledger lives in each project (`docs/team/memory.jsonl`), so the next app never sees it. The fresh-audit item S7-11 already noted "no prompt consumes memory yet", and that is still true on main.
**Why it matters** Step 6 spends tokens on proposals and reviews that change nothing.
**Fix** Delete the studio class in `memory-curator`, `/app-memory` and `/app-learn` step 6. Send studio-process findings to the existing failure-corpus or a `knowledge/` edit, which are read. Or have `spawn-prompt` inline promoted entries, but choose one.

EN-6 [Low] IC test rules ignore what the ticket actually changes.
**Where** `agents/web-developer.md:44-45` (an end-to-end test for every ticket plus a component test per state), `agents/ios-developer.md:46` and `agents/android-developer.md:43` (unit tests for "the ViewModel **and** Repository").
**What happens** An XS copy change or a ViewModel-only ticket still has to add an end-to-end or repository test. The required test becomes padding.
**Fix** Change the rule to "test the layers your diff changes; an end-to-end test only for the ticket that completes a P0 journey."

EN-7 [Low] Dead: `scripts/impact-map.mjs` and `/app-impact`.
**Where** `grep -rn "impact-map"` outside tests, docs and `mutate.sh` finds only `commands/app-impact.md:15`. `grep -rln "impact-map.json"` finds only `commands/app-impact.md` and `scripts/impact-map.mjs`.
**What happens** No command, role or bootstrap writes the map, and no flow calls the script. Without the map it always exits 2. S7-10 was closed by documenting that, but the script still has no caller.
**Fix** Delete the script, the command, and its `test.sh`/`mutate.sh` rows.

EN-8 [Low] Dead: `scripts/manager-failover.mjs` and `/app-manager-failover`.
**Where** The only caller is `commands/app-manager-failover.md:15`.
**What happens** The script looks for `role == tech-manager` attempts in `runs.jsonl`. The only writer is `board.mjs claimLease` (`board.mjs:684`, `--role flags.by`), and tickets are claimed `--by <owner>` (`parallel-orchestrator/SKILL.md:30`, `app-build.md:439`). A tech-manager lease is never written, so the result is always `FAILOVER: manager has no active attempt`. `/app-build` runs in the main session, so no manager lease exists anyway.
**Fix** Delete both.

EN-9 [Low] Near-dead: `scripts/manager-harness.mjs`, `/app-manager-harness`, `eval/manager-scenario.json` and its eval case.
**Where** Callers are `commands/app-manager-harness.md:15` and `eval/manifest.json:12`.
**What happens** The harness replays a made-up `manager-scenario/v1` state model that is defined only inside the harness (`manager-harness.mjs:14-15`). It tests its own simulation, not the real tech-manager or `orchestrator.mjs`.
**Fix** Delete all four.

EN-10 [Low] No script supports `--help`, one acts on it, and the shared parser is not shared.
**Where** `scripts/team-bootstrap.mjs`, `scripts/foundation-conformance.mjs`, `scripts/lib/args.mjs:2`.
**What happens** I ran all 64 `.mjs` scripts with `--help` from an empty directory:
- 44 exit 2, 12 exit 1, and `dispatch-preflight` exits 64.
- 7 exit 0 because they ran their real action. `team-bootstrap.mjs --help` wrote four manifests into the cwd (`docs/team/{capabilities,risk-policy,schedule,project-profile}.json`).
- `foundation-conformance.mjs` ignores its arguments and runs the whole suite (still running after 15s).
- `lib/args.mjs` calls itself "One argument parser for every Node script", but 21 scripts still parse arguments by hand (`messages.mjs:100`, `board-doctor.mjs:668`, `team-doctor.mjs:884` and 18 others).
**Fix** Handle `--help` once in `lib/args.mjs` (print the file's usage header and exit 0) and use it in `team-bootstrap`. Move the hand-rolled parsers onto it as those files are touched.

EN-11 [Low] `board.mjs add` accepts any ticket ID and an empty title.
**Where** `scripts/board.mjs`, `add`.
**What happens** `add "../x"`, `add "APP 7; rm"` and `--title ""` all exit 0. `spawn-prompt` then prints `checkout -b feat/../x-<short-slug> main` and `Daily fragment: docs/daily/<today>-web-developer-../x.md`, and the IC runs those literally.
**Fix** In `add`, reject IDs that don't match `^[A-Z][A-Z0-9]*-[A-Za-z0-9-]+$` and reject an empty title.

EN-12 [Low] Backend branch name is given two ways.
**Where** `agents/backend-developer.md:73` says `feat/APP-NNN-be-short-slug`. The spawn prompt's mandatory first action says `feat/APP-NNN-<short-slug>`.
**Fix** Delete the `-be-` line and its mention in the Output section.

EN-13 [Low] The reviewer word-budget estimate always counts the iOS pack.
**Where** `scripts/spawn-prompt.mjs:216` maps `'platform'` to `ios-conventions`.
**What happens** A code-reviewer compose on a web-developer ticket reports "KB packs 739 (ios-conventions)".
**Fix** Choose the pack from the ticket owner's platform.

EN-14 [Low] The plugin's test suite is expensive to maintain.
**Where** `scripts/test.sh` (13,581 lines in one file) and `scripts/mutate.sh` (428 mutation rows anchored on exact source strings).
**What happens** 6 of the last 60 commits only re-anchor mutation rows, for example `02057fa` "MF47E re-anchored" and `987e19e`.
**Fix** Keep them, because they catch real regressions. Split `test.sh` into one file per script under `scripts/tests/`, and anchor mutations on marker comments, not exact code text.

**Top 3 blockers to an autonomous end-to-end ship (this lens)**
1. EN-2: the day-1 multi-module, multi-layer default uses up early sprints on structure and makes every ticket bigger.
2. EN-1 and EN-3: the architecture guidance contradicts itself (two copies, and utility-tier rules that conflict), so roles choose differently and the review loop churns.
3. EN-5: lessons are recorded but never read back, so each run repeats the last run's mistakes.

**Checked and fine**
- IC spawn prompt: measured at 4,070 words (web), 5,063 (iOS), 5,035 (Android) and 4,521 (backend), all under the 6,600 budget. The output contract is inlined and the exact `git checkout -b` line is given. Spec → branch → code+tests → report is clear and minimal in `ic-workflow`.
- Code review is substantive, not a checkbox: black-box acceptance runs before reading the diff, then the second-path check, reverting the change to prove a test fails, spec drift, a wiring check, and a size-scaled track table.
- `git-pr-strategy` and `dependency-policy` are short and to the point.
- The sprint-planner foundation-ticket rule (`sprint-planner/SKILL.md:214-228`) prevents parallel ICs from scaffolding the same project.
- No crashes in 64 scripts × 4 odd inputs. Bad JSON, missing paths and unknown tickets or roles all exit 2 with a clear message.
- The hook fast path skips node for the main session, and `in-studio.sh` skips it outside a studio project.
- Integration-branch resolution has one source (`integration-branch.sh` and `lib/integration.mjs`).
- No dead library exports: everything my grep flagged is used inside its own CLI.
- Every script under `scripts/` has a caller. The only dead or effectively dead ones are EN-7, EN-8 and EN-9.
