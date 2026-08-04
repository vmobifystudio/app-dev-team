# Daily Reading Log — second workflow dry-run review

**Date:** 2026-08-01  
**Pilot:** `dry-runs/daily-reading-log`  
**Comparison baseline:** [Android small-app dry run](./2026-08-01-android-small-app.md)  
**Primary objective:** validate idea-to-documents-to-tickets-to-team coordination, not final app build  
**Change boundary:** only the new dry-run fixture and this review document were created/edited for
this pilot. Plugin source, commands, scripts and control-room implementation were not intentionally
edited during this run.

## Executive verdict

The second workflow run is a meaningful improvement over the first. The system now demonstrated a
clean product-document graph, a coherent event-backed board, valid spawnable ticket ownership,
durable team messages, correct static-versus-executable state handling, and a control-room projection
that surfaced the last recorded ship-gate verdict as `attention`.

It still did not prove true multi-agent execution. The artifacts were produced sequentially by one
Codex session while simulating role identities. It also did not reach a submission-ready verdict:
four tickets remain planned, one ticket is merged only on static evidence, QA is still HOLD, and
candidate/handoff artifacts do not exist.

### Maturity score for this run

| Dimension | Run 1 | Run 2 | Assessment |
|---|---:|---:|---|
| Founder intent recording | 8/10 | 9/10 | Hash-recorded and intact in both runs |
| Product document completeness | 6/10 | 8/10 | Second run includes explicit SRS, sourced criteria and test rows |
| Requirement traceability | 3/10 | 9/10 | First run failed; second reaches `TRACE — TRACED` |
| Roster activation | 5/10 | 7/10 | Correct states now work, but generated-template drift remains a risk |
| Ticket planning | 6/10 | 8/10 | Second run uses only spawnable implementation owners |
| Team communication | 7/10 | 8/10 | Questions, answers, artifacts and transitions are durable |
| Review/verification state machine | 8/10 | 8/10 | Static verification correctly cannot close tickets |
| Control-room truthfulness | 3/10 | 7/10 | Last ship-gate verdict is now surfaced; candidate readiness is still absent |
| True agent orchestration | 3/10 | 3/10 | Not proven in either run |
| Submission-readiness architecture | 4/10 | 4/10 | Candidate, verdict and founder-action aggregates remain absent |

**Overall workflow maturity for this run: 7.2/10.**

This is a workflow score, not an app-quality or store-readiness score.

## Idea and intended flow

The founder idea was recorded as:

> Create a small offline Android app called Daily Reading Log. A person should be able to record one
> book title and the number of pages read today, edit it, and reopen the app without losing it.

The tested lifecycle was:

```text
founder brief
  → intent manifest
  → intake and utility/android activation
  → vision and scope lock
  → PRD + SRS + stories + backlog
  → flows/design/architecture/Android specification
  → event-backed tickets
  → agent question and answer
  → claim → static verification → review → approval → merge → QA
  → trace and ship/control-room review
```

The run intentionally stopped before implementation build, store upload or founder submission.

## Artifacts produced

The pilot produced:

- immutable founder brief, constraints, decisions and `MANIFEST.sha256`;
- vision and scope lock;
- requirements intake;
- utility-tier Android roster with every role explicitly classified;
- PRD with user stories and feature requirements;
- SRS with functional/non-functional requirements and acceptance criteria;
- backlog;
- flows and state inventory;
- design tokens and component inventory;
- Android architecture and implementation specification;
- engineering principles and Git strategy;
- project `CLAUDE.md`;
- store-readiness inventory and founder-only boundary;
- explicit no-event-data analytics record;
- QA test plan and bug board;
- event-backed board with five tickets;
- generated team message view and JSONL ledger;
- `.studio-policy.json` with durable-run, approval, audit-anchor, prompt-registry and evaluation
  requirements.

## What worked well

### 1. Intent preservation is strong

The founder material was recorded before interpretation, hashed, and verified intact. The team had a
stable external reference for scope rather than relying on the latest PRD wording.

### 2. The document graph can become fully traceable

After correcting authoring structure, the second run reached:

```text
TRACE — TRACED — 29 node(s), 5 ticket(s), no break in the chain.
```

This is the clearest improvement over the first run, where the tracer exposed undeclared features,
missing criteria and template false positives.

The successful pattern was:

- one canonical declaration for each `[F-NNN]` requirement;
- `[AC-NNN]` criteria with `src: F-NNN`;
- `[T-NNN]` test rows with `src: AC-NNN` and `ver: AC-NNN`;
- ticket feature cells pointing to declared requirements;
- intentional no-analytics represented as `[EV-001] ... state: no-event-data`.

### 3. Ticket ownership improved

The first run created a `tech-lead` implementation ticket and board doctor rejected it because the
build loop cannot spawn tech-lead as an implementation owner. The second run used only
`android-developer`, `qa-engineer` and `devops-engineer` for tickets, and:

```text
BOARD DOCTOR — 5 ticket(s) checked
Board is coherent. Safe to spawn.
```

This validates that owner selection can be made compatible with the current loop.

### 4. Communication is durable and useful

The Android developer asked whether zero pages should be accepted. Tech-lead answered that pages
must be positive, named `docs/03-srs.md`, and recorded the transition/evidence context. The channel
contained both the question and answer as durable JSONL records and generated Markdown.

This is the correct shape: the answer is not just conversational reassurance; it reaches an artifact.

### 5. Static-only verification remains an excellent guard

APP-101 moved through:

```text
todo → in_progress → verified_static → review → approved → qa
```

The board allowed review, approval and merge, but did not permit closure. This correctly prevents a
team from claiming tests passed when only static/document checks ran.

### 6. Control-room synchronization improved

For the second run, the control-room state projected:

- overall status: `attention`;
- four in-flight tickets;
- one static-only ticket;
- the last recorded ship-gate `CANNOT_EVALUATE` verdict and reasons.

This is materially better than the first run, where the same type of blocked project displayed
release readiness as `clear`.

### 7. Safety boundary held

No store credentials, Play Console API, upload, submission, staged rollout or production mutation
was attempted. The founder-only boundary remained intact.

## What is still not working well

### P0 — real multi-agent execution remains unproven

The run recorded role-specific actions, but one Codex session produced them sequentially. We did not
prove:

- actual parallel agent processes;
- isolated worktrees;
- model-tier routing;
- retry escalation;
- agent crash/recovery;
- context-manifest enforcement between agents;
- independent agents disagreeing and resolving through durable state.

The current result validates the contracts and reducers, not the actual team runtime.

### P0 — submission readiness is still not one authoritative aggregate

The control room improved by showing the last ship-gate verdict, but it still does not have:

- immutable release candidate identity;
- candidate-bound structured verdicts;
- founder-action ledger;
- package and metadata inventory;
- legal/dependency/policy applicability matrix;
- fresh evidence and expiry checks;
- final founder handoff manifest.

The system can say a sprint is blocked, but it cannot yet prove a complete app is ready for founder
submission.

### P1 — project templates and trace grammar are too easy to misuse

The first run showed that plain `F-001` text was not enough for the tracer. The second run began
with duplicate requirement declarations because the same feature IDs were declared in both PRD and
SRS. It became clean only after applying the exact grammar and choosing one canonical declaration
location.

The authoring workflow should make the right structure automatic. Agents should not need to read
tracer implementation code to discover how to write a valid PRD.

### P1 — template prose can still look like a waiver

The second run initially reproduced the first run’s false founder-waiver trigger because the copied
roster template contained explanatory `WAIVED:` text. Removing that text from the generated fixture
made the graph pass, but this is not a durable system fix.

The tracer should parse structured waiver records or ignore templates/examples/fenced prose.

### P1 — the planner still needs role/authority-aware ticket validation

The second run avoided the first run’s invalid tech-lead owner, but only because the ticket list was
manually designed correctly. The system still needs to reject or transform a planning ticket whose
owner is not a spawnable implementation role.

Tech-lead needs a supported form of design/spec work, either as:

- a planning artifact outside the implementation board;
- a ticket type with a declared non-build owner;
- or a spawnable implementation owner with tech-lead as authority/reviewer.

### P1 — static-only tickets need a visible follow-up path

The refusal to close APP-101 is correct, but the resulting state is operationally incomplete. A
ticket can sit in `qa (static only)` without a generated human or team action explaining who must run
the executable suite and when.

The reducer should generate an explicit action:

```text
APP-101 — executable verification required
Owner: qa-engineer / android-developer
Reason: static verification is not test execution
Unblocks: ticket closure and submission readiness
```

### P1 — QA and release controls are not yet candidate-aware

The test plan correctly says `QA VERDICT: HOLD`, and ship gate correctly blocks. However, the QA
result is still a project-level Markdown line rather than a structured verdict tied to a candidate,
artifact, test environment, timestamp and evidence bundle.

### P2 — no true implementation was exercised in the second run

That was intentional for this objective, but it means the run did not test source edits, conflict
resolution, code review diffs, test failures, or recovery from a rejected implementation.

The next workflow run should include one deliberately small implementation ticket after the planning
and communication phase, while still treating build success as secondary.

## Comparison with the first run

| Area | First run | Second run | Interpretation |
|---|---|---|---|
| Idea | One Daily Task | Daily Reading Log | Different product shape; workflow generalizes |
| Intent | Recorded and intact | Recorded and intact | Stable strength |
| PRD/SRS | Partial and loose | Explicit sourced graph | Significant improvement |
| Trace | Multiple breaks | `TRACED` after document correction | Strong improvement |
| Roster | Required template corrections | Same template risk reproduced, then corrected | Underlying generator still needs work |
| Board | Invalid tech-lead owner | Board doctor passes | Improvement through correct ticket design |
| Messages | Question/answer worked | Question/answer worked again | Durable communication is repeatable |
| Static verification | Correctly blocked closure | Correctly blocked closure | Stable strength |
| Control room | False `clear` | `attention` with last gate verdict | Material improvement |
| Candidate/handoff | Missing | Missing | Not yet implemented |
| Real agent runtime | Not proven | Not proven | Unchanged gap |

## Recommended fix plan

### Wave 1 — make authoring safe

1. Provide canonical PRD/SRS/test-plan templates with one declaration location per node.
2. Add an authoring validator that runs before planning and explains `[F]`, `[AC]`, `[T]`, `[EV]`
   and `src`/`ver` syntax.
3. Make the tracer ignore fenced examples, copied templates and explanatory prose when detecting
   structured gates.
4. Add a generated-doc test proving a fresh `/app-init` project reaches traceable structure without
   manual syntax repair.

### Wave 2 — make planning authority-safe

1. Validate ticket owners against the actual spawnable implementation roster during `board add`.
2. Add an explicit planning/specification work type or represent tech-lead work as an artifact,
   not an implementation ticket.
3. Generate follow-up actions for static-only verification rather than leaving tickets indefinitely
   in `qa`.

### Wave 3 — make workflow execution real

1. Run the same pilot through actual multi-agent orchestration.
2. Require one worktree per writing agent.
3. Capture model tier, role, context manifest, source hashes, branch and ticket in every action.
4. Force one review-change cycle and verify retry escalation.
5. Kill one agent mid-task and verify recovery from durable state.
6. Compare the resulting board/message/evidence records against this single-agent baseline.

### Wave 4 — unify submission readiness

1. Create an immutable `ReleaseCandidate` manifest.
2. Emit structured candidate-bound verdicts for QA, policy, dependencies, privacy, security, legal,
   metadata and artifacts.
3. Add the founder-action ledger and handoff manifest.
4. Make CLI, dashboard and control room use the same reducer.
5. Ensure any missing, stale, contradictory or candidate-mismatched source results in `NOT READY`
   or `CANNOT EVALUATE`, never `clear`.

## Final assessment

The second run proves that the system can generalize a workflow across two different Android ideas.
The document graph, event-backed tickets, communication ledger, owner checks and static-verification
guard are the strongest parts.

The system is not yet a fully autonomous AI development team because actual agent orchestration is
unproven and the final submission-readiness aggregate does not exist. The next investment should be
workflow runtime evidence and authoritative state synchronization, not polishing build commands.

**Recommended next pilot:** execute one small implementation ticket through real isolated agents,
force one review rejection and retry, then inspect whether the durable records tell the same story as
the agents' reports.
