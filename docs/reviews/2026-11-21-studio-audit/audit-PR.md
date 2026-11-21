PR-1 [High] Approving scope at Gate 1 does not clear the founder gates, so the first build round stops again, even on things the founder already said
**Where:** commands/app-run.md:73-84 (Gate 1 records nothing), :129-143 (the gates run every round and `--yolo` cannot clear them); scripts/trace.mjs:500-518 (`founder-intent/` is skipped as a source of approval); agents/cpo.md:40-45 (CPO is required to write account deletion and a privacy/terms appendix).
**What happens:** I set up a scratch project with a brief saying "Free with a $2.99/month premium… Users sign in", plus a PRD written the way the CPO agent is told to write one. `trace.mjs --only gates` exited 1 with three triggers: `pricing — $2.99/month` (the founder's own words), `account-deletion` (required by the stores) and `legal-disclosure` (the appendix CPO is ordered to write). Gate 1 in /app-run says "Wait for the answer" and writes no `FOUNDER DECISION:` line, so round 1 runs the gates and stops to ask again. Under `--yolo` nothing can clear them, so an unattended run stalls in round 1 for almost every app that has accounts or a subscription.
**Why it matters:** Two of the three stops are compliance the team is required to add, and one repeats the founder back to themselves. Each one stalls the loop mid-build.
**Fix:** (a) At Gate 1, list each `--only gates` finding as a line in the brief. On the founder's yes, the orchestrator appends one `FOUNDER DECISION: <trigger> — <subject>` line per trigger to decisions.md. (b) In `covers()`, treat a subject that appears verbatim in a non-decisions file under `docs/00-founder-intent/` as approved. (c) Drop `account-deletion` and `legal-disclosure` as founder gates when they come from the store-mandated rows in cpo.md:40-45. They are legal requirements, not choices, and the founder already reviews and hosts the policy at ship time.

PR-2 [Medium] Approvals match exact wording, so a gate fires again whenever a document rewords something already approved
**Where:** scripts/trace.mjs:481-498 and :500-518 (the loop continues to the next document after a covered hit).
**What happens:** I added `FOUNDER DECISION: account-deletion — Account deletion — approved`. Then a flows document said "Settings → delete account", and the gate fired again: "none of them names 'delete account'". The match is a case-sensitive `includes`, so "privacy policy" in lowercase in 15-aso.md would not be covered by an approval of "Privacy policy" either. Every rewording by ux-architect, ASO or the designer is another mid-build stop.
**Why it matters:** These are noise escalations about the same behaviour. Founders learn to rubber-stamp them, which defeats the gate.
**Fix:** Match case-insensitively. Keep value-level matching only for `pricing`, `paid-infrastructure` and `waiver`, where a new value really is a new decision. My test confirmed a new $29.99/year price fires correctly, so keep that. For the other triggers, a decision on the topic should cover the topic.

PR-3 [High] The team has no rule for what it may decide on its own; every default pushes the decision to the founder
**Where:** commands/app-run.md:18-19 ("never invents intent… surface it verbatim"); skills/team-protocol/SKILL.md:127-134 ("genuinely ambiguous" goes to the user); agents/product-validator.md:72-75 (anything not in the brief is an "invented requirement… never put to the founder"); skills/intent-trace/SKILL.md:39-40 ("Thin is a finding"); agents/product-manager.md:36-37 (says to decide anything reversible, the opposite of the others).
**What happens:** A one-paragraph brief never mentions empty states, onboarding, settings, Sign in with Apple, account deletion or a privacy policy. A competent PRD has all of them, and the validator's rules classify every one as `invented-requirement`, so the verdict is `DRIFTED` by construction or `CANNOT EVALUATE` ("thin"). During the build, ambiguity goes to the user under both app-run and team-protocol. There is no category for "the team decided this in the app's interest and wrote it down".
**Why it matters:** This is the root of most avoidable founder questions. It turns an autonomous studio into a question queue.
**Fix:** Add one decision-rights table to team-protocol and point app-run, validator and intent-trace at it.
- **The team decides and records:** anything reversible inside the brief's scope, all store or House-KB mandated requirements, copy, states, ordering, success-metric targets. Each is a line `[TD-NNN] <decision> — src: team-default|house-kb · reversible`.
- **The founder decides:** money (price, paid infrastructure), irreversible data actions, scope beyond the brief, brand or visual direction, waivers.
- The validator reports TD lines as their own non-material class, listed once at Gate 1 so the founder can veto any of them.
- Delete "ambiguous → user" from app-run.md:18-19 and team-protocol:129.

PR-4 [High] Scope cuts or additions at Gate 1 never reach the PRD, backlog, flows or specs, and under /app-run the approval is not recorded at all
**Where:** commands/app-run.md:73-84; commands/app-init.md:236-247 (step 7 records `## Scope lock`, but is skipped when /app-run calls it); app-init steps 4-5 run before the gate.
**What happens:** Gate 1 comes after ux-architect, product-designer, tech-lead and devops have already written flows, tokens, impl specs and CI. The only thing app-run rewrites after the gate is the roster (:78-79). If the founder cuts a P0, /app-plan still plans it from `docs/11-backlog.md`. Under /app-run the answer is written nowhere: init's recording step is skipped and app-run names no place to record it. The precedence rule's "scope-locked PRD" (trace.mjs:380) is therefore never actually locked.
**Why it matters:** The founder's one scope decision can be silently ignored, and four or five spawns are wasted on scope that was then cut.
**Fix:** Move Gate 1 to right after CEO arbitration and the validator (vision + PRD + architecture), before the step-4 fan-out. Record the answer in `00-vision.md ## Scope lock` and decisions.md. If the founder changed scope, re-spawn cpo (or ceo on utility) once to amend the PRD and backlog before step 4.

PR-5 [High] Acceptance criteria get no IDs, so they cannot be traced from the founder's words through tickets to QA tests
**Where:** skills/prd-builder/SKILL.md:15-27 (a free-text AC column, no `[AC-NNN]`, `[S-NNN]` or `rev:`); agents/qa-engineer.md:65 (`Test ID | Ticket |…`, no `[T-NNN]`, no `src:`); skills/sprint-planner/SKILL.md:36,55 (`--acceptance` is tech-manager's own free text); agents/ceo.md:37-38 versus skills/intent-trace/SKILL.md:58 (the skill's own example uses `src: brief.md#L22`).
**What happens:** I wrote a PRD exactly to the prd-builder template, a test plan in qa-engineer's format and a vision with `src: brief.md`. `trace.mjs --only trace` gave `requirement_no_criterion` on F-001 and `goal_no_founder_source` on G-001, and the fix text for the latter says "take the goal to the founder". The ticket's acceptance is a third paraphrase of the requirement, with nothing tying it back.
**Why it matters:** Following the templates as written produces broken-chain findings by construction. QA tests can't be shown to cover the founder's criteria, and the remediation hint sends yet more questions to the founder.
**Fix:**
- prd-builder: write `- [AC-NNN] Given/When/Then — src: F-NNN` lines and journey IDs `[J-NN]`.
- sprint-planner: `--acceptance` copies the AC IDs and their text verbatim.
- qa-engineer: test rows become `| [T-NNN] … src: AC-NNN |`.
- ceo.md: say `src: docs/00-founder-intent/brief.md`, and fix the intent-trace example to match.

PR-6 [Medium] Two scripts in the criteria pipeline do nothing useful
**Where:** scripts/criterion-check.mjs; scripts/requirements-conflict-scan.mjs:13-14.
**What happens:** No command, agent or skill writes `docs/team/criteria.json` or runs criterion-check; grep finds only test.sh and foundation-conformance. requirements-conflict-scan matches only the regex "exports per month" against "FREE_TIER_MONTHLY_EXPORTS", which is one test fixture's wording. It is called only from ship-gate, at ship time.
**Why it matters:** Maintenance and test cost for no real catch, and they suggest coverage that isn't there.
**Fix:** Delete both. Once PR-5 lands, AC→T coverage is checked by trace.mjs, and PRD-vs-architecture conflicts by `trace --only conflicts` with `claim:` lines.

PR-7 [Medium] No way to handle a founder's requirement change mid-build
**Where:** commands/app-run.md and app-build.md have no such step; agents/product-validator.md:3 says it re-runs "whenever the PRD… changes materially", but app-run.md:53-55 limits it to one spawn per run; commands/app-impact.md covers code files only and has no default map.
**What happens:** A founder message such as "add widgets" or "make it free" has nowhere to go. Nothing re-spawns cpo or the validator, nothing updates the acceptance text on tickets already in flight, and `rev:` (which drives `stale_coverage`) is never written by prd-builder.
**Why it matters:** Real founders change their minds mid-build. Today a change is either ignored or applied ad hoc with no trace.
**Fix:** Add one short step to app-run's loop. A new dated line in decisions.md triggers: cpo amends the affected F rows with `rev:` → the validator re-runs → `board.mjs move <ID> corrected --acceptance` on the affected tickets → the gates run. This can reuse the existing round-top `trace --only gates` check.

PR-8 [Medium] The product team is over-staffed, and three product roles are never actually used during a run
**Where:** docs/02-team-roster.md:23-25 and skills/role-activation/SKILL.md:24-26 and 108-110; app-build.md:131 and mid-sprint-qa.md:30-39 (every question goes to tech-lead, escalations go to the user); commands/app-status.md:117 (the only place chief-of-staff is spawned); app-init has no product-researcher step.
**What happens:**
- **product-manager** is "active" on flagship, but no step routes a question to it. Product questions go to tech-lead, and what tech-lead can't answer goes to the founder.
- **chief-of-staff** only runs under /app-status, never in /app-run, which is where founder load builds up.
- **product-researcher** is conditional, but nothing spawns it before the PRD it is supposed to inform. It can only appear later as a ticket owner.
- Tier: any subscription makes the app flagship (role-activation:25). A $2.99 habit tracker therefore gets roughly nine spawns across six serial stages before Gate 1: ceo, cpo with cto, ceo again to arbitrate, ux with tech-lead and devops, designer, validator.
**Why it matters:** Tokens and wall-clock time spent on handoffs, and roles that look staffed but aren't.
**Fix:**
- Delete product-manager, and let one cpo (or ceo) spawn answer the product half of the mid-sprint batch.
- Delete chief-of-staff, and fold its brief format (recommendation, default, reversible?, deadline) into app-run's escalation template.
- Either spawn product-researcher in app-init before cpo when its trigger fires, or delete it.
- Don't let a subscription alone force flagship.
- Skip the CEO arbitration spawn when cto flags no P0 as over budget.

PR-9 [Medium] Intake always stops to ask the founder, including under `--yolo` and `/loop`, and its "ask again" rule has no limit
**Where:** skills/requirements-intake/SKILL.md:24-35 and 86.
**What happens:** Any missing answer triggers a question through AskUserQuestion. Q4 (six-month success numbers) and Q5 (out of scope) are missing from almost every one-paragraph brief, so every run stops here. "Don't make up answers when the user is vague. Ask again" puts no cap on rounds. `--yolo` skips only Gate 1, so an unattended run still blocks at intake.
**Why it matters:** The founder is asked for things the CEO already proposes (metrics, non-goals) and then shows at Gate 1 anyway.
**Fix:** Ask only persona, core action and product type, and only when they can't be inferred. Record everything else as `ASSUMED` defaults that appear in the Gate 1 brief. Under `--yolo`, ask nothing. Delete line 86.

PR-10 [Medium] app-init and the intake skill both record the founder's words, and the natural way to do the second trips the tamper check
**Where:** commands/app-init.md:16-22 and skills/requirements-intake/SKILL.md:37-45.
**What happens:** Step 0 records brief.md. Intake step 2a then says to put "the original one-liner, your five questions and their answers" into the same folder. I appended the Q&A to brief.md: `founder-intent.mjs --write` refused (exit 1) and the check reported `TAMPERED`. The validator then reads that as `DRIFTED` (product-validator.md:60).
**Why it matters:** A false tamper or drift verdict at the very first gate.
**Fix:** In intake step 2a, write the Q&A to a new `intake-qa-<date>.md` file and not to brief.md. Remove the duplicate "record the one-liner" from intake, since step 0 already does it.

PR-11 [Medium] When CPO is blocked during init, nothing handles it
**Where:** agents/cpo.md:25-32; commands/app-init.md:49-57.
**What happens:** CPO is told it "cannot ask the user mid-run" and should return `BLOCKED: PRD`. app-init has no branch for that return, so steps 3a and 4 continue against a missing PRD.
**Why it matters:** The stall is silent, or the downstream roles invent the PRD themselves.
**Fix:** CPO decides, records the decision as `ASSUMED` under Open questions (per PR-3), and the item is surfaced at Gate 1. Delete the BLOCKED path.

PR-12 [Low] Design and journey IDs don't fit the trace convention
**Where:** agents/ux-architect.md:42-60 (screens use `S-NN`, journeys `J-NN`) versus skills/intent-trace/SKILL.md:68,70 (`S-` means a Story; Design is `[D-NNN] src: F-NNN`); prd-builder's journeys are prose paragraphs with no IDs.
**What happens:** Flows never declare D nodes, so the `design_no_ticket` check (trace.mjs:313) can never fire. QA journey files have no PRD journey ID to point to.
**Fix:** Give journeys `[J-NN]` headings in prd-builder, rename screens to `SCR-NN`, and declare each flow as `[D-NNN] … src: F-NNN`.

**Founder touch count.** A typical flagship greenfield /app-run from a one-paragraph brief with a subscription and sign-in reaches the founder roughly 6 to 10 times:
1. Intake questions (avoidable)
2. Gate 1 (keep), including drift items about mandated or default features (avoidable)
3. Round-1 gates for pricing, account deletion and legal disclosure (avoidable)
4. Paid infrastructure (legitimate, but belongs at Gate 1)
5. The same gates firing again on reworded documents (avoidable)
6. Ambiguous product questions escalated mid-build (mostly avoidable)
7. The review-cycle cap being hit
8. Readiness checks that cannot evaluate, sent as produce-or-waive
9. Gate 2 (keep)

The target is 2 to 3: Gate 1 including the money items, then Gate 2.

**Top 3 blockers to an autonomous end-to-end ship**
1. PR-1 together with PR-2: the founder gates stall round 1 on nearly every app, and `--yolo` cannot clear them.
2. PR-3: with no decision-rights policy, `DRIFTED` is produced by construction and every ambiguity goes to the founder.
3. PR-4: the founder's Gate 1 scope decision is not recorded under /app-run and does not reach the backlog.

**Checked and found fine**
- The founder-intent tamper check works, and appending to decisions.md is correctly allowed.
- Pricing approval is tied to the actual value: a new annual price correctly fires again.
- /app-plan runs without asking anything when /app-run calls it, so there is no hidden third gate.
- The spec-critic rules (questions grounded in a criterion, at most 3 per ticket, answers folded back into the spec, file even when the answer is known) are sound and cheap.
- The validator stays independent: it never writes the PRD, and team-doctor's `validator_writes_prd` check enforces that.

Scratch repro files are under `$TMPDIR/studio-audit-PR/p`; I made no edits to the repo.
