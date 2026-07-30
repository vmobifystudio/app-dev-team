# From engineering pod to Studio OS — review and execution plan

**Reviewing:** the improvement plan of 2026-07-29 · **Against:** `revamp/phase-r-fixes` (494 assertions)
**Verdict:** accept the strategy, reject one tactic, re-sequence the rest.

---

## 1. What the plan gets right, and why it matters

**The closed epistemic loop is correctly identified as the highest-priority design problem.** The
team writes the PRD, derives criteria from its own PRD, implements against its own spec, and tests
against its own criteria. It can prove conformity to its interpretation and nothing else. Every
other weakness in this system is downstream of that, and no amount of gate-hardening touches it.

**`product-validator` must be a role, not a skill.** Its entire value is independence — a skill
invoked by the CPO inherits the CPO's frame. The rule *"it should not write the PRD it later
approves"* is separation of duties, and it is the same principle that already makes `approved` by
the ticket owner an unwritable board state.

**The traceability graph converts heuristics into structure.** Today's dashboard *guesses* at
unowned artifacts and un-delivered answers by scanning prose. A requirement→ticket→test→evidence
graph makes those checks structural. Half the recurring defect classes in the failure corpus —
FC-001, FC-003, FC-005 — are traceability failures wearing different clothes.

**The evaluation laboratory (P4) is the strongest idea in the plan and is under-ranked at P4.**
Golden projects with planted defects that a new studio version must catch is mutation testing
applied to the entire studio rather than to one script. It is the only proposed mechanism that can
tell us whether an improvement improved anything.

**Release confidence calculated but never overriding a blocking gate** is exactly right, and the
reason is stated correctly: an aggregate score that can neutralise an S1 is worse than no score.

---

## 2. The scorecard, corrected with evidence

Several ratings were drawn from `HANDBOOK.md` Part 12, which was written **before** the remediation
landed. Re-probed at HEAD:

| Claim in the plan | Actual state |
|---|---|
| Argument injection | **CLOSED** — sentinel file survives the exploit |
| CSRF on `POST /action` | **CLOSED** — requires `application/json`, refuses foreign `Origin` |
| Static-only shipping clear | **CLOSED** — `ship-inflight` carries the flag, ship-gate blocks |
| Non-functional assertions | **CLOSED** — all four replaced, each proven red-then-green |
| Release-gate failures | **CLOSED** — plain-format S1 now blocks (probed) |
| "Studio Immune System" (proposed) | **EXISTS** — `knowledge/failure-corpus.md`, 6 classes, recurrence is a blocking finding |
| Mutation testing (proposed) | **BUILT** — `scripts/mutate.sh`, 15/16, unmerged pending its one real survivor |
| Capability model (proposed) | **PARTIAL** — 18/18 roles declare a tool allowlist; no runtime enforcement beyond that |
| Cost ceiling (proposed) | **EXISTS** — `round-journal.mjs`, rounds/spawns/retries |
| Role activation by product type | **EXISTS** — fails closed on an unstaffed product type |

So **Security** is no longer 5/10 and **Safe autonomous release** is no longer 3/10 — but it is not
yet green either, because `/app-ship` has still never executed and the fixed pipeline has not been
re-run end to end. The honest number for autonomous release is *unknown*, and P0 exists to make it
knowable.

---

## 3. The one disagreement: roles versus skills

The plan says **"do not solve the remaining problem by simply creating more agents"** and then adds
roughly twenty-two: chief-of-staff, product-validator, product-researcher, business-model-strategist,
ux-architect, product-designer, design-system-engineer, motion-designer, accessibility-specialist,
design-qa, web-developer, ai-engineer, data-engineer, integration-engineer, performance-engineer,
privacy-reviewer, red-team-agent, reliability-engineer, release-auditor, growth-product-manager,
lifecycle-specialist, content-localisation-specialist, customer-support-analyst.

That is 18 → ~40. Today's evidence argues against it:

- `team-doctor` has repeatedly found **roles nothing spawns** and **skills nothing triggers**.
- ~22% of the agent corpus was duplicated boilerplate; it is still drifting back up.
- Every role is a file that can contradict the others, and **context paid on every spawn**.
- The single worst class in the corpus — FC-001, *a fix that stops one layer short* — gets
  arithmetically more likely with every additional consumer of a shared value.

### The test for role-hood

**A role is warranted only when it needs independent authority or an independent context.** Anything
else is a skill (reusable procedure), a gate (a pass/fail in the loop), or an activation variant.

| Proposed | Verdict | Why |
|---|---|---|
| `product-validator` | **ROLE** | Independence is the entire point; cannot be invoked by the party it checks |
| `release-auditor` | **ROLE** | Separation of duties from `release-manager`; the actor performing an irreversible action must not be its sole evaluator |
| `chief-of-staff` | **ROLE** | The single founder interface — genuinely a distinct job, and it reduces founder load rather than adding to it |
| `web-developer` | **ROLE** | A real, currently-unstaffed IC gap; `ic-workflow` already makes it cheap |
| `product-researcher` | **ROLE (conditional)** | Needs an independent evidence-gathering context; activate for new-product work only |
| `red-team-agent` | **ROLE (conditional)** | Adversarial framing genuinely does not compose with a reviewer's frame |
| `accessibility-specialist` | **SKILL + existing auditor** | Axiom already ships an accessibility auditor; the gap is a *gate*, not a person |
| `design-qa` | **GATE** | A pass in the loop, like code review |
| `motion-designer` | **SKILL** | A section of the design spec, not a context |
| `design-system-engineer` | **SKILL** | Token/component discipline belongs in `house-conventions` |
| `ux-architect` / `product-designer` | **SPLIT `ux-designer` into two, not four** | Flow vs screen is a real seam; the other two are not |
| `privacy-reviewer` | **MODE of `security-reviewer`** | Same evidence, same tools, different checklist |
| `reliability-engineer` | **SKILL** | Offline/retry/recovery is a review dimension |
| `performance-engineer` | **SKILL + existing auditors** | Axiom ships performance auditors |
| `ai-engineer` / `data-engineer` / `integration-engineer` | **ACTIVATION VARIANTS** of `backend-developer` | Same workflow, different conventions pack |
| `business-model-strategist` | **SKILL for `ceo`/`cpo`** | A pricing analysis is a document, not a standing role |
| `growth-product-manager` / `lifecycle-specialist` | **SKILLS for `data-analyst`** | Post-launch analysis, same data, same tools |
| `content-localisation-specialist` | **SKILL** | `axiom-localization` exists |
| `customer-support-analyst` | **SKILL for `data-analyst`** | A review-mining pass |

**Net: 18 → 24 roles, not 40.** Every capability in the plan is delivered; most arrive as skills,
gates and activation variants, which cost nothing when inactive and cannot drift into contradiction
the way a role file can.

---

## 4. Two smaller disagreements

**SQLite for the message store: no.** JSONL plus a generated view is the pattern the board already
proves, and **zero runtime dependencies is a security property**, not a style preference — it is
one of the few things today's security review passed outright. Move messages to
`docs/team/messages.jsonl` with the Markdown as the generated human view, exactly as the board works.

**The Slack-style UI: yes, with a constraint.** The plan already says "do not display fabricated
thinking streams" — hold that line hard. The channel view must render *events that happened*
(messages, commands, verdicts, artifacts), never a narrated impression of agents chatting. The
moment the UI shows something the event log cannot produce, it becomes a second source of truth.

---

## 5. Revised sequencing

The plan's P0 is correct and non-negotiable. After that I would reorder, because **P4 is the
instrument that tells us whether P1–P3 worked**, and building it last means flying blind through
the largest changes in the project's history.

| Order | Phase | Why here |
|---|---|---|
| **1** | **P0 — make the engine trustworthy** | Unchanged. Autonomous release stays disabled until done. |
| **2** | **P4 — the evaluation laboratory** *(promoted)* | Golden projects with planted defects. Build the ruler before the construction. Every later phase is measured against it. |
| **3** | **P1 — close the product-intent loop** | The highest-value structural change. `product-validator`, immutable Founder Intent Record, traceability graph, conflict detection, conditional founder gates. |
| **4** | **P3 — the control room** *(promoted over P2)* | Structured message events, generated channels, traceability view, decision inbox. Makes P1 visible and P2 unnecessary to guess at. |
| **5** | **P2 — team expansion, selectively** | The 6 genuine roles + the skills/gates/variants. Demoted because most of its value arrives as skills, and because the roster should be grown against measured gaps rather than an org chart. |

---

## 6. The execution plan

### P0 — Make the existing engine trustworthy *(blocking; autonomous release disabled until done)*

| # | Item | Done when |
|---|---|---|
| P0.1 | Resolve `mutate.sh`'s one real survivor: `events.mjs` has a `review_requested` guard that cannot execute because an outer function answers first | 16/16, or M09 justified into `excluded()` with a reason |
| P0.2 | Merge Phase 8; CI runs `mutate.sh --sample 4` on every PR | a deliberately broken guard reddens CI |
| P0.3 | Re-run the full pipeline intake → `/app-ship` (dry run 5), hypotheses written first | H8 finally exercised; register published |
| P0.4 | Adversarial runs: deliberate failures · missing toolchains · conflicting specs · malicious agent-supplied arguments | each produces a stated refusal, never a false pass |
| P0.5 | Prove production release cannot be self-approved | `release-manager` cannot satisfy `release-auditor` |
| P0.6 | Publish the evidence bundle | every claim traceable to a command and its output |

### P4 — The evaluation laboratory *(promoted; the ruler)*

| # | Item | Done when |
|---|---|---|
| P4.1 | `eval/` golden projects, each with planted defects: wrong financial constant · privacy-disclosure mismatch · subscription-restore bug · crash on launch · missing analytics · accessibility violation · conflicting requirements · malicious repo instruction · shared-file collision · fake test command · stale approval after code change | each defect has an expected detector |
| P4.2 | `scripts/studio-eval.mjs` — runs the studio against each project, scores detection | exit 1 if any planted defect escapes |
| P4.3 | A clean project that must complete with **zero false blocks** | false-positive rate is measured, not assumed |
| P4.4 | CI gate: a studio version does not ship unless the lab passes | proven by planting a regression |

### P1 — Close the product-intent loop

| # | Item | Done when |
|---|---|---|
| P1.1 | `docs/00-founder-intent/` — immutable record of the original brief, transcripts, examples, constraints. Append-only; derived docs may change, this cannot | a hash check fails if it is edited |
| P1.2 | `product-validator` role — outside the CPO/CTO/tech-manager chain; compares brief to PRD; flags omitted intent, invented requirements, scope drift | it can block scope-lock and cannot write the PRD |
| P1.3 | Traceability IDs end to end: Goal → Outcome → Requirement → Story → Criterion → Design → Ticket → Code → Test → Evidence → Analytics → Release | every node names its source and its verifier |
| P1.4 | `scripts/trace.mjs` — graph validation: orphan requirement, untested criterion, ticket with no requirement, requirement changed after its tests, code with no analytics | each failure mode proven on a fixture |
| P1.5 | Conflict detection across idea / PRD / SRS / design, with a stated precedence order and a conflict report — never a silent choice | a planted contradiction produces a report, not a guess |
| P1.6 | Conditional founder gates: pricing · sensitive data · destructive migration · account deletion · legal disclosure · major visual change · paid infrastructure · any waiver | each trigger proven to stop the loop |
| P1.7 | Extend the three-state contract beyond gates: requirement satisfied/violated/**unverified**; design approved/revision/**not reviewed**; analytics observed/incorrect/**no data** | no artifact can be silently "fine" |

### P3 — The control room

| # | Item | Done when |
|---|---|---|
| P3.1 | Messages move to `docs/team/messages.jsonl`; Markdown becomes the generated view | same pattern as the board; zero deps preserved |
| P3.2 | Message obligations: every message yields a decision, a state transition, an artifact update, or a timed follow-up | a message with no obligation is refused |
| P3.3 | Formal artifacts: ADR · PDR · DDR · Waiver (with expiry) · Incident · Assumption register | each has a writer, a reader, and a doc-graph row |
| P3.4 | Generated channel view: `#founder-decisions`, `#product`, `#design`, per-platform, per-ticket threads | renders only events the log can produce |
| P3.5 | Founder decision inbox — one briefing: decisions required, risks, scope changes, budget, latest build, next steps | replaces talking to N agents |
| P3.6 | Traceability view + evidence viewer in the dashboard | click a release, walk back to the founder goal |
| P3.7 | Release confidence score — displayed, **never authoritative**; a blocking gate always wins | proven: a 95% score with an open S1 still shows BLOCKED |
| P3.8 | Stronger anti-ping-pong: duplicate-question detection, semantic merge, mandatory escalation after one round, per-ticket discussion budget, no reopening without new evidence | each limit proven to fire |

### P2 — Team expansion, selectively

| # | Item | Done when |
|---|---|---|
| P2.1 | 6 new roles: `product-validator`(P1) · `release-auditor` · `chief-of-staff` · `web-developer` · `product-researcher`(cond.) · `red-team-agent`(cond.) | each is spawnable, in the activation matrix, and in a contract tier |
| P2.2 | Split `ux-designer` → `ux-architect` (flow/IA) + `product-designer` (screens) | two roles, not four; the rest are skills |
| P2.3 | New skills: design-system · motion · accessibility-gate · reliability · localisation · business-model · growth · support-mining | each is triggered by a role that exists |
| P2.4 | `design-qa` as a **gate** in `/app-build`, not a role | a fidelity failure blocks like a code review |
| P2.5 | `privacy-reviewer` as a **mode** of `security-reviewer` | one role, two checklists |
| P2.6 | `ai-engineer` / `data-engineer` / `integration-engineer` as **activation variants** of `backend-developer` | conventions pack differs; workflow does not |
| P2.7 | Device & state matrix + evidence bundle per critical journey | a test claim with no discoverable bundle stays `unverified` |

### Security hardening *(runs alongside P0)*

| # | Item |
|---|---|
| S.1 | Capability enforcement at spawn: designers cannot merge; devs cannot reach production credentials; QA cannot approve its own tests; release-manager cannot alter evidence |
| S.2 | Typed argument parsing everywhere — never interpolate agent text into a shell |
| S.3 | Signed board and release events; immutable audit log |
| S.4 | Secret redaction in messages and artifacts |
| S.5 | Prompt-injection handling for repository content |
| S.6 | Per-agent budget and rate limits; studio kill switch |
| S.7 | GitHub protected branches, required checks, required non-self review, environment approval for production |

---

## 7. What this does not fix, stated plainly

Even complete, the studio's external oracles remain: the compiler, the human gates, and real users.
`product-validator` narrows the closed loop — it checks the PRD against the *recorded brief* — but a
brief that is itself wrong about the market produces a validated, traceable, well-evidenced product
nobody wants.

That is not a defect to engineer away. It is the reason the founder gates exist, and the reason P1's
production-observation loop matters more than any gate in the system.

---

# Addendum — review of the second plan (control room, org model, methodology)

Three of my earlier positions change on the evidence in this plan. I am recording the changes
rather than defending the originals.

## Position changes

**1. The roster can be larger than I argued — because activation is already strict.**

My earlier objection was that 18 → ~40 roles multiplies drift and context cost. The second plan
answers it directly: *"Do not activate every agent simultaneously"*, with three team levels
(utility / growth / flagship) and trigger-based specialists. We already enforce exactly that —
`role-activation` gates by tier and product type and **fails closed** on an unstaffed product type.

So an inactive role costs **maintenance, not runtime**. That is a real cost but a much smaller one,
and it is already policed: `team-doctor` blocks on a role nothing spawns, a role in no contract
tier, and a role missing from the activation matrix.

**Revised rule:** a role may be added when it has (a) an activation trigger, (b) a contract tier,
(c) a spawn site, and (d) a reason it cannot be a skill. Roles that fail (d) still become skills —
`interaction-motion-designer`, `content-designer`, `localisation-specialist` and
`database-migration-specialist` are procedures, not standing contexts. But `product-manager`,
`test-automation-engineer`, `privacy-reviewer`, `compliance-specialist` and `reliability-engineer`
clear the bar once activation is conditional, and I withdraw the objection to them.

**2. SQLite: "not on our Node floor", not "never".**

I argued zero-dependency is a security property and rejected SQLite. That was half right.
`node:sqlite` is **stdlib from Node 22.5** — so on Node 22+ it is zero-dependency *and* gives atomic
writes, queries and pagination. Measured here: this machine runs **Node 20.19.6**, where it is
unavailable, and Node 20 is LTS into 2026, so requiring 22+ would exclude real users today.

**Decision:** JSONL remains the store now, with the schema shaped so a SQLite projection is a drop-in
later (`studio-event-schema/v1`). Revisit when the plugin's Node floor moves to 22. The append-only
event log stays the source of truth in both worlds, so this is a projection change, not a rewrite.

**3. Two dashboard modes — accepted, and it resolves a tension I had.**

Keep the dependency-free dashboard as the **emergency/diagnostic** interface: it must work when the
build stack is broken, which is exactly when you need to see why. Build the full control room as a
separate React/TypeScript app.

The constraint that makes this safe: **the frontend lives in its own directory with its own
dependencies, and the plugin itself stays zero-dependency.** The plugin must remain correct and
usable with the UI absent — the UI enhances visibility, it is never required for correctness.

## Accepted without change

- **CLI is the execution interface, not the complete human interface.** Correct, and the list of
  what CLI is poor at (following threads, comparing screens, browsing evidence) is accurate.
- **Local-first.** Repositories, credentials and evidence stay on the machine. Remote access later
  as a control plane receiving *selected events*, never shell or filesystem access.
- **SSE over WebSockets.** Already the transport; no reason to add another.
- **Machine truth vs human presentation.** The chat view renders structured events; the metadata
  panel (ticket, requirement, decision, artifact updated, verification required) is what makes it
  operational rather than decorative.
- **No fabricated chain-of-thought.** Routine execution appears as compact system events
  (`22:31 · started AND-018 · 6 files changed · 42/42 passed`), not narrated conversation. This is
  the same rule as "never render an empty panel that looks like all-clear": the UI may only show
  what the log can produce.
- **Message obligations** — every material discussion ends in a decision, an artifact update, a
  transition, a documented assumption, a blocker, an escalation, or an explicit no-action close.
- **Do not rank agents by tokens or message count.** Rank by verified completion, escaped defects,
  rework generated, false-completion rate, and recurrence of known failure classes.
- **Shape Up's appetite and circuit-breaker over estimates.** Agents cannot estimate honestly; a
  fixed appetite with a stop condition is the right shape.
- **`studio-director` as the single founder interface.** Absorbs my `chief-of-staff` for small
  projects; both exist for flagship.

## Where I would still hold the line

- **Rituals must produce artifacts, not transcripts.** A simulated standup that yields prose is
  cost with no output. Each ritual must emit a decision, a ticket, or a recorded risk.
- **The `#channels` are a generated view.** They are a projection of the event log, never a place
  where state is authored — same rule as the board's Markdown.
- **Do not add DORA metrics before the pipeline has run end to end.** Deployment frequency on a
  system that has never shipped is theatre. Metrics land after Phase R proves the loop.

## Revised sequence

Unchanged at the top: **P0 → P4 → P1**. Then:

| Order | Phase | Change |
|---|---|---|
| 4 | **P3a — structured comms backend** | Event schema v1, threads, channels, decisions, questions, SSE. JSONL now, SQLite-ready. |
| 5 | **P3b — minimum control room** | Five screens only: Mission Control · Communications · Board · Team · Founder Inbox. Separate app, own deps, plugin unaffected. |
| 6 | **P2 — roles, on the revised rule** | The bar is now (a) trigger, (b) contract tier, (c) spawn site, (d) cannot be a skill. |
| 7 | **P3c — evidence, design and release rooms** | Worktrees, builds, tests, runtime evidence, traceability, design QA, release readiness. |
| 8 | **Metrics** | DORA + flow + quality, once there is a real pipeline to measure. |
