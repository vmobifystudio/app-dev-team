# Audit AU — autonomy and human gates (main f62f5a1, 2026-11-21)

AU-1 [High] The founder-gate scan halts every `/app-run`, including `--yolo`, on text the team is told to write
**Where:** `scripts/trace.mjs:423-444` (the triggers), `commands/app-run.md:129-143` ("Stop the loop and ask… `--yolo` does not clear one"), `agents/cpo.md:40-45` (every PRD gets a privacy-policy and terms appendix and account-deletion rows), `skills/intent-trace/SKILL.md:125-146`.
**What happens:** I made a scratch project at `$TMPDIR/studio-audit-AU/p1` with a normal PRD ($2.99/month pro tier, links to the privacy policy and terms, an account-deletion row) and a design-token `claim: visual-direction =` line. `trace.mjs --only gates` exited 1 with 4 `founder_gate_required` findings: pricing, account-deletion, legal-disclosure, visual-direction. The CPO is instructed to write the privacy-policy appendix and the account-deletion rows, so `legal-disclosure` fires on every greenfield project by construction, and `account-deletion` fires on every app with accounts. `app-run` runs this scan every round and stops the whole loop, not just the affected tickets.
**Why it matters:** An unattended run cannot get past round 1 of any normal app. `--yolo` does not help. Account deletion and a privacy policy are App Store requirements; the team must build them whatever anyone decides, so they are not decisions.
**Fix:** Delete the `legal-disclosure`, `account-deletion`, `visual-direction` and `sensitive-data` triggers. Store rules or the privacy and security reviewers already cover them, and hosting the privacy policy is already a founder checklist row. Keep `pricing`, `paid-infrastructure` and `destructive-migration`, because they involve money or are irreversible. Change their effect from "stop the loop" to "block only the tickets whose files or feature match the trigger", so other tickets keep moving.

AU-2 [High] Approving scope at Gate 1 does not clear the founder gates it showed, so they fire again in round 1
**Where:** `commands/app-run.md:69,73-84`, `commands/app-init.md:229-245`. Repo-wide, the only instruction to write a `FOUNDER DECISION:` line is `commands/app-ship.md:132`, for waivers.
**What happens:** The Gate 1 brief includes `trace --only gates` output. The founder approves, or `--yolo` auto-approves. That approval is recorded only under `## Scope lock` in `docs/00-vision.md`, never as `FOUNDER DECISION: <trigger> — <subject>` in `decisions.md`. Round 1 runs `trace --only gates`, gets the same exit 1, and stops to ask again.
**Why it matters:** The founder answers the same pricing question twice, and a `--yolo` run stops at round 1 every time.
**Fix:** Add one sentence to Gate 1. On approval, append one `FOUNDER DECISION` line per fired trigger, quoting its subject, then run `founder-intent.mjs --write`. Under `--yolo`, record `AUTO (yolo)` decisions for reversible triggers and block only the money ones.

AU-3 [High] A ticket that hits the 2-cycle review cap can only be released by the founder at a real terminal
**Where:** `scripts/lib/events.mjs:817-819`, `scripts/lib/capabilities.mjs:89` (`HUMAN_GATES = { reopened: ['founder'] }`), `scripts/lib/actor.mjs:363-370` (refused without a TTY), `skills/parallel-orchestrator/references/build-loop-branches.md:59-80`.
**What happens:** The third `changes` is refused and the ticket becomes `blocked`. `reopened` needs a founder token, and minting one needs the founder typing at a TTY. Its dependents strand. The only escape left to an agent is a reviewer `approved`, which defeats the review.
**Why it matters:** A reviewer–developer deadlock is an engineering call, not a legal one. A real team hands it to the tech lead. `docs/03-decision-rights.md:37-39` already says "code-reviewer deadlock → tech-manager re-review or a different reviewer", and the code contradicts it.
**Fix:** Let `reopened` go to `tech-lead`/`cto` (move it into `ROLE_GATES`), one extra cycle at a time. After that, tech-lead must take one of three paths: take the ticket over, `corrected` (split or re-scope it), or accept it with a follow-up ticket. Drop the founder-token mint for this path; keep it only for `adopt`.

AU-4 [Medium] Every escalation goes to the founder because no agent step resolves them
**Where:** `commands/app-build.md:486-492`, `scripts/messages.mjs:598` ("these are the founder's, not the team's"), `agents/tech-manager.md:101`, `skills/team-protocol/SKILL.md:127-134`, `commands/app-run.md:144-148`.
**What happens:** ICs are told to escalate to `tech-manager` (`anti-ping-pong.md:25`). In `/app-run` the orchestrator is the tech manager, but step 6 only says "surface it to the user verbatim". No step tells it to settle the escalation by appending a `decision` row, so every IC disagreement reaches the human. "Scope/architecture conflict" and "CPO vs CTO split" also go to the user, even though the CEO exists to arbitrate them. `ceo.md:48` limits that arbitration to `/app-init` step 3a.
**Why it matters:** Founder load grows with team friction, which is the opposite of the goal.
**Fix:** In app-build step 6, the orchestrator settles each escalation by the "Decides" column of `03-decision-rights.md`. It spawns cpo or cto, or the CEO for cpo-vs-cto, and appends a `decision` row. Only money and irreversible items go to the user. Remove "two roles disagree and neither has authority" from team-protocol's escalate-to-user list; the CEO has that authority.

AU-5 [Medium] "Ambiguous requirement" and same-rank claim conflicts stop and wait instead of using a recorded assumption
**Where:** `commands/app-run.md:18-19` ("do not guess"), `skills/intent-trace/SKILL.md:118-120` (`conflict_unresolvable` → founder), `commands/app-onboard.md:28,44`, `skills/requirements-intake/SKILL.md:24` (still asks under `--yolo`).
**What happens:** Each one is a synchronous question. Under `--yolo`, intake still asks up to 5 questions before anything starts.
**Why it matters:** Most of these are reversible. `chief-of-staff.md` already has the right rule: reversible decisions get "a recommendation and a deadline after which the default stands". `/app-run` never uses it; chief-of-staff only runs from `/app-status`.
**Fix:** A reversible ambiguity gets a PM or CPO default, written to `docs/25-assumptions/`, and the work proceeds; the assumptions are listed for the founder at Gate 2. Same-rank claims go to the decider role for that row. Under `--yolo`, intake marks missing answers `(assumed)` instead of asking.

AU-6 [Medium] Brownfield `--yolo` permanently defers the most severe fixes
**Where:** `commands/app-run.md:82-84`, `commands/app-audit.md:139-157`, `skills/brownfield-onboarding/SKILL.md:62-68`.
**What happens:** "Risky" includes "anything that changes app behavior a user would notice", any persisted-data change and billing logic. Under `--yolo`, every Risky ticket is deferred, including S1s, and its register status becomes terminal `DEFERRED`.
**Why it matters:** Data-loss and billing S1s usually need exactly that kind of change. The unattended run fixes the lint and skips the bug that matters.
**Fix:** Under `--yolo`, Risky S1/S2 tickets proceed with the written plan, a tech-lead or CTO approval, and the high-risk second approval already in the risk policy. Only migrations that delete user data, and pricing changes, stay `needs-approval`.

AU-7 [Medium] The founder decision record is an honor system: it stalls honest runs and does not stop dishonest ones
**Where:** `agents/release-manager.md:97-102` (an agent appends `FOUNDER DECISION` lines "restated for this version"), `hooks/guard-gate-writes.sh` (does not protect `docs/00-founder-intent/decisions.md`), `scripts/trace.mjs:481-489`.
**What happens:** Any subagent can append the line that clears a gate, and release-manager is told to. Separately, for non-value triggers the quoted subject is the keyword itself. I recorded `FOUNDER DECISION: visual-direction — claim: visual-direction = —…`, changed the value from "calm pastel" to "neon brutalist", and the gate stayed clear (0 findings). That contradicts the "approval is about a value, not a topic" comment at `trace.mjs:465`.
**Why it matters:** It costs stop-and-ask time with no real protection.
**Fix:** After AU-1, only pricing and paid-infrastructure remain, and both are value-matched. Delete the topic triggers rather than hardening them. Drop release-manager's re-recording step: key waivers by artifact plus version in `60-releases.md` alone, which already carries `who`.

AU-8 [Medium] The waiver is written in three places
**Where:** `commands/app-ship.md:108-145`, `agents/release-manager.md:96-102`, `trace.mjs:452`.
**What happens:** One human waiver means: a `WAIVED:` line in `60-releases.md`, a verbatim copy in `decisions.md` (the first 80 characters must match or it stays red), a `founder-intent --write` manifest rewrite, a commit, and then release-manager restates it again with the version.
**Why it matters:** A typo keeps the ship red. The extra copies cost tokens and add no safety, because the founder is already in the Gate 2 conversation.
**Fix:** Delete the `waiver` trigger from `trace.mjs` and the `decisions.md` copy. `readiness.mjs` already validates the versioned `WAIVED:` line.

AU-9 [Medium] Store upload, production deploy and spending money are banned only in prose
**Where:** The bans are `commands/app-ship.md:388-391`, `agents/release-manager.md:163,172-174,294` and `docs/03-decision-rights.md:24`. There is no matching rule in `hooks/` or `scripts/lib`; the only hit for these tools outside prose is `scripts/test.sh`.
**What happens:** I piped `fastlane deliver --ipa build/App.ipa`, `xcrun altool --upload-app`, `vercel --prod` and `eas submit -p ios` as subagent payloads into `guard-gate-writes.sh` and `block-shared-tree-destructive-git.sh`. All exited 0 (allowed). The main session also holds MCP tools that spend money (`vercel buy_domain`, `supabase create_project`) with no guard.
**Why it matters:** These are the truly irreversible actions, and the founder said submission is theirs. Destructive git, by contrast, is well enforced.
**Fix:** Add one PreToolUse deny-list to `contract-hooks.mjs` for upload, submit, prod-deploy and project-create commands and the spending MCP tools, with a refusal pointing at the founder checklist. It is about 15 lines and needs one test.

AU-10 [Medium] The submission checklist over-specifies what the founder does after upload
**Where:** `agents/release-manager.md:182-232`.
**What happens:** The founder's rows prescribe a 5→20→50→100% rollout with about 24h between steps, a `release-health.mjs` run before each step, a 48h watch, and a tag push. A Founder Inbox screen tracks their progress.
**Why it matters:** The founder said final submission must not be gated or over-specified.
**Fix:** Cut the checklist to the steps that must be done: upload, compliance and age-rating answers (pre-filled), review notes and demo account, submit. Make the ramp and `release-health` a one-line recommendation. Let the studio push the tag once the founder marks the upload done, or drop that row.

AU-11 [Medium] The QA-vs-developer loop has no cap and no arbiter
**Where:** `skills/parallel-orchestrator/references/build-loop-branches.md:181-186`, `scripts/lib/events.mjs:142-144`. `docs/03-decision-rights.md` has no row for bug validity or severity.
**What happens:** `qa_failed` → BUG-fix ticket → review → QA can repeat with no limit. Each BUG ticket gets its own 2-cycle cap, but the parent loop does not. Nobody is named to decide "not a bug" or a disputed severity, and only the run budget ceiling ends the loop.
**Fix:** Add a decision-rights row: bug validity and severity decided by `product-manager`, or `cpo` for P0. Cap `qa_failed` at 2 per ticket, then that role decides: fix, accept as S3 known issue, or cut.

AU-12 [Low] The version question goes to the founder
**Where:** `agents/release-manager.md:78-80`, `commands/app-ship.md:395`.
**What happens:** A breaking change with no founder instruction returns `BLOCKED: Need founder answer "vX.Y.Z or vX+1.0.0?"`.
**Fix:** Apply semver from the diff (breaking change → major) and note it in the release notes. The founder can change the marketing version at upload.

AU-13 [Low] `/app-learn` knowledge-base conflicts wait for the user at the end of `/app-ship`
**Where:** `commands/app-learn.md:49,156`, `commands/app-ship.md:384`.
**Fix:** Record each conflict as `pending` in the pack and in the memory-curator ledger, and keep going. A human or the process owner reviews them later. Do not wait.

AU-14 [Low] chief-of-staff's "the default stands" rule is not wired into `/app-run`
**Where:** `agents/chief-of-staff.md:44-46`. The role is spawned only from `commands/app-status.md:117`.
**Fix:** Move the brief format (question with a default, reversible or not, needed-by) into `/app-run`'s escalation step. Delete the role unless the founder runs several projects at once, which is its own activation condition.

## Human touchpoints

| # | Touchpoint (file:line) | Trigger | Stalls | Necessary? | Verdict |
|---|---|---|---|---|---|
| 1 | requirements-intake Q&A (`skills/requirements-intake/SKILL.md:24`) | missing intake fields | everything, pre-start | partly (intent) | keep once; under `--yolo` → assume |
| 2 | Gate 1 scope-lock (`app-run.md:73`, `app-init.md:236`) | always | everything | no (reversible) | keep as the single founder touch, default-proceed under `--yolo`; merge #1 into it |
| 3 | Brownfield "which gaps" (`app-audit.md:124`) | always | everything | no | make-async (default S1/S2 + Safe) |
| 4 | Risky `needs-approval:` (`app-audit.md:110`, `brownfield-onboarding/SKILL.md:62`) | Risky tag | that ticket | only data-deleting migrations | make-async; tech-lead/CTO approve (AU-6) |
| 5 | pricing gate (`trace.mjs:424`) | price in PRD or monetization doc | whole loop | yes (money) | keep, async, ticket-scoped |
| 6 | paid-infrastructure gate (`trace.mjs:442`) | paid plan in architecture | whole loop | yes (money) | keep, async |
| 7 | destructive-migration gate (`trace.mjs:430`) | drop/wipe in docs | whole loop | yes for production user data | keep, async, ticket-scoped |
| 8 | sensitive-data gate (`trace.mjs:427`) | health, location etc. | whole loop | no (privacy-reviewer decides) | remove |
| 9 | account-deletion gate (`trace.mjs:433`) | any mention | whole loop | no (store-mandated) | remove |
| 10 | legal-disclosure gate (`trace.mjs:436`) | "privacy policy" anywhere | whole loop | no; hosting is a checklist row | remove |
| 11 | visual-direction gate (`trace.mjs:439`) | design claim | whole loop | no | remove |
| 12 | waiver gate (`trace.mjs:452`, `app-ship.md:130`) | `WAIVED:` | ship | the decision yes, the triple record no | remove trigger; keep the `60-releases` line |
| 13 | review-cap `reopened` with TTY founder token (`events.mjs:817`, `actor.mjs:365`) | 3rd `changes` | ticket plus dependents | no | remove → tech-lead/CTO (AU-3) |
| 14 | escalations surfaced to user (`app-build.md:486`) | any escalation | the round | rarely | make-async; agent decides (AU-4) |
| 15 | CPO/CTO and scope-architecture conflicts → user (`team-protocol/SKILL.md:127`, `app-run.md:147`) | disagreement | ticket | no | remove → CEO |
| 16 | ambiguous requirement / `conflict_unresolvable` (`app-run.md:18`, `intent-trace/SKILL.md:118`) | ambiguity | ticket | rarely | make-async (assumption log) |
| 17 | budget ceiling (`app-run.md:118`) | ceiling hit | everything | yes (money) | keep |
| 18 | kill switch `.studio-stop` (`app-run.md:122`) | human writes it | everything | yes (control) | keep |
| 19 | board `adopt` at TTY (`contract-hooks.mjs:716`) | board-log trust break | everything | integrity recovery, rare | keep |
| 20 | Gate 2 produce-or-waive and ASO waiver (`app-ship.md:108,301`) | CANNOT EVALUATE | ship | yes (founder is present) | keep, simplify (AU-8) |
| 21 | release-auditor FAIL waiver (`app-ship.md:356`) | audit FAIL | ship | yes | keep |
| 22 | version unclear / major bump (`release-manager.md:80`, `app-ship.md:395`) | breaking change | ship | no | remove (AU-12) |
| 23 | submission checklist (`release-manager.md:182`) | ship candidate | nothing after | yes (store) | keep, trim (AU-10) |
| 24 | credential rows: APNs/FCM, signing, demo account (`cto.md:51`, `release-manager.md:187`, arch §7) | feature needs them | should block only the dependent ticket or ship | yes (credentials) | keep, async |
| 25 | privacy policy and terms reviewed and hosted (`cpo.md:45`) | every app | ship | yes (legal) | keep as a checklist row only |
| 26 | `/app-learn` conflicts (`app-learn.md:49`) | KB conflict | post-ship | no | make-async |
| 27 | `/app-plan` "ready to launch?" (`app-plan.md:168`) | manual `/app-plan` only | — | n/a | fine (skipped under `/app-run`) |

## Does each kind of disagreement get resolved without a human?
- **Reviewer vs developer:** no. It ends with the founder (AU-3), against decision-rights.
- **QA vs developer:** no arbiter, and it ends only at the budget ceiling (AU-11).
- **CTO vs CPO:** the CEO decides only at init. Mid-sprint it goes to the user (AU-4).
- **Same-rank claims:** go to the founder (AU-5).
- **Ticket readiness, architecture, code acceptance:** named deciders, and they terminate.

## Top 3 blockers to an autonomous end-to-end ship
1. AU-1 and AU-2: the founder-gate scan stops every run at round 1, `--yolo` included, on PRD text the CPO is told to write.
2. AU-3: a review-cap deadlock needs the founder typing at a TTY.
3. AU-4 and AU-5: escalations and ambiguities go to the human instead of to the decider role, with a default.

## Checked and genuinely fine
- The destructive-git hook covers force push, `branch -f`/`-D`, and stash or reset on a dirty tree. Store upload, production deploy and spend are not covered (AU-9).
- `/app-plan` under `/app-run` asks nothing (`app-plan.md:171-174`).
- At ship, no confirmation question follows the submission-ready build, and the studio has no upload path (`app-ship.md:360-365`).
- The budget ceiling and the kill switch are correctly human and correctly non-skippable.
- Only tech-manager or founder can release a `needs-approval` block (S7-2 holds).
- The founder-intent manifest correctly treats `decisions.md` as append-only.

Scratch reproduction: `$TMPDIR/studio-audit-AU/p1`. Nothing in the repo was modified.
