I walked the whole studio on a scratch project at `$TMPDIR/studio-audit-flow/todo`, playing every role and running every script the docs name. The run got 4 APP tickets and 5 QA tickets to `done`, and `orchestrator ship` and `ship-gate.sh` both returned CLEAR (exit 0). It took 3 waves, about 26 agent-equivalent spawns, 21 doc-step refusals and 2 tickets nobody planned (APP-003, APP-004). The release auditor would still fail it by construction (FL-6).

## Counts

| Item | Steps (role actions) | Script calls | Refusals or not-a-pass exits |
|---|---|---|---|
| Init + plan (before any ticket) | 19 | 23 | 2 (`trace --only trace --intent` exit 1, expected; `orchestrator round` exit 2, no package.json) |
| APP-001 (add + persist) | 22 | 30 | 4 (preflight capability on `index.html`; `verify-done --static` exit 2, by design; journey-gate exit 2 twice) |
| APP-002 (complete + delete) | 20 | 26 | 1 (`verify-done --static` exit 2) |
| APP-003 (Playwright dependency, unplanned) | 20 | 26 | 1 (same) |
| APP-004 (build writes dist/, unplanned) | 21 | 28 | 2 (preflight STALE context; `verify-done --static` exit 2) |
| QA-1-w1 / QA-1-w2 / QA-1-w2 verdict pass / QA-1-signoff / QA-1-w3 | ~14 each | 18 / 20 / 4 / 17 / 17 | 1 (compose refused QA-1-signoff) |
| Ship | 12 | 24 | 7 (`orchestrator ship` BLOCKED; ship-gate dirty tree; release-candidate refused the source dir; privacy scan exit 2; repo-controls CANNOT EVALUATE; `orchestrator ship` and journey/runtime STALE before re-runs) |

Each feature ticket takes 10 board events, 4 inline token mints and about 26–30 script calls. The `ceo`, `tech-lead`, `devops-engineer`, `ux-architect` and `product-validator` passes were mostly writing docs.

---

FL-1 [High] Greenfield web-app round 1 cannot dispatch: the toolchain check needs a package.json that only the first ticket writes
**Where:** `commands/app-init.md:70-73` ("devops-engineer, or the first web-developer scaffold ticket, writes them"); `scripts/project-profile.mjs:129-171`; `commands/app-build.md:93-94`
**What happens:** I followed the impl spec and left package.json to APP-001. `project-profile.mjs check` then returned CANNOT EVALUATE ("web build script missing: no package.json"). `orchestrator round` exited 2 with "toolchain UNPROVEN", and app-build's rule for exit 2 is "Supply what it names". The ticket that would supply it can't be dispatched. I got past it by having devops commit package.json directly to main, outside any ticket.
**Why it matters:** an autonomous run on a web app stalls before any ticket moves, or someone improvises an unreviewed commit to main.
**Fix:** state one rule in `app-init.md` step 4: `devops-engineer` writes package.json (build/start/test scripts, the lockfile, and the Playwright devDependency from FL-2) during /app-init. Delete "or the first web-developer scaffold ticket".

FL-2 [High] The web journey gate needs a Playwright devDependency that no planning step creates and the QA ticket is not allowed to add
**Where:** `skills/parallel-orchestrator/references/build-loop-branches.md:127-131` (the only place it is said); `scripts/drivers/web.sh` (Playwright must resolve from the project); `commands/app-build.md:468-470` (the QA ticket is docs-only)
**What happens:** in wave 1 the journey gate returned CANNOT EVALUATE ("no journey declared", then "no app URL"). The rule is that rows may not move qa → done that wave. The only instruction to add Playwright sits in a "rare branches" file that the web-developer, tech-lead and devops prompts never point to. I had to cut APP-003 (a full ticket cycle, about 26 calls) and repeat QA in wave 2.
**Why it matters:** this adds an extra wave to every web project, and no web ticket can close in wave 1.
**Fix:** fold it into the FL-1 devops step. Also have `journey-gate.mjs` serve the app with `npm start` and a free port, as `runtime-gate.sh` already does through `web-smoke.mjs`. That removes the manual "start it in a second shell, export STUDIO_WEB_URL" step.

FL-3 [High] The two-pass QA flow leaves `QA VERDICT: HOLD` in the test plan, and there is no legal way to clear it
**Where:** `agents/qa-engineer.md:73-82` (write a verdict line on every touch); `scripts/spawn-prompt.mjs:418-425` (the verdict pass says no branch, and Files is "usually none"); `scripts/spawn-prompt.mjs:499` (refuses a QA ticket when no ticket is at `qa`)
**What happens:** QA declares the first journeys, which it hasn't exercised yet, so it honestly writes HOLD. The re-spawned verdict pass records `qa_passed` but is told not to branch. `orchestrator ship` then returned BLOCKED on "QA VERDICT: HOLD — complete-and-delete journey declared, verdict follows landing". When I added a QA-1-signoff ticket to flip it to GO, compose refused it ("no ticket of this wave is at `qa`"). I had to do the QA work by hand.
**Why it matters:** a correct run blocks at ship, and the only way out is improvisation or a human.
**Fix:** ship-gate should read the per-ticket `qa_passed` events, which the role file already calls "the verdict", and stop reading a HOLD that was written before the landing. Or let the verdict pass commit the single verdict-line change on its existing branch.

FL-4 [High] Web release: `release-candidate` refuses a no-build static site, and this is only found at the final step
**Where:** `scripts/release-candidate.mjs:109`; `scripts/project-profile.mjs:135` (passes any build script, including `node -e "process.exit(0)"`); `knowledge/web-conventions.md:19`
**What happens:** the profile check, three runtime gates and two journey gates all passed. Then `record --artifact .` returned "holds git-tracked files — that is source". I needed APP-004 (build copies to dist/), another full ticket and QA wave, then reran every gate, because HEAD moved four times.
**Why it matters:** a spec mistake that a check could catch at plan time costs a whole extra wave at ship time.
**Fix:** in `project-profile.mjs check --platform web`, run `npm run build` once and require a gitignored output directory (dist/, build/ or out/) containing index.html. That moves the failure to /app-plan.

FL-5 [High] Every feature ticket's evidence was gathered against the source tree, not the artifact that ships
**Where:** `commands/app-ship.md:188-233` (gates run on the main checkout via `npm start`); `scripts/runtime-gate.sh:592-609`
**What happens:** the runtime and journey gates served the repository root (`serve.mjs` from the working directory). The bound artifact is `dist/`. Nothing ever served or exercised `dist/`, yet `orchestrator ship` reported CLEAR.
**Why it matters:** it ships a build nobody launched, which is exactly what the safety section of app-ship forbids.
**Fix:** when a release candidate exists, the web runtime gate and journey gate serve `release-candidate`'s artifact directory (a static server on dist/) instead of `npm start` on source.

FL-6 [High] The release auditor fails a correct release by construction
**Where:** `agents/release-auditor.md:66-75` (every test claim needs a bundle in `docs/54-evidence/<journey>-<build>.md` whose artifact hash matches the candidate; the §4 kill switch must be exercised)
**What happens:** QA writes its bundles during the build waves, but release-manager builds the artifact afterwards, so no bundle can carry the candidate's hash. The QA compose prompt never asks for bundles anyway, and the verdict pass says "Files: usually none". Item 8 demands a kill-switch exercise on a localStorage to-do app with no such path. `orchestrator ship` exits 0 while the auditor's checklist must return FAIL, and only a named human waiver gets past it.
**Why it matters:** a human waiver becomes a routine step on every release, which trains people to waive it.
**Fix:** treat the auditor's evidence as the journey-gate record (`journey-result.json` plus screenshots with SHA-256) bound by `evidence-check --head` and `release-candidate verify`. Drop the separate Markdown bundle requirement, or have `journey-gate.mjs` write it. Make item 8 apply only when §4 names a kill switch.

FL-7 [Medium] The default capability manifest blocks the normal web layout, and the check is cosmetic anyway
**Where:** `scripts/team-bootstrap.mjs:110`; `commands/app-build.md:24-29` (preflight takes one `--path`)
**What happens:** preflight with `--path index.html` returned "web-developer is outside allowed paths". `serve.mjs`, `public/`, `scripts/` and `.gitignore` are excluded too. Preflight checks only the one path the orchestrator chooses to type before any work exists. APP-004 then wrote `scripts/build.mjs` and `.gitignore`, both outside the allowlist, and nothing after preflight looked at the diff.
**Why it matters:** honest orchestrators get blocked, and dishonest ones get through.
**Fix:** for web-developer, add `index.html`, `public`, `scripts`, `.gitignore`, `*.html`. Then either check the branch's `git diff --name-only` against capabilities inside `verify-done --static`, or delete the per-path capability check from preflight.

FL-8 [Medium] Context freshness ignores the impl spec, which is the document mid-sprint Q&A actually edits
**Where:** `scripts/team-bootstrap.mjs:233-234`
**What happens:** two spec-critic and Q&A answers were folded into `docs/22-impl-spec-web.md`, and preflight still reported FRESH. A one-line §7 addition to `20-architecture.md` (which release-manager requires) made APP-004's preflight STALE and forced a re-snapshot commit, which moved HEAD and staled every gate result again.
**Why it matters:** it guards the wrong documents. Real spec drift goes unseen while trivial doc edits cause churn.
**Fix:** add `docs/22-impl-spec-*.md` to the sources. Drop `00-vision.md` and `11-backlog.md`, which change at scope lock and release time without affecting ICs.

FL-9 [Medium] The utility web-app privacy mode cannot be evaluated: the privacy scan requires a store-listing doc
**Where:** `scripts/privacy-disclosure-scan.mjs:8-9`; `agents/security-reviewer.md:175`
**What happens:** the scan printed "docs/15-aso.md is missing" and exited 2. aso-specialist is off for web-app, so that file never exists. `PRIVACY:` can never be a mechanical PASS on any web, backend or library project.
**Fix:** when the roster has aso-specialist off, the scan reads the data-disclosure section of the architecture or PRD (or `docs/77-privacy-review.md`). Otherwise it reports `N/A: store disclosure — aso-specialist off`.

FL-10 [Medium] app-run invents analytics tickets
**Where:** `commands/app-run.md:56-57` ("Ensure every P0 feature has a paired `APP-NNN-analytics` ticket")
**What happens:** it applies unconditionally, even when data-analyst is conditional or off and the founder never asked for telemetry. For "persisted in localStorage" it would add telemetry to an app that sends nothing anywhere: an invented requirement and a privacy regression. I skipped it, and no gate complained, so the rule enforces nothing either.
**Fix:** "only when docs/52-analytics.md or the vision names an event or KPI".

FL-11 [Medium] Two human touchpoints beyond the two gates, and one blocker a utility team can't answer
**Where:** `skills/requirements-intake/SKILL.md:24` (asks the user up to five questions); `agents/release-manager.md:58-63` (§7 missing or older than 90 days → BLOCKED, "Need: cto")
**What happens:** intake stops for the founder before Gate 1, although app-run promises only two stops. On utility tier cto is off, so release-manager's §7 BLOCKED goes to a role that doesn't exist. Web has no store deadline, but the rule doesn't exempt it. I patched §7 myself as tech-lead.
**Fix:** with an idea plus `--yolo`, intake records its assumptions as `ASSUMED` and moves the questions into the Gate 1 brief. Exempt release-manager's deadline check when the platform is web or backend. On utility, route "Need" to tech-lead.

FL-12 [Medium] Mid-sprint planning edits have no sanctioned path
**Where:** `scripts/board.mjs` usage (`corrected` takes only `--invariant` / `--test-profile`); `scripts/sprint-planner` §8
**What happens:** board-doctor warned APP-002 `not_ready`. `trace --only trace` reported D-001 `design_no_ticket` ("add a ticket whose Spec cell names D-001"). APP-002's sanctioned change to `index.html` (from MSG-0003) fell outside its `--file` list. None of `acceptance`, `spec` or `file` can be corrected, and `add` refuses a duplicate. Separately, `verify-done --static` did not flag APP-002 touching a file outside its declared list.
**Fix:** let `corrected` take `--acceptance`, `--spec` and `--file`, plus a static-lane note when the diff leaves `--file`.

FL-13 [Medium] Studio bookkeeping dirties the main checkout, and no step commits it
**Where:** `commands/app-build.md:481-482` (standup written to tracked `docs/daily/<date>.md`); `scripts/team-message.sh` (tracked `docs/team/messages.jsonl`)
**What happens:** `git status` showed both after every round. ship-gate returned UNKNOWN on a dirty tree, and both leases printed "the base tree had 1 uncommitted path". I committed them by hand. Each such commit moves HEAD and stales runtime and journey results.
**Fix:** gitignore `docs/daily/<date>.md`, the concatenated standup, since it is generated. Or have step 6 commit both with one explicit-path commit before the next round.

FL-14 [Low] The web-developer role file contradicts the House KB precedence
**Where:** `agents/web-developer.md:28-34` (TypeScript strict, server-render by default) against `knowledge/web-conventions.md:5-6` (the project spec wins)
**What happens:** the spec chose vanilla JS, so the IC has to guess. I logged it as ASSUMED, NOT RAISED, which costs a ledger row and tech-lead time every run.
**Fix:** prefix it with "unless docs/22-impl-spec-web.md chooses otherwise".

FL-15 [Low] Journey vocabulary can't assert checked or completed state
**Where:** `docs/team/journeys/README.md` (vocabulary); `scripts/drivers/web.sh:83-86` (`value_equals` reads `.value`, which is "on" for a checkbox)
**What happens:** AC-003 ("stays completed after reload") can't be stated as a journey. QA's `qa_passed` for APP-002 cites a journey PASS that never checked completion.
**Fix:** add an `is_checked {id, value: true|false}` assert (`el.checked` / `aria-checked`).

FL-16 [Low] Output noise
**Where:** `scripts/trace.mjs:527-529`; app-build steps 3 and 4a
**What happens:** `trace --only conflicts` and `--only gates` both print "TRACE — TRACED — 9 node(s)… no break in the chain", the trace-section headline, rather than "no conflicts" or "no gate fired". Separately, `verify-done.sh` takes `--static <branch> <base>` in one place and `<branch> <base> --docs-only` in another, and `worktree-slot.mjs` takes `lease --owner web-developer` but `release --owner web-developer-1`.
**Fix:** print each section's own headline, and use one argument order for both pairs.

---

## Top 3 blockers to an autonomous end-to-end ship
1. **Web scaffolding is assigned to nobody before the first gate** (FL-1, FL-2, FL-4): package.json, Playwright and a real build directory each surface as a stall or an extra wave. One devops step at /app-init would remove all three.
2. **Ship-time evidence doesn't line up** (FL-3, FL-5, FL-6): the stale QA HOLD blocks ship, the gates exercise source rather than the artifact, and the auditor demands bundles that can't carry the artifact hash. A correct run ends at BLOCKED or FAIL and needs a human.
3. **Guards on the wrong inputs cause churn while real drift goes unseen** (FL-7, FL-8, FL-13): capability and context checks fire on harmless paths, every bookkeeping commit restales the gates, and the impl spec and actual diffs are never checked.

## Checked and fine
- The founder-intent record and tamper check worked first time, including adding the transcript.
- `team-bootstrap` gave preflight everything it needed, and the scheduler's ready set was correct without editing `schedule.json`.
- The board state machine, actor tokens (inline mint), the `approved --bind` / `approval-check` pairing and the merge gate never refused a legitimate move.
- `wave-integrate` (merge, full suite once, fast-forward, `merge-reconcile`) was fast (about 1s) and correct across 3 waves. It handled the no-origin case honestly.
- `runtime-gate.sh` web mode built, tested, served and smoked in about 3s, and correctly reported STALE when HEAD moved.
- `journey-gate.mjs` with `web.sh` and real Playwright ran both declared journeys, enforced the distinguishable-values rule and recorded screenshots with SHA-256 evidence.
- The verdict-pass compose (the PR #47 fix) correctly told QA not to `checkout -b` an existing branch.
- `release-candidate verify`, `board verify`, `approval-check --log` and `version-consistency-check` all gave clean, accurate answers at ship.
- Mid-sprint Q&A (`messages.mjs open --count` / `--was`) and `team-message.sh` refusing an answer that names no artifact worked as designed.
