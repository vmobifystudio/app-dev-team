# Studio self-improvement & local-skill-reuse — transformation plan

**Date:** 2026-08-03
**Status:** Proposed, not started
**Scope:** (1) make the studio's own roles prefer better-equipped local skills/agents over
reinventing them from scratch, (2) give the studio a real, governed system for capturing what it
learns about its OWN process (not the apps it builds) across real runs, so those learnings
actually reach the next version instead of living in a dry-run report nobody re-reads.

## Why this, why now

Every fix this session (PR #17, #18, #19) came from the same place: a real multi-agent dry run
surfaced a defect, I read the report, fixed it by hand, and wrote a mirror-tested regression. That
loop works, but it is **manual and session-bound** — the next session has to remember to go read
`docs/dry-runs/*.md` itself. There is no durable, governed record that says "the studio learned X
on 2026-08-02 and here is what changed because of it," the way `knowledge/failure-corpus.md`
already does for defects in the **apps** the studio builds.

Two gaps, one shape:

1. **Local-skill blindness.** This environment already has a real, populated ecosystem of
   specialized subagents — Axiom iOS skills (SwiftUI architecture/layout/navigation/performance,
   SwiftData, Core Data), `ui-design:*` (accessibility-expert, design-system-architect,
   ui-designer), `frontend-mobile-development:*` (frontend-developer, mobile-developer),
   `comprehensive-review:*` (code-reviewer, security-auditor). None of this plugin's own roles
   (`agents/ios-developer.md`, `agents/ux-designer.md`, `agents/code-reviewer.md`, etc.) check for
   or defer to any of it. They work from prompt knowledge alone every time, which risks quietly
   reinventing a weaker version of a tool that is already installed.

2. **Process-learning blindness.** `scripts/memory-curator.mjs` already has a `studio` scope in its
   class vocabulary (`const classes = new Set(['run', 'ticket', 'project', 'platform', 'studio',
   'founder'])`) — but **nothing has ever written to it**. It is pure scaffolding, the exact
   pattern this repo's own strategy review flagged and fixed twice already this session (a
   leasing primitive with no caller, a prompt registry validating an empty shape). `/app-learn`
   mines shipped apps for conventions and failures; nothing mines a dry run for what the STUDIO
   itself should do differently next time — the right questions to ask, output formats that had
   to be manually reworked, flow logic that had to be reordered, gates that were missing, roles
   that were missing or redundant.

Both gaps have the same fix shape: **extend an existing, working mechanism rather than build a
parallel one.** Local-skill-reuse extends the role files' own instructions. Process-learning
extends `memory-curator.mjs`'s already-governed propose → review → retrieve pipeline, the same one
`docs/HANDBOOK.md` already documents as closing "unreviewed, unscoped, unprovenanced agent
memory."

## Guiding principles (same discipline as the rest of this session)

- Extend what exists; don't build a second learning system next to the one that's already there.
- Every promotion is a human review step. Nothing here auto-changes agent behavior — a promoted
  learning becomes a proposal for a future PR, the same way a `code-reviewer` finding becomes a
  proposal, never an automatic edit.
- Every new check ships with a mirror-tested `scripts/test.sh` assertion before it counts as done.
- Honest scope: local-skill-reuse is advisory prose ("prefer it if present"), not a hard
  requirement — an environment with none of these skills installed must not be blocked or degraded.

## Phase 1 — Local-skill discovery and deferral — **ALREADY DONE, verified 2026-08-03**

Before starting this phase, I checked whether it was actually a gap. It is not. 11 of 30 role
files already reference external local skills/subagents with explicit "external and optional —
not installed → say so, degrade to house knowledge, never file absence as a defect" language:
`ios-developer.md`, `android-developer.md`, `product-designer.md`, `web-developer.md`,
`code-reviewer.md` (via its canonical auditor table), `security-reviewer.md`,
`privacy-reviewer.md`, `qa-engineer.md`, `monetization-engineer.md`, `aso-specialist.md`,
`release-manager.md`, `devops-engineer.md`. There is even a named incident behind it — `DR4-011`:
an agent hunted the local `skills/` directory for an Axiom skill, failed, and filed a false defect
— and `scripts/test.sh` already has a mirror-tested regression enforcing every external-skill
reference stays marked (`every file referencing an external skill marks it external-and-optional`).

Writing "new" instructions here would only duplicate what already exists and is already enforced.
**No changes made.** The section below is kept as the original proposal for the record, in case a
future session wants to extend the PATTERN to a role not yet covered (e.g. `ux-architect.md`,
which currently has no external-skill reference — correctly, since no IA/flow-specific external
agent was found available in this environment to reference).

<details>
<summary>Original Phase 1 proposal (superseded by the finding above)</summary>


**Goal:** the studio's own implementation/design/review roles check whether a better-equipped
local skill or subagent is already available before working from their own prompt knowledge alone.

1. Add a short "check local capability first" section to the roles where it matters most:
   `agents/ios-developer.md`, `agents/android-developer.md`, `agents/ux-designer.md`,
   `agents/code-reviewer.md`, `agents/security-reviewer.md`. Each section names the CATEGORY of
   tool to look for (platform-specific auditor, design-system/accessibility tool, review/security
   specialist) rather than a specific product name, since what's actually installed varies by
   environment and this plugin cannot assume any particular one is present.
2. The instruction is explicitly **best-effort and advisory**: "if a more specialized local skill
   or subagent for this exact task is available, prefer it or consult it; if none exists, proceed
   with your own knowledge as before." Never a hard gate — `dispatch-preflight.mjs` and the other
   mechanized gates stay exactly as strict as they are; this is judgment prose for the agent doing
   the work, not a new pass/fail check, because "is a better tool installed" isn't something this
   repo can mechanize without assuming a specific host's toolset.
3. `team-doctor.mjs`: no new mechanized check for this phase — documented explicitly as
   intentional (a rule that can't be mechanized shouldn't pretend to be one), not silently skipped.

**Regression tests:** a `test.sh` assertion per touched role file confirming the discovery
instruction is present and named the right category (grep-based, matching this repo's existing
`path_spelling`/contract-drift check style).

</details>

## Phase 2 — Give the `studio` memory scope a real producer

**Goal:** close the gap where a dry run's findings about the studio's own process live only in a
Markdown report a future session has to remember to re-read.

1. Extend `/app-learn` (or add a sibling command, `/app-learn --process <dry-run report path>`) to
   read a completed dry-run report or an `/app-ship` retro and extract candidate STUDIO learnings —
   explicitly distinct from the app conventions `/app-learn` already mines. Categories: a question
   that should have been asked earlier, an output format that had to be manually reworked, flow
   logic that had to be reordered, a missing gate, a missing or redundant role.
2. Each candidate is written with `memory-curator.mjs propose --scope studio --class <category>`
   — reusing the pipeline that already exists rather than inventing a new ledger format.
3. A human (or a dedicated reviewer role, decided during implementation) runs
   `memory-curator.mjs review` to promote or reject each candidate — same governance model as
   every other memory scope today, never auto-applied.
4. `/app-status` (or a control-room panel) surfaces PENDING `scope: studio` proposals so they
   don't silently rot unreviewed — mirroring the Founder Inbox pattern already used for release
   readiness and open questions.

**Regression tests:** propose a sample studio-scope learning from a fixture dry-run report,
confirm `review` promotes/rejects it, confirm `retrieve --scope studio` returns only promoted
entries, confirm an un-reviewed proposal does not surface as accepted guidance anywhere.

## Phase 3 — Close the loop: promoted learnings become versioned plugin changes

**Goal:** a promoted studio learning should visibly become a concrete change — not sit in a ledger
forever, which is exactly the "field nobody reads is not a contract" failure this repo has already
fixed four times this session in other places.

1. Give each promoted `scope: studio` entry a `disposition` once acted on: `applied-in-<version>`,
   `superseded-by-<id>`, or `wontfix: <reason>` — the same lifecycle idea already proposed for
   evaluation cases (P1.5 of the earlier global-enhancement-plan review), reused here rather than
   invented twice.
2. `docs/HANDBOOK.md` gets a place (a new subsection under Part 12, or a Part 13) that records,
   per version bump, which studio learnings were folded into that release — so the plugin's own
   version history shows it is actually learning, not just growing.
3. New `team-doctor.mjs` check: a promoted `scope: studio` entry with no disposition after N
   sessions/days is a blocking finding — a promoted learning nobody acted on is the same defect
   class as the leasing primitive with no caller and the prompt registry with an empty shape,
   both already fixed this session.

**Regression tests:** mirror-tested `team-doctor.mjs` check — a stale undispositioned promotion is
flagged, a dispositioned one is not, an entry still within the grace window is not.

## Phase 4 — Make the learning categories first-class, not free text

**Goal:** the categories you named — right questions, formats, flow logic, agents/roles, gates,
output formats — become a real, consistently-applied taxonomy instead of ad hoc free text.

1. Define the category vocabulary formally (a short table, likely in `docs/team/` or alongside
   `memory-curator.mjs`'s own docs): `question-quality`, `output-format`, `flow-logic`,
   `gate-design`, `role-design` — each with a one-line definition and a worked example, so future
   contributors (human or agent) classify consistently rather than each inventing their own labels.
2. Extend Phase 2's harvest step to actively look for these patterns rather than only wait for a
   human to write them down: repeated founder escalations on the same topic → question-quality
   gap; repeated manual reformatting of an agent's output → output-format gap; repeated manual
   reordering of steps in a dry run → flow-logic gap. This turns the harvest from "transcribe what
   a human already noticed" into "actively mine the dry-run transcript for the pattern."

**Regression tests:** fixture dry-run transcripts with a known injected pattern of each category;
the harvester must classify each correctly, proven by asserting the proposed `--class` matches.

## Sequencing recommendation

Run Phase 1 and Phase 2 as the next two PRs — Phase 1 is small and immediately useful with zero
new subsystems; Phase 2 completes scaffolding that already exists (the `studio` scope) rather than
building something new, so it's the natural next step, not a new bet.

Phase 3 and Phase 4 are genuine new value but larger surface area (a new `team-doctor.mjs` check
with a time-based staleness rule, a real pattern-mining harvester). Recommend deciding whether to
build them only after Phase 2 has produced a handful of real proposals to look at — building the
lifecycle-and-taxonomy machinery around zero real data risks over-engineering a shape that turns
out wrong once real proposals exist.

## What this deliberately does NOT do

- It does not make any local skill/subagent a hard dependency — the studio must work identically
  in an environment with none of them installed.
- It does not auto-apply any learning to agent/role/gate behavior. Every promotion is a proposal
  for a human-reviewed PR, same as every other trust control this repo has built.
- It does not duplicate `/app-learn`'s existing app-convention/failure-corpus mining — it is
  explicitly the STUDIO-process complement to that, not a replacement or a second copy.
