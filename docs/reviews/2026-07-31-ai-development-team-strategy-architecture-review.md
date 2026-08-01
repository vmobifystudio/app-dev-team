# AI Development Team — Strategy, Architecture, and Foundation Review

**Review date:** 2026-07-31  
**Review lens:** organizational strategy, operating model, authority, lifecycle, foundational architecture, and transformation plan  
**Implementation audit:** completed and appended in sections 17–24  
**Sources:** `docs/HANDBOOK.md`, the current plugin documentation and team model, prior dry-run research, the existing revamp plans, and `/Users/amolpomane/Downloads/appdevteamreview_2`

---

## 1. Executive verdict

The plugin has the ingredients of an unusually thoughtful AI engineering organization. It already
understands several truths that many agent systems miss:

- an AI team needs separation of duties, not a collection of interchangeable personas;
- durable artifacts must outlive agent context;
- work must move through explicit states;
- inability to verify is different from success;
- a release gate must be able to stop a release;
- product intent, implementation, evidence, and release must be traceable;
- the system must learn from failures without silently converting agent output into truth.

The strategic weakness is that these ideas are still presented mainly as a large inventory of roles,
commands, skills, scripts, and controls. A proper AI development team needs one unambiguous operating
system tying them together: who owns each decision, which artifacts are authoritative, when a role is
activated, what evidence changes state, how disagreement is resolved, and what happens after release.

The target is therefore not “more agents” and not “more checks.” The target is:

> A small, dynamically staffed, evidence-driven software organization that can preserve founder intent,
> validate product assumptions, design and implement safely, independently challenge its own work,
> release under explicit authority, operate the product, and improve from observed outcomes.

### Current strategic rating

**7.4/10 as an AI development-team foundation.**

This is stronger than a normal agent workflow and is already credible as a governed engineering pod.
It is not yet a complete AI software company operating model. The missing maturity is concentrated in
decision architecture, product discovery, behavioral evaluation, execution durability, post-release
operations, and the conversion of the role catalogue into a truly activated organization.

This score is about the strategy and architecture expressed by the system. It is not a certification
that every implementation currently enforces the design; that certification belongs to the next phase.

---

## 2. What this system should become

The correct product category is a **local-first AI Software Delivery Operating System**.

It should be able to support a portfolio of products, but each product run should activate only the
smallest team required for its tier, platform, risk, and current lifecycle stage. The system should
behave like a disciplined organization, not like a chat room full of agents.

Its responsibility begins before a backlog exists and ends only after production outcomes have been
measured:

```text
Founder intent
  → opportunity evidence
  → product decision
  → scope lock
  → architecture and experience design
  → executable delivery plan
  → isolated implementation
  → independent verification
  → release authorization
  → production observation
  → governed learning
  → next product decision
```

Every arrow must have an owner, an input contract, an output artifact, a state transition, and a
defined escalation route.

---

## 3. Strategic principles

These principles should form the system's constitution. Every role, prompt, command, policy, and
future feature should be judged against them.

### 3.1 Outcomes before activity

Agents are not rewarded for producing documents, messages, commits, or tests. They are responsible
for moving a product outcome forward while preserving explicit invariants. Every ticket and workflow
must identify the user or business outcome it serves.

### 3.2 Roles are authority boundaries

A role should exist only when it needs at least one of the following:

- independent decision authority;
- an independent context that should not inherit another role's framing;
- a materially different capability or security boundary;
- accountability that must remain separate for governance reasons.

Everything else should be a skill, operating mode, checklist, gate, or product-type specialization.
The existing 29-role catalogue can remain, but it should be treated as a capability bench. A normal
product should activate roughly 8–12 roles at a time, not all 29.

### 3.3 Evidence changes state

Confidence, persuasive writing, and role seniority do not change workflow state. A state changes only
when the required evidence exists and the authorized role records the decision.

### 3.4 Three-state truth

Every meaningful check must distinguish:

1. satisfied or passed;
2. violated or failed;
3. unknown, unverified, or unable to evaluate.

The third state must never collapse into success.

### 3.5 Independent challenge is structural

The author of a product interpretation cannot be its only validator. The implementer cannot be the
only verifier. The release actor cannot be the only release auditor. Independence must come from
authority and context separation, not simply from asking the same agent to “be critical.”

### 3.6 Durable state over conversational state

Conversations are transient coordination. Decisions, assumptions, obligations, evidence, incidents,
waivers, and learning must be durable, structured, and recoverable by a cold agent.

### 3.7 Local-first and dependency-light

The repository remains the durable system of record. The team must remain understandable and
recoverable without a hosted control plane. A richer UI may project the state, but it must never
become a second authority.

### 3.8 Rules must prove they can fail

A control is not trusted because it exists. It is trusted after a representative violation causes
the expected refusal and a clean case remains clear. This applies to policies, workflows, prompts,
evaluations, CI, and release gates.

### 3.9 Automation stops at authority boundaries

The team may automate preparation, analysis, implementation, verification, and recommendations.
Founder scope-lock and production release remain explicit human authorities by default. Additional
human decisions are triggered only for predefined risk classes such as pricing, legal commitments,
destructive migrations, sensitive data, or paid infrastructure.

### 3.10 Production is part of development

Shipping is not the end of the process. Telemetry, support signals, incidents, rollback health,
experiments, retention, and product outcomes feed the next planning cycle through governed evidence.

---

## 4. Target organizational architecture

The organization should be structured into six authority groups. These are not six always-running
swarms; they are governance boundaries from which the active team is selected.

| Authority group | Core purpose | Representative roles | Must remain independent from |
|---|---|---|---|
| Founder and portfolio | Set intent, constraints, budget, and final strategic authority | founder, CEO, chief-of-staff | Delivery optimization that silently changes intent |
| Product and discovery | Establish the problem, market evidence, outcomes, scope, and product decisions | CPO, product-manager, product-researcher | Implementation convenience |
| Experience and architecture | Convert approved intent into coherent user journeys and technical boundaries | CTO, ux-architect, product-designer, tech-lead | Unapproved scope creation |
| Delivery | Plan and implement the smallest valuable change in isolated work | tech-manager and activated platform/backend/web specialists | Self-approval and self-release |
| Independent assurance | Challenge intent fidelity, correctness, security, privacy, reliability, and evidence | product-validator, code-reviewer, QA, verification, security/privacy, red-team, release-auditor | The work's authors and release actor |
| Release, operations, and growth | Release safely, observe production, handle incidents, and measure outcomes | release-manager, reliability, data, ASO, monetization | Rewriting historical evidence to justify outcomes |

### 4.1 Founder interface

The chief-of-staff should be the single routine interface between the founder and the team. The
founder should receive one decision briefing containing:

- decisions required now;
- the recommendation and dissenting view;
- scope, cost, timeline, and risk changes;
- unresolved assumptions;
- latest product evidence;
- release or incident status;
- the next irreversible action.

Agents should not independently escalate overlapping versions of the same issue to the founder.

### 4.2 Product leadership

The CPO owns the product decision system. The product-manager owns the operational product backlog.
The product-researcher owns evidence gathering but does not decide scope. The product-validator is
outside this chain and validates fidelity to founder intent and adequacy of evidence.

### 4.3 Technical leadership

The CTO owns architectural policy and major technical risk. The tech-lead owns the product's
technical design and integration coherence. The tech-manager owns execution flow, scheduling,
recovery, and escalation, but must not become the final authority on product intent, code quality,
security, or release.

### 4.4 Assurance council

Assurance roles should not act as a late waterfall committee. They should define evidence needs early,
review material changes at the relevant boundary, and provide independent verdicts near completion.
Their outputs should remain separate; a single aggregate confidence score must never override a
blocking finding.

### 4.5 Dynamic staffing

Activation should be determined from five dimensions:

- product tier: utility, growth, or flagship;
- product type: iOS, Android, web, backend, or mixed;
- risk profile: data, money, identity, safety, legal, migration, or infrastructure;
- lifecycle stage: discovery, design, build, release, or operate;
- current evidence: incidents, quality regressions, unresolved assumptions, or capacity constraints.

Each activated role must have a trigger, an authority contract, required inputs, expected outputs,
and a clear deactivation condition.

---

## 5. Decision-rights architecture

The team needs a decision constitution more than it needs additional role descriptions.

| Decision | Proposes | Challenges | Decides | Executes | Records evidence |
|---|---|---|---|---|---|
| Product opportunity | product-researcher / CPO | product-validator, data | founder or delegated CPO | product-manager | product-researcher |
| Scope lock | CPO / product-manager | CTO, product-validator, design | founder | product-manager | chief-of-staff |
| Architecture | tech-lead / CTO | security, reliability, platform ICs | CTO or delegated tech-lead | delivery pod | tech-lead |
| UX and design | ux-architect / product-designer | product-validator, accessibility, product | CPO/design authority | design pod | product-designer |
| Ticket readiness | product-manager / tech-lead | QA, delivery owner | tech-manager | assigned IC | tech-manager |
| Code acceptance | implementing IC | code-reviewer, verification, QA | authorized reviewer | implementing IC addresses changes | reviewer |
| Security/privacy exception | delivery or product owner | security/privacy | explicit human authority | designated owner | security/privacy |
| Release readiness | release-manager | QA, verification, security, release-auditor | founder or release authority | release-manager | release-auditor |
| Incident command | monitoring/reliability | product, security, platform leads | incident commander | response team | incident scribe |
| Durable learning | any role proposes | memory curator and domain owner | authorized curator | knowledge owner | curator |

### Conflict resolution

Disagreement should follow a fixed protocol:

1. Name the decision, competing positions, evidence, and affected invariant.
2. Determine the authoritative owner from the decision matrix.
3. Ask whether the disagreement is factual, interpretive, risk-based, or preference-based.
4. Resolve factual disputes through evidence; resolve interpretation through source precedence;
   resolve risk through the designated risk owner; do not escalate taste disagreements.
5. Record the decision and dissent when the risk is material.
6. Escalate only when authority is unclear, evidence cannot be obtained within the decision budget,
   or the decision crosses a founder/human gate.

Repeated debate without new evidence should be rejected as process churn.

---

## 6. Target product-to-production lifecycle

### Stage 0 — Portfolio and intake

**Purpose:** decide whether this opportunity deserves investment.  
**Required outputs:** founder intent record, problem statement, constraints, tier, product type,
initial risk class, budget boundary, and explicit non-goals.  
**Exit:** opportunity is rejected, parked with a revisit trigger, or admitted to discovery.

### Stage 1 — Discovery and opportunity validation

**Purpose:** reduce market and user uncertainty before solution commitment.  
**Required outputs:** assumptions register, evidence sources, target segment, alternatives, expected
outcome, success/failure signals, and the smallest useful experiment.  
**Independent check:** product-validator identifies omitted intent, invented demand, weak evidence,
and untested assumptions.  
**Exit:** evidence supports investment, or uncertainty is consciously accepted by the proper authority.

### Stage 2 — Scope lock

**Purpose:** define what will and will not be built.  
**Required outputs:** PRD, prioritized outcomes, experience boundaries, acceptance invariants, cost and
schedule envelope, monetization/privacy implications, and open decisions.  
**Human gate:** founder or delegated product authority approves scope and named risks.

### Stage 3 — Architecture and experience readiness

**Purpose:** make the scope implementable without hidden design or technical decisions.  
**Required outputs:** architecture decisions, data contracts, migration and rollback strategy,
screen/journey/state inventory, accessibility requirements, telemetry plan, security/privacy model,
platform specifications, and testing strategy.  
**Exit:** critical requirements have owners, designs, tests, and evidence expectations.

### Stage 4 — Planning and dispatch

**Purpose:** create executable, independently verifiable units of work.  
**Required outputs:** ticket graph, dependencies, affected surfaces, ownership, reviewer, risk route,
context package, capability boundary, resource budget, and Definition of Done.  
**Exit:** only ready work enters the dispatch queue; no work is spawned merely because it exists.

### Stage 5 — Isolated implementation

**Purpose:** produce small, reviewable changes without corrupting shared state.  
**Operating model:** branch/worktree isolation, explicit checkpoints, bounded retries, side-effect
idempotency, and handoffs through durable artifacts.  
**Exit:** implementation evidence exists and the author declares what was changed, what remains, what
was tested, and which assumptions were made.

### Stage 6 — Independent assurance

**Purpose:** determine whether the change is correct and safe, not merely whether it matches the
author's interpretation.  
**Required views:** code review, functional verification, journey/state testing, security/privacy,
reliability/performance where triggered, requirement fidelity, and evidence quality.  
**Exit:** approved, returned with actionable findings, blocked, or unverified because required evidence
cannot be obtained.

### Stage 7 — Release authorization

**Purpose:** decide whether this exact release candidate may reach users.  
**Required outputs:** immutable candidate identity, change and evidence bundle, known defects,
waivers with owner and expiry, migration/rollback plan, observability readiness, and auditor verdict.  
**Human gate:** the release authority approves the candidate; the release-manager executes but does
not self-audit.

### Stage 8 — Operate, learn, and adapt

**Purpose:** manage production and compare outcomes with intent.  
**Required outputs:** release health, incidents, support themes, funnel and retention signals,
experiment results, cost signals, and product-outcome review.  
**Exit:** learning is proposed for curation, assumptions are updated, and new work enters intake rather
than bypassing the product process.

---

## 7. Foundational system architecture

The operating model should be implemented as seven cooperating planes with one durable event model.

```text
Human authority and policy
          │
          ▼
Intent + decision plane ────── product/requirement/evidence graph
          │                                      │
          ▼                                      ▼
Orchestration plane ─────── context and knowledge plane
          │                                      │
          ▼                                      ▼
Execution plane ─────────── assurance and evaluation plane
          │                                      │
          └──────────────┬───────────────────────┘
                         ▼
              release and operations plane
                         │
                         ▼
                  governed learning
```

### 7.1 Intent and decision plane

This plane owns founder intent, assumptions, requirements, decisions, waivers, and authority. It
prevents implementation activity from silently rewriting the reason the product exists.

### 7.2 Product and evidence graph

The central semantic graph should connect:

`Goal → Outcome → Assumption → Requirement → Journey/State → Design → Ticket → Change → Test → Evidence → Release → Production signal`

Every node needs an ID, owner, source, status, version, and verifier. Material changes should identify
downstream consumers and invalidate only the approvals and evidence actually affected.

### 7.3 Orchestration plane

The orchestrator is a deterministic workflow coordinator, not a super-agent. It should:

- compute readiness from dependencies, capabilities, risk, context freshness, and capacity;
- activate the smallest necessary team;
- maintain leases and checkpoints;
- prevent conflicting work and duplicate irreversible actions;
- recover cold from durable state;
- escalate using the decision constitution;
- stop when authority or evidence is missing.

### 7.4 Context and knowledge plane

Every agent run should receive an explicit context package in this precedence order:

1. constitutional policy and safety rules;
2. role authority and operating contract;
3. project sources of truth and architecture;
4. ticket-specific scope, dependencies, and evidence;
5. deliberately retrieved memory and external references.

The package should record sources, versions/hashes, omissions, conflicts, token budget, and freshness.
It should contain bounded summaries plus links to primary sources, not simply concatenate documents.

### 7.5 Execution plane

Execution needs durable attempts, ticket-keyed ownership, idempotency keys for side effects, worktree
identity, checkpoint state, pending irreversible actions, and recoverable termination. A second agent
must be able to resume safely without relying on the previous agent's conversation.

### 7.6 Assurance and evaluation plane

There are three different quality systems and they should not be conflated:

- **artifact verification:** tests whether a particular change satisfies its contract;
- **process verification:** tests whether the team followed its governance and evidence rules;
- **behavioral evaluation:** tests whether roles and workflows make good decisions over realistic,
  adversarial, and long-horizon scenarios.

The evaluation portfolio should include role, role-pair, handoff, workflow, recovery, adversarial,
clean-control, and long-horizon cases. File existence or schema validity is not behavioral evaluation.

### 7.7 Release and operations plane

This plane owns candidate identity, release evidence, deployment authority, staged rollout, health
signals, rollback, incidents, and post-release review. Release state and ticket completion must remain
separate: code can be complete while release health is degraded.

---

## 8. Context, memory, and prompt governance

### 8.1 Memory classes

Use explicit scopes with different retention and approval rules:

| Scope | Purpose | Default lifetime | Promotion authority |
|---|---|---|---|
| Run | Temporary execution observations | One run | none; expires automatically |
| Ticket | Decisions and evidence for one work item | Ticket lifecycle | ticket owner/reviewer |
| Project | Architecture, conventions, recurring product knowledge | Project lifetime with review date | domain owner + curator |
| Platform | Versioned iOS/Android/web/backend guidance | Version applicability window | platform specialist |
| Studio | Cross-project process learning | Until superseded or expired | process owner + curator |
| Founder | Stable preferences and strategic constraints | Until founder changes them | founder/chief-of-staff |

Memory must retain content, provenance, confidence, applicability, contradictions, supersession,
expiry, and reviewer rationale. Retrieval must filter by scope and version. Agents may propose memory;
they must not silently promote their own conclusions.

### 8.2 Prompt and policy lifecycle

Every consequential prompt or policy should have:

- stable identity and semantic version;
- owner and authority level;
- source content or source reference;
- applicable roles/workflows;
- linked evaluation suite and baseline;
- change reason and reviewer;
- activation date and rollback version;
- measured outcome after activation.

A registry containing no governed prompts is an uninitialized system, not a successful system.

### 8.3 Context economy

The team should measure useful context, not maximize context. Repeated boilerplate should live in one
constitutional source. Roles should receive only the knowledge packs triggered by the ticket. Handoffs
should transmit decisions, evidence, and unresolved questions rather than full conversational history.

---

## 9. Work, ticket, Git, and review strategy

### 9.1 Ticket contract

Every implementation ticket should contain:

- desired outcome and linked requirement;
- in-scope and out-of-scope behavior;
- invariants that must remain true;
- affected journeys and state matrix;
- predicted files/systems and downstream consumers;
- dependencies and readiness conditions;
- risk class and required specialists;
- implementation owner and independent reviewer;
- executable acceptance checks;
- required evidence bundle;
- rollback or recovery notes where material;
- actual impact recorded at completion.

### 9.2 Git strategy

Use trunk-oriented, short-lived branches or isolated worktrees per ticket. Shared-file overlap should
be discovered before dispatch. Commits should be small enough for one coherent review decision.
Generated artifacts and unrelated cleanup should not be mixed with feature changes.

### 9.3 Pull-request strategy

Each PR should represent one decision unit and link the complete trace from requirement through
evidence. The PR author owns clarity; reviewers own independent judgment. Material changes after
approval should invalidate the affected approval automatically. Merge authority and release authority
should remain distinct.

### 9.4 Review strategy

Review should be layered:

1. author self-check against ticket invariants;
2. automated contract and regression evidence;
3. independent code/design review;
4. specialist review triggered by risk and impact;
5. integration and journey verification;
6. release audit against the exact candidate.

Review findings should identify severity, evidence, violated invariant, owner, and closure condition.
“Looks good” is not an evidence record.

---

## 10. Communication, escalation, and process health

### 10.1 Communication contract

Every durable team message should do at least one of the following:

- request a named decision;
- record a decision;
- change work state;
- deliver an artifact or evidence;
- declare a blocker or risk;
- create a timed follow-up obligation;
- hand work to a named owner.

Messages without an owner or consequence are discussion, not coordination, and should not pollute
durable state.

### 10.2 Escalation ladder

1. Resolve within the ticket using existing authority and evidence.
2. Escalate to the domain owner when an invariant or specialist policy is involved.
3. Escalate to tech-manager only for coordination, ownership, capacity, or recovery.
4. Escalate to CTO/CPO for cross-domain architecture or product trade-offs.
5. Escalate to founder/release authority only for reserved decisions, budget changes, risk acceptance,
   or unresolved strategic conflict.

Each escalation must include the decision required, deadline, options, recommendation, evidence, and
consequence of no decision.

### 10.3 Process metrics

Measure whether the organization works, not how much it talks:

- lead time from ready to verified;
- blocked time and cause;
- review cycles and reopened work;
- escaped-defect and recurrence rate;
- false-block and unable-to-evaluate rate;
- stale context and invalidated approval frequency;
- recovery success after interruption;
- cost per accepted outcome;
- requirement-to-evidence coverage;
- release rollback and incident rate;
- product outcome movement after release.

---

## 11. Product, mobile, and production depth

### 11.1 Product discovery

The current team concept should expand from requirements intake to hypothesis management. Every major
feature should state the assumption it tests, expected user behavior, success threshold, failure
threshold, and follow-up decision. Research evidence must be dated and distinguish observation from
interpretation.

### 11.2 Mobile delivery

For iOS and Android, “tested” should mean coverage of the triggered device-and-state matrix, including
where applicable:

- clean install, upgrade, migration, relaunch, and interrupted launch;
- offline, slow, failed, retried, and recovered networking;
- permission denied, restricted, changed, and restored;
- background/foreground, process death, and low-resource recovery;
- accessibility, localization, dynamic type/font scale, and dark mode;
- purchase, restore, expiry, refund, family/account changes, and entitlement reconciliation;
- notification/deep-link cold, warm, and invalid paths;
- data deletion, account deletion, sync conflict, and rollback.

The matrix should be risk-triggered and executable where tooling exists. Unexecuted rows remain
explicitly unverified.

### 11.3 Production operations

A proper team also needs:

- an incident-commander authority and response protocol;
- staged rollout and release-health criteria;
- rollback ownership and rehearsal;
- support triage and recurring-issue mining;
- security/privacy incident routes;
- post-incident review with action ownership;
- experiment analysis and product-outcome review;
- dependency, SDK, platform, certificate, and policy-expiry monitoring.

---

## 12. Strategic gaps to close

The following are foundation gaps, not code findings:

| Priority | Gap | Why it matters |
|---|---|---|
| P0 | No single decision constitution governs all roles and workflows | Role descriptions can be locally correct while authority remains ambiguous globally |
| P0 | The role catalogue is clearer than the active-team model | A large roster encourages coordination cost and overlapping responsibility |
| P0 | The lifecycle is described across many artifacts but lacks one normative state model | Commands and agents can implement different interpretations of “ready,” “approved,” or “released” |
| P0 | Product discovery is weaker than delivery governance | The system can build the recorded plan more reliably than it can prove the plan is worth building |
| P0 | Behavioral evaluation is not yet the central improvement instrument | Process additions can increase ceremony without demonstrating better decisions |
| P1 | Context, memory, prompts, and policy are separate features rather than one knowledge architecture | Agents may receive valid fragments without a coherent and applicable operating context |
| P1 | Scheduling is framed primarily as task readiness, not portfolio/resource/risk optimization | Real teams must balance capacity, specialists, shared surfaces, critical path, and human gates |
| P1 | Post-release operations are thinner than pre-release controls | Production learning and incidents cannot reliably improve the next cycle |
| P1 | Ticket schema does not yet express the complete outcome/invariant/evidence contract | Work can be technically done without proving product and operational completeness |
| P2 | Agent observability focuses on visible status more than causal trace | Operators need to understand why a decision occurred, which context was used, and which side effect followed |

---

## 13. Transformation roadmap

### Wave A — Ratify the team constitution

**Objective:** create one normative operating model before adding more implementation.

| ID | Action | Owner | Acceptance |
|---|---|---|---|
| STRAT-001 | Ratify the ten strategic principles | founder + CEO/CTO/CPO | Handbook declares them normative; conflicts are resolved against them |
| STRAT-002 | Publish the decision-rights matrix | chief-of-staff | Every consequential decision has proposer, challenger, decider, executor, and recorder |
| STRAT-003 | Publish the normative lifecycle and state vocabulary | CTO + CPO | All commands, roles, tickets, and dashboards reference one lifecycle |
| STRAT-004 | Define human-reserved and delegable authority | founder | Scope, release, waivers, spend, legal/privacy, and destructive changes have explicit authority |
| STRAT-005 | Define the role-creation and activation rule | CTO + tech-manager | Every catalog role has a trigger, authority reason, input/output contract, and deactivation rule |

### Wave B — Establish the canonical information architecture

**Objective:** define durable truth before changing orchestration.

| ID | Action | Owner | Acceptance |
|---|---|---|---|
| ARCH-001 | Define a shared event envelope and identity model | CTO | Tickets, runs, messages, decisions, approvals, incidents, and learning share traceable identities |
| ARCH-002 | Define the product/evidence graph schema | CPO + CTO + verification | Goal-to-production trace is representable without relying on prose scanning |
| ARCH-003 | Define authoritative artifacts and generated projections | chief-of-staff + CTO | Each datum has one writer/source of truth and known readers |
| ARCH-004 | Define context package and precedence contract | CTO + security | Every run can state exactly what governed its behavior and what was omitted |
| ARCH-005 | Define memory lifecycle and curation policy | chief-of-staff + domain owners | Promotion, expiry, contradiction, supersession, applicability, and retrieval are explicit |
| ARCH-006 | Define prompt/policy lifecycle | CTO + verification | Every consequential instruction has owner, version, evaluations, activation, and rollback |

### Wave C — Strengthen product and planning foundations

**Objective:** improve the quality of what the team chooses to build.

| ID | Action | Owner | Acceptance |
|---|---|---|---|
| PROD-001 | Add opportunity and hypothesis lifecycle | CPO + product-researcher | Major features link evidence, assumptions, experiment, and decision threshold |
| PROD-002 | Formalize product-validator independence | founder + chief-of-staff | Validator cannot author the PRD or be overruled without recorded authority |
| PROD-003 | Upgrade the ticket contract | product-manager + tech-lead | Outcome, invariants, state matrix, impact, risk, evidence, and rollback are standard fields |
| PROD-004 | Add material-change propagation policy | CTO + CPO | Requirement/design/code changes identify consumers and selectively invalidate downstream state |
| PROD-005 | Define readiness as a cross-functional contract | tech-manager | A ticket cannot dispatch without product, design, technical, evidence, risk, and dependency readiness |

### Wave D — Define durable orchestration and recovery

**Objective:** make execution safe to interrupt, resume, parallelize, and audit.

| ID | Action | Owner | Acceptance |
|---|---|---|---|
| ORCH-001 | Specify the deterministic scheduler inputs and outputs | tech-manager + CTO | Readiness includes dependencies, capacity, overlap, specialist availability, risk, and human gates |
| ORCH-002 | Specify run ownership, leases, checkpoints, and idempotency | tech-manager + security | Duplicate execution and duplicate irreversible side effects have explicit prevention/recovery semantics |
| ORCH-003 | Specify manager failover | CTO + tech-lead | A cold manager can reconstruct active work, ownership, pending actions, and required escalation |
| ORCH-004 | Specify bounded autonomy budgets | founder + tech-manager | Spawn, retry, time, cost, and discussion limits have escalation behavior |
| ORCH-005 | Specify capability boundaries at operation level | security + CTO | Files, commands, network, secrets, external mutations, and production actions are governed |

### Wave E — Build the behavioral assurance model

**Objective:** measure whether the team behaves well, not merely whether its artifacts parse.

| ID | Action | Owner | Acceptance |
|---|---|---|---|
| EVAL-001 | Define role contract evaluations | verification-engineer | Every critical role has positive, refusal, ambiguity, and escalation cases |
| EVAL-002 | Define pair and handoff evaluations | verification + tech-manager | Author/reviewer, product/validator, manager/IC, and release/auditor interactions are tested |
| EVAL-003 | Define full workflow evaluations | QA + verification | Golden products cover green, blocked, unknown, interrupted, conflicting, and adversarial paths |
| EVAL-004 | Define long-horizon evaluations | CTO + CPO | The team handles requirement change, incident recurrence, dependency drift, and memory conflict over time |
| EVAL-005 | Define quality and cost scorecard | data + verification | Better behavior, false blocks, escaped defects, recovery, lead time, and cost are measured together |

### Wave F — Complete release, operations, and learning

**Objective:** make the team accountable after code completion.

| ID | Action | Owner | Acceptance |
|---|---|---|---|
| OPS-001 | Define release-candidate and evidence-bundle identity | release-auditor | Approval always names the exact candidate, context, tests, and evidence |
| OPS-002 | Define staged rollout and health gates | release-manager + reliability | Promotion and rollback criteria are explicit before release |
| OPS-003 | Add incident command and post-incident lifecycle | reliability + chief-of-staff | Incidents have commander, severity, timeline, evidence, resolution, review, and owned actions |
| OPS-004 | Add support and experiment feedback loops | product-manager + data | Production evidence returns through intake rather than creating ungoverned backlog |
| OPS-005 | Add dependency/platform/policy freshness ownership | DevOps + platform specialists | Version claims are dated, sourced, monitored, and routed to owners when stale |

---

## 14. Architecture approval gates before code review

Before auditing or changing implementation, leadership should approve these decisions:

1. The ten strategic principles are the constitutional rules.
2. The 29 roles are a bench; activation, not catalogue size, defines the working team.
3. The decision-rights matrix is authoritative when role instructions conflict.
4. The eight-stage lifecycle is the single normative delivery model.
5. Founder scope-lock and production release remain the two normal human gates.
6. Product validation and release audit remain structurally independent.
7. Repository event state is authoritative; dashboards and chat views are projections.
8. Context, memory, prompts, and policy form one governed knowledge architecture.
9. Behavioral evaluations are required before a process enhancement is called effective.
10. Development includes production operation and outcome learning.

Once these are accepted, the next review can map every command, agent, skill, script, schema, hook,
and CI workflow against this architecture and classify it as aligned, missing, duplicated,
contradictory, unenforced, or obsolete.

---

## 15. What 10/10 means

For this plugin, 10/10 should not mean “fully autonomous” or “never makes mistakes.” It should mean
the system is excellent within a clearly bounded operating contract.

The team reaches that standard when:

- founder intent and decision authority are preserved end to end;
- only the necessary roles activate, and every active role has unique accountability;
- every unit of work links an outcome, invariants, impact, risk, and required evidence;
- a cold manager can recover any interrupted run without hidden conversational state;
- no irreversible action can be duplicated or self-approved;
- context, prompts, policies, and memory are versioned, applicable, and reviewable;
- independent assurance can block work and cannot be silently bypassed;
- realistic behavioral evaluations prove role, handoff, workflow, recovery, and adversarial behavior;
- mobile and platform claims identify what was truly executed and what remains unverified;
- release approval binds to the exact candidate and evidence;
- incidents, support signals, experiments, and product outcomes improve the next cycle;
- operators can reconstruct who decided what, why, from which evidence, and with what effect;
- false confidence is systematically harder than honest uncertainty.

At that point the plugin would be a 10/10 **governed AI development-team operating system** for its
declared scope. Human judgment, platform tooling, market reality, and real-user evidence would remain
essential external authorities—and the system would say so plainly.

---

## 16. Recommended next action

Do not add more code yet. First ratify Wave A and the ten architecture decisions in section 14. Then
turn Waves B–F into a sequenced architecture backlog. Only after that should the code-level review
begin, using this document as the evaluation rubric.

The implementation phase should answer one question for every existing component:

> Does this component materially enforce the approved operating model, or does it merely describe it?

---

## 17. Implementation audit — scope and evidence

The implementation review has now been completed against the strategy above. It covered the full
plugin surface rather than only application code:

- 29 role definitions and their activation/authority model;
- 31 skills and 27 commands;
- the event-sourced board, team-message system, worktree controls, run ledger, context manifest,
  scheduler, capability checker, risk router, impact map, prompt registry, memory curator, incident
  ledger, evaluation tools, release gates, hooks, and shared libraries;
- three CI workflows and the mutation/evaluation framework;
- the control-room server, API boundary, state projection, and five operator screens;
- the handbook, command contracts, role instructions, templates, fixtures, and generated views.

The audited base revision was `3b3d75d7f7cf62349473b070ec2a71d442411531`. The working tree also
contained an in-flight nine-file improvement set affecting approval binding, claim leases, strict
new-project policy, capability/risk behavior, and tests. Those changes were included in behavioral
testing, but they were uncommitted and changed while the review was running. This is therefore an
engineering audit of the captured implementation, not a release certification of an immutable
revision.

### Verification performed

| Verification | Observed result | Meaning |
|---|---:|---|
| Full script suite | **818 passed, 0 failed** | Broad static and fixture-level regression coverage is healthy |
| Team coherence doctor | **Clear** | 29 roles, 31 skills, and 27 commands are structurally coherent |
| Dependency check | **Clear with documented limits** | Local manifest/lock checks passed; online freshness/CVE/license verification was not performed |
| Studio defect evaluation | **12/12 defects scored, 0/3 false blocks** | The detector-governance laboratory is strong for its declared corpus |
| General evaluation lab | **2/2 cases** | The framework works, but behavioral team coverage is still minimal |
| Control-room typecheck/build | **Passed** | The separate React/Vite package compiles |
| Control-room localhost smoke | **Five screens passed** | Mission, communications, board, team, and inbox loaded from the real server |
| Concurrent ticket ownership | **56/60 double-starts** | The new lease check is not atomic and does not provide mutual exclusion |
| Concurrent ledger integrity | **49/60 ledgers rejected by run-doctor** | Parallel append can corrupt or fork the hash chain |
| Approval followed by descendant commit | **Incorrectly clear** | The verifier accepts an approved commit as an ancestor although the documented contract says exact commit |

The green suite and the adversarial failures are not contradictory. The suite proves many rules can
fire in controlled fixtures. The adversarial tests show that two critical rules are not yet true
under the actual sequencing and concurrency conditions in which the team is intended to operate.

---

## 18. Revised implementation verdict

### Strategic design: **7.4/10** — unchanged

The target organization, separation of duties, evidence model, local-first philosophy, and
three-state truth principle remain sound. The implementation review strengthens rather than weakens
the central strategic thesis: this is a serious governed engineering pod, not a collection of agent
personas.

### Realized end-to-end operating system: **6.6/10**

The implementation is stronger in individual controls than in lifecycle composition. Several
components are genuinely production-minded, especially the board state machine, message obligations,
worktree isolation, release gates, role activation, mutation laboratory, and control-room boundary.
However, the newly introduced governance primitives are not yet provisioned, enforced, advanced,
terminalized, recovered, and evaluated as one executable path.

The central implementation gap is:

> The plugin has many strong control points, but no single deterministic orchestration spine owns the
> complete ticket lifecycle and proves that every enabled control can be satisfied from project
> initialization through release and recovery.

This means the plugin is not yet 10/10. It is credible for supervised use by an expert operator who
understands the gaps. It is not yet safe to describe as a self-governing AI development team whose
documented controls are all mechanically guaranteed.

---

## 19. Architecture-to-implementation conformance

| Plane | Strongly implemented | Partial or contradictory implementation | Verdict |
|---|---|---|---|
| Governance and authority | Founder intent hash, role activation, independent product validator, reviewer and release-auditor separation, self-approval refusal | Broad agent shell/write permissions are not constrained by the capability manifest; some artifact writer/reader matrices lag the role catalogue | **Strong foundation, incomplete enforcement** |
| Product and discovery | PRD, research, design, analytics, monetization, assumption, and traceability artifacts exist | Product discovery remains document-centric; readiness does not mechanically require all product evidence or material-change propagation | **Designed better than enforced** |
| Delivery workflow | Event-sourced board, legal transitions, dependency readiness, review limits, verified-static lane, generated projection | Legacy manual fallback bypasses event controls; board append is not locked; orchestration is mostly interpreted Markdown | **Strong state machine, weak transaction boundary** |
| Coordination | Chained message log, obligations, formal artifacts, anti-ping-pong rules, cold-readable records | Artifact authority table is incomplete; incident and learning each have competing state models | **Strong but fragmented** |
| Isolation and execution | Worktree gate, destructive-git hook, spawn budget, emergency stop | Dispatch preflight is advisory prose, does not identify the requested ticket, and does not enforce the risk decision or all readiness dimensions | **Useful gates, no unified admission controller** |
| Durable runs and recovery | Chained run events, leases, heartbeats/checkpoints, run doctor, recovery command | Claim IDs are discarded, normal workflow does not close leases, appends are not atomic, failover is advisory | **Primitive exists; lifecycle is unsafe** |
| Context and knowledge | Layered context manifest with hashes/provenance; governed memory proposal/review ledger | Context is not compiled or semantically validated; promoted memory loses its payload in the latest-state view; `/app-learn` bypasses the curator | **Provenance primitives, not a knowledge architecture** |
| Risk and capability | Explicit manifests, fail-closed missing inputs, file/path checks, risk output | Static regex and prefixes do not govern shell, network, secrets, external systems, destructive operations, or tool invocation; risk recommendations are not enforced | **Narrow classifiers presented as broad controls** |
| Independent assurance | Ship gate, runtime gate, verify-done, CI, mutation tests, strong defect corpus | General team-behavior evaluation has only two cases; role/handoff/recovery/long-horizon behavior is unproved | **Excellent detector discipline, insufficient organizational evaluation** |
| Release and audit | Release manager/auditor split, evidence gates, audit-chain verification, optional candidate binding | Ship gate omits current HEAD from approval verification; same-repo audit anchor is rewritable; no staged rollout/health state machine | **Good release checklist, incomplete candidate identity and operations** |
| Incidents and learning | Chained incident and memory ledgers exist | Repeated incident resolution is accepted; no incident commander/postmortem workflow; two incident models and two learning paths conflict | **Scaffolding, not an operational loop** |
| Operator control room | Local-only server, CSRF, action whitelist, transparent unavailable states, five useful views | A tampered event log can still feed derived views; UI is a projection and does not close lifecycle gaps | **Thoughtful observability plane** |

---

## 20. Severity-ranked confirmed findings

### P0 — controls enabled by default cannot complete a normal fresh-project journey

`/app-init` now enables durable runs, approval binding, audit anchoring, prompt registration, and
evaluation for new projects. That is the correct desired posture, but initialization does not create
or configure the complete artifact set and the normal build flow does not maintain it:

- no normal command creates the audit anchor before the ship gate verifies it;
- no normal workflow populates the checked-in empty prompt registry;
- no normal workflow creates a project-specific evaluation manifest;
- the build command does not provision a context manifest, schedule, capability manifest, risk
  policy, or their ticket-specific inputs;
- a ticket claim creates a run lease, but the ordinary board workflow does not complete, interrupt,
  or abandon that lease;
- approval binding is described in role files but remains optional at the board command boundary.

The likely result is a fresh project that follows the documented path and then blocks at release on
governance artifacts the path never taught it to produce, or on a run lease it never taught it to
close. Strict-by-default is safe only when bootstrap and the golden journey make strict compliance
possible.

### P0 — ticket ownership and chained ledgers are not concurrency-safe

`run-ledger start` performs read → check active lease → append without a lock. Sixty simultaneous
two-agent starts for unique tickets produced 56 double owners. Because both processes can hash the
same previous tip, 49 resulting ledgers failed `run-doctor` integrity checks.

The board has the same read/reduce/append shape without a process lock. The message subsystem already
contains a lock-directory approach; the event stores need a shared atomic append primitive, or a
single-writer service, with stale-lock recovery and adversarial tests.

The new sequential test is valuable but proves only that a second request is refused after the first
append is visible. It does not prove mutual exclusion.

### P0 — run ownership is created but not connected to ticket lifecycle

The board's `claimed` transition spawns a run-ledger process using generated IDs, then discards those
IDs. A later board transition cannot identify which run to heartbeat, checkpoint, complete, interrupt,
or abandon. If lease creation succeeds and board append fails, an orphan lease remains. If the ticket
finishes normally, no terminal run record is produced by the documented loop.

Run identity must be part of the claim event and ticket projection. Claim and lease creation must be
one atomic operation, and every terminal or ownership-changing board transition must drive a legal
run transition.

### P0 — approval binding does not enforce the documented exact candidate

`approved --bind` correctly computes a commit and diff hash and hashes evidence/context files. The
reviewer and manager instructions now say the approval is bound to the exact commit and that a later
commit invalidates it. The verifier instead accepts the approved commit when it is any ancestor of
the supplied HEAD. An isolated reproduction added a post-approval descendant commit and still
received `APPROVAL CHECK: CLEAR`.

Additionally, the ship gate calls `approval-check` without `--head`, so release does not perform even
the ancestor comparison. Evidence and context paths are not recorded, so their current contents
cannot be recomputed; only hash presence is checked. The approval artifact needs a release-candidate
identity containing the exact tree/commit, diff/base, evidence manifest, context snapshot, and policy
version. Merge and release must compare against that exact identity.

### P1 — dispatch preflight is not ticket admission or policy enforcement

The dispatcher verifies that four tools return success, but it takes no ticket ID and never proves
that the requested ticket appears in `schedule.ready`. An empty schedule is therefore a successful
dispatch input. Risk output is returned but its requested model, approvals, and evidence are not
enforced. Impact analysis, budgets, worktree ownership, specialist capacity, file overlap, human
gates, and run leases are outside the composition.

Most importantly, “no role launches until preflight” is a Markdown instruction. The Task/Agent tool
boundary has no mechanical admission hook. The current component should be called a preflight
report until it becomes a ticket-specific, enforceable admission decision.

### P1 — control status confuses uninitialized with clear

The prompt registry reports clear with zero entries and the scheduler reports success with zero
tasks. Structurally valid empty files are useful templates, but they are not evidence that active
prompts or work were governed. Every control needs explicit applicability and coverage semantics:
`UNINITIALIZED`, `NOT_APPLICABLE`, `CLEAR`, `VIOLATION`, and `CANNOT_EVALUATE`.

### P1 — memory and learning are disconnected and lossy

After a memory proposal is promoted, `list` emits the latest review record, which contains the
decision and rationale but not the original content, class, scope, confidence, expiry, supersession,
or contradiction metadata. Expiry and contradiction are recorded but not enforced. Concurrent
append is not locked.

Separately, `/app-learn` edits knowledge packs directly and bypasses the governed memory ledger.
There are therefore two learning systems with no promotion contract between them. The correct model
is proposal → independent review → applicable memory view → deliberate knowledge-pack update, with
provenance and rollback retained throughout.

### P1 — incident management has duplicated authority and an invalid reducer

The incident ledger accepts resolving the same incident twice because “open” is inferred from any
earlier non-resolved event rather than the latest reduced state. The plugin also has a separate formal
`INCIDENT` message artifact with a different authority matrix. There is no explicit incident
commander, severity authority, communication cadence, postmortem gate, corrective-action tracking,
or release-health state machine.

One canonical incident aggregate should own state. Messages and control-room views should project it.

### P1 — context proves provenance, not readiness

The context manifest honestly hashes selected sources and records precedence, rough size, and git
HEAD. It does not select mandatory sources, compile decision-ready context, enforce a token budget,
resolve contradictions, check version applicability, or selectively invalidate consumers after a
material change. Any HEAD change can stale the entire context, while semantically critical omissions
may remain only advisory notes.

This is a useful provenance boundary. It should not yet be treated as a context compiler or complete
readiness proof.

### P1 — broad agent permissions bypass the capability model

Role frontmatter commonly permits broad Bash, Write, and Edit access. The capability manifest checks
a declared operation and path supplied to a script; it does not mediate the actual tool call. Shell,
network, secrets, package installation, external mutation, production access, and destructive side
effects are not governed by the manifest.

Capabilities should be enforced where operations occur, with default-deny scopes and explicit
time-bound grants. Until then, the manifest is advisory defense-in-depth.

### P2 — audit anchoring is tamper evidence without an independent trust root

The audit anchor hashes the board log and records the tip and git head, which is useful. Because the
anchor and log live in the same writable repository and the normal lifecycle does not publish the
anchor to a protected external authority, both can be rewritten together. Verification also does not
establish that the recorded git head is the release candidate.

Describe this accurately as a local sidecar checksum until CI artifact signing, protected branch
attestation, transparency storage, or another independent trust root is added.

### P2 — dependency, platform, and policy freshness are local tripwires

The dependency checker intentionally performs local manifest/lock consistency checks. It does not
establish current versions, CVEs, licenses, vendor deprecations, platform compatibility, or current
official documentation. Version extraction is heuristic and CI installs some tooling without a
pinned version. These are acceptable constraints if output and ownership remain explicit.

### P2 — documentation and generated metrics drift

The handbook's command/script counts lag the current inventory, workflow comments retain older test
counts, the studio evaluation text mislocates the runtime job, and older resume/review documents mix
historical and current truth. Volatile inventory and verification numbers should be generated from
one status command and embedded or linked, not copied manually.

---

## 21. What is already excellent and should be preserved

The audit does not recommend a rewrite. These components are valuable foundations:

1. **The event-sourced board model.** Legal transitions, separation of approval, dependency
   readiness, review-cycle limits, verified-static handling, and generated views are exactly the
   right direction.
2. **The team-message and obligation model.** Durable communication, formal artifacts, explicit
   response obligations, and anti-ping-pong rules are unusually mature.
3. **Worktree isolation and destructive-git protection.** These controls address observed failure,
   are mechanically enforceable, and have high practical value.
4. **Role activation and independent assurance.** The role catalogue works best as a capability
   bench with dynamic activation; product validation, implementation, review, QA, and release audit
   should remain separate authorities.
5. **Three-state release semantics.** The distinction between failure and inability to evaluate is
   foundational and should be propagated to all new controls.
6. **Mutation and defect-evaluation discipline.** The studio laboratory is a strong example of
   proving that controls can fail without creating false blocks.
7. **The local-first control room.** It is appropriately a projection, uses a narrow local action
   surface, and displays unavailable state honestly.
8. **Founder-intent and traceability controls.** Preserving intent as an immutable input to later
   product and release decisions is strategically important.

The right next step is to connect these strengths through one executable lifecycle, not replace them
with a larger framework.

---

## 22. Development strategy changes after implementation review

The target architecture does not change. The implementation sequence does.

The earlier plan moved from constitutional decisions into artifact contracts and then orchestration.
The audit shows that another layer of control design would increase the gap between named capability
and operational truth. A new **Wave 0 — Integration Closure** must precede Waves A–F.

### New governing delivery rule

No new control is considered implemented until one golden journey proves all seven responsibilities:

```text
provision → admit → enforce → record → terminalize → recover → evaluate
```

For example, a durable-run feature is incomplete if it can create a lease but cannot bind it to a
ticket, close it on success, recover it after interruption, and reject a real concurrent duplicate.

### Strategic changes

1. **Shift from horizontal control proliferation to vertical lifecycle slices.** Complete one
   project path end to end before adding another checker or role.
2. **Make one executable orchestration spine authoritative.** Markdown remains the human-readable
   operating manual, but a deterministic lifecycle controller owns admission and state transitions.
3. **Treat event stores as infrastructure.** Atomic append, locking, idempotency, reducer validity,
   and recovery become foundational work, not script refinements.
4. **Enable strict policy only with a satisfiable bootstrap.** A new project receives every required
   artifact, owner, command, and initial status—or the control remains explicitly `UNINITIALIZED` and
   shipping is disallowed with a precise remediation path.
5. **Unify duplicated aggregates before adding features.** One incident state model, one governed
   memory/learning pipeline, one ticket/schedule identity, and one release-candidate identity.
6. **Test behavior at the failure boundary.** Concurrency, interruption, stale approvals, duplicate
   side effects, context changes, recovery, and authority conflicts join the required suite.
7. **Delay richer control-room features.** The UI should expose authoritative state after lifecycle
   correctness exists; it must not become a compensating workflow engine.
8. **Use generated capability claims.** Handbook and marketplace claims should be derived from
   enabled, covered, and recently verified controls rather than feature-file presence.

---

## 23. Wave 0 — implementation closure action plan

### Gate 0: freeze and establish a reproducible baseline

| ID | Action | Acceptance |
|---|---|---|
| IC-000 | Commit or isolate the in-flight improvement set | One immutable revision is named as the implementation baseline |
| IC-001 | Generate inventory and verification metadata | Counts, revision, environment, policy state, and test results come from one command |
| IC-002 | Add a golden fresh-project fixture | `/app-init` through approved release can be exercised without hand-created hidden artifacts |

### Gate 1: build a safe authoritative event-store primitive

| ID | Action | Acceptance |
|---|---|---|
| IC-010 | Add atomic append/lock/idempotency to chained ledgers | Two concurrent writers cannot both acquire one ticket or fork a valid chain |
| IC-011 | Reuse the primitive for board, runs, incidents, memory, and other chained logs | No independent read-check-append implementation remains |
| IC-012 | Add crash and stale-lock recovery | Interrupted append cannot permanently block or silently truncate the ledger |
| IC-013 | Add reducer/state-machine property tests | Illegal, repeated, reordered, and duplicate events are refused deterministically |

### Gate 2: connect ticket, run, scheduler, and dispatch identity

| ID | Action | Acceptance |
|---|---|---|
| IC-020 | Put `run_id` and `attempt_id` in the claim event | Every claimed ticket names its active run and owner |
| IC-021 | Make claim + lease one atomic/idempotent transaction | Board and run ledger cannot disagree after failure or retry |
| IC-022 | Terminalize runs from ticket outcomes | Complete, interrupt, abandon, timeout, reassignment, and recovery have explicit transitions |
| IC-023 | Make dispatch ticket-specific | The requested ticket must be ready in the canonical schedule and board projection |
| IC-024 | Enforce the dispatch result at the spawn boundary | A role cannot launch when admission is absent, stale, for another ticket, or denied |

### Gate 3: make strict bootstrap satisfiable

| ID | Action | Acceptance |
|---|---|---|
| IC-030 | Provision policy, context, capability, risk, impact, schedule, prompt, evaluation, and audit artifacts | A new project has owned, non-empty, applicable initial state |
| IC-031 | Define control coverage statuses | Empty templates never report `CLEAR`; each control exposes applicability and coverage |
| IC-032 | Add lifecycle commands for create/update/verify | Every strict release requirement has a normal upstream producer and remediation command |
| IC-033 | Run the golden project through ship gate | Strict defaults pass without bypasses, manual ledger editing, or undocumented steps |

### Gate 4: bind approval and release to one exact candidate

| ID | Action | Acceptance |
|---|---|---|
| IC-040 | Define release-candidate manifest | Candidate commit/tree, base/diff, policy, context, prompts, tests, evidence, and artifact hashes are named |
| IC-041 | Require bound approval at the state transition | Strict policy refuses bare approval, not only release-time verification |
| IC-042 | Compare exact candidate at merge and release | Any added, amended, rebased, force-pushed, or rebuilt candidate requires re-approval |
| IC-043 | Store recomputable evidence references | Missing or changed evidence/context is detected, not inferred from hash-field presence |

### Gate 5: unify operations and learning

| ID | Action | Acceptance |
|---|---|---|
| IC-050 | Replace duplicate incident models with one aggregate | Open, mitigate, resolve, reopen, review, and action tracking have one reducer and authority model |
| IC-051 | Add incident command authority and release health | Severity, commander, communications, rollback, recovery, and postmortem are explicit |
| IC-052 | Join memory curator and `/app-learn` | Promoted memory retains payload and provenance and is the only route into durable knowledge |
| IC-053 | Enforce applicability, expiry, contradiction, and supersession | A cold agent retrieves the current valid view without reading raw history incorrectly |

### Gate 6: prove team behavior

| ID | Action | Acceptance |
|---|---|---|
| IC-060 | Add role-contract evaluations | Critical roles pass positive, refusal, ambiguity, and escalation cases |
| IC-061 | Add authority-pair and handoff evaluations | Author/reviewer, product/validator, manager/IC, and release/auditor boundaries are demonstrated |
| IC-062 | Add concurrency/interruption/adversarial workflows | The reproduced ownership, ledger, approval, incident, and memory failures stay fixed |
| IC-063 | Add a cold-manager recovery evaluation | A manager reconstructs exact active state and next legal action without conversation history |
| IC-064 | Add long-horizon product evaluations | Requirement drift, dependency change, incident recurrence, learning conflict, and rollback are covered |

Only after Gates 0–6 pass should the earlier Waves A–F resume. Their architecture remains useful, but
implementation work should now consume it through vertical, acceptance-tested slices.

---

## 24. Updated final verdict

The plugin is already a sophisticated **AI-assisted engineering governance system**. Its strongest
parts are materially better than typical agent-team projects: authority separation, event-sourced
work state, durable communications, isolation, release refusal, and mutation-based detector testing.

It is not yet a complete AI development team operating system because its most important new controls
are still individual primitives rather than one closed operational loop. The path to 10/10 is not a
larger agent roster or another layer of prose. It is an executable golden journey in which every
enabled control is provisioned, enforced at the real boundary, durably recorded, safely terminalized,
recoverable by a cold manager, and proven under adversarial conditions.

The implementation review therefore changes the immediate development strategy from **expand the
architecture** to **close the lifecycle**. Once Wave 0 is complete, the original strategy becomes
substantially more achievable because its foundations will be executable rather than aspirational.
