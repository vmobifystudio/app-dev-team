# AI App Studio — Revamp Master Plan

**Date:** 2026-07-29 · **Against:** v1.4.0 (`e3a3961`) · **Status:** APPROVED — Phase 0 executing on
`revamp/phase-0-soundness`

> **Revision note (same day).** After the register below was written, a design brainstorm found a
> class of gap a findings register structurally cannot contain: a register only finds things that
> are *wrong*, never things that were *never attempted*. Every defect below could be fixed and the
> team would still have no idea whether the app it built works. §3.5 records those additions and
> the resulting changes to phase order. The register itself is unchanged and still accurate.

This is the master document from a full-system review of the team: all 18 agent files, all 11
commands, all 11 skills, all 7 scripts + fixtures + tests, all 8 knowledge packs, and the 4
research documents. The mechanical layer was executed, not just read: `scripts/test.sh` passes
48/48 and `team-doctor.mjs` reports the team definition coherent.

---

## 1. Verdict

**The foundation is genuinely strong — stronger than almost any agent-team framework in the
wild.** What sets it apart, and must be preserved through any revamp:

- **Evidence-driven design.** Every rule traces to a measured failure (the parallel-collision dry
  run, the false-DONE incident, the `contains()` guard bypass). Nothing is cargo cult.
- **Trust nothing, verify mechanically.** `board-doctor` before every spawn, `verify-done.sh` on
  every DONE, a merge gate that re-reads the ledger at merge time.
- **One source of truth in plain Markdown.** Readable, diffable, survives agent death, works on a
  vanilla install.
- **Honest autonomy.** Two human gates, blockers surfaced verbatim, "declare, don't dispatch" for
  IC questions — designed around how subagents actually behave, not how we wish they behaved.

**But the review found the system would break on its first real run**, in several places — and
almost every defect is *fail-open*: a gate that silently passes, a ticket that silently drops, a
flow that dead-ends. That is the dangerous direction for exactly this design. The revamp is
therefore sequenced: **make it sound (Phase 0–1), then make it visible (Phase 2–4), then make it
smarter (Phase 5–6).** No dashboard before the gates underneath it are trustworthy.

---

## 2. Findings register

Format follows the team's own `docs/81-findings.md` convention: stable IDs, never-blank status,
one ticket per finding when remediation starts. Severity: **S1** breaks a real run · **S2**
fail-open gate / integrity hole · **S3** drift & duplication · **S4** hygiene.

### S1 — Breaks a real run (fix before anything else)

| ID | Finding | Where |
|---|---|---|
| RV-001 | `/app-plan` hard-requires **both** `22-impl-spec-ios.md` and `-android.md`; a single-platform project (explicitly supported by intake) and every brownfield project fail and get told to run `/app-init`. | `commands/app-plan.md:13` |
| RV-002 | `/app-onboard` never writes `docs/11-backlog.md`, so `/app-run`'s brownfield branch walks straight into RV-001. Brownfield reaches a board only via `/app-audit`'s direct write, which `/app-run` step 3 doesn't know about. | `commands/app-onboard.md`, `commands/app-run.md:47` |
| RV-003 | `security-reviewer` has `tools: Read, Glob, Grep, Bash, Task` — **no Write/Edit** — yet must write `docs/70-security-review.md`, which `/app-ship` gates on. It cannot produce its own deliverable. | `agents/security-reviewer.md:4,75` |
| RV-004 | `code-reviewer` and `qa-engineer` are instructed to **spawn Axiom auditor/test-runner agents via Task** — and neither has the `Task` tool. The ~25-auditor iOS review gate the README advertises is a dead instruction. | `agents/code-reviewer.md:4,17-24`, `agents/qa-engineer.md:4,15-16` |
| RV-005 | `board-doctor` `cycle_cap_breached` fires on `done` rows (guard is only `status !== 'blocked'`). Any ticket that legitimately used its 2-cycle budget and merged turns the pre-spawn gate **permanently red** for the rest of the project. | `scripts/board-doctor.mjs:362-368` |
| RV-006 | `verification-engineer` is a spawnable ticket owner in `/app-build` but returns `VERIFICATION: PASS/FAIL`, never `DONE: APP-NNN` — the loop can't move its row. Same silent-drop class the command itself documents. | `commands/app-build.md:56`, `agents/verification-engineer.md:135-139` |
| RV-007 | Doc-only owners (`ux-designer`, `qa-engineer`, `aso-specialist`, `data-analyst`) emit no `Branch:` or `Shared surfaces touched:` lines; `verify-done.sh` hard-REJECTs a missing branch, so their tickets are **structurally un-passable** — and the collision check never fires for exactly the shared files (tokens, analytics schema) most likely to collide. | `commands/app-build.md:73,80`, four agent files' output contracts |

### S2 — Fail-open gates and integrity holes

| ID | Finding | Where |
|---|---|---|
| RV-010 | `ship-gate.sh` fails **open** three ways: a renamed/absent `Status` column yields CLEAR with no output; backticked status cells (` `todo` `) are invisible to its awk; and `blocked` is not counted as in-flight — a blocked ticket ships silently. It is also a third, weaker board parser next to the "one parser, deliberately" library. | `scripts/ship-gate.sh:45-55` |
| RV-011 | `team-doctor` `skill_missing` is whitelisted to eleven hard-coded names that all exist — the check can never fire for a newly referenced missing skill. The repo's own "a rule that cannot fail is worse than no rule" class. | `scripts/team-doctor.mjs:164` |
| RV-012 | `verify-done.sh` discards test output (`>/dev/null 2>&1`) while the loop's contract is "re-spawn the developer with these failures **verbatim**" — there is nothing verbatim to pass on, defeating the retry loop it feeds. | `scripts/verify-done.sh:111,127` |
| RV-013 | `/app-build` hardcodes `main` as the verify/merge base, directly contradicting `git-workflow.md`'s "the merge gate does not assume `main`" (flagship model integrates on `develop`). Four call sites of `verify-done.sh` each name a different base. | `commands/app-build.md:73`, `knowledge/git-workflow.md:33-37` |
| RV-014 | The merge-gate approval grep doesn't check the approver ≠ owner, though the stated rule requires it. | `agents/tech-manager.md:167,179` |
| RV-015 | `team-message.sh` sanitizes only `SUMMARY`/`BODY` — a `|` in `TICKET`/`FROM`/`TO` corrupts the table; its guard windows (trailing 40 rows, `>=4`) disagree with `board-doctor`'s (whole ledger, `>4`); and all ticketless messages collapse into one pseudo-thread `-`, tripping chain-depth on unrelated chatter. | `scripts/team-message.sh:74-128`, `scripts/board-doctor.mjs:52-112` |
| RV-016 | `docs/team/messages.md` is **never scaffolded** — no `/app-init` step creates it, and only 2 of 18 agents name the path. Observed live: an agent claimed "raised on the channel" and the ledger had never existed. | `commands/app-init.md`, agent corpus |
| RV-017 | Brownfield ship gates on files the brownfield flow never writes: `15-aso.md` (only created by init "if store work in scope") and `50-test-plan.md` (only created inside a `/app-build` QA wave). | `commands/app-ship.md:66`, `scripts/ship-gate.sh:19` |
| RV-018 | `/app-audit`'s re-audit loop has **no cap and no termination condition** — the only unbounded loop in the plugin. | `commands/app-audit.md:96` |
| RV-019 | The six Axiom auditors are named `axiom:<name>` in `/app-audit` and un-prefixed in the design spec; they are agents, not skills, spawned as a **hard list** despite the spec's "soft routing, no hard dependency" rule. | `commands/app-audit.md:21-23`, design spec §12.1 |
| RV-020 | Escalation dead-ends: `ceo`/`cpo` are spawned by no command after init, yet are documented escalation targets; execs have no ledger vocabulary so a routed `question` can never be closed by their answer; `tech-lead` — the role "on call for questions" — is never spawnable mid-round; `release-manager` and `security-reviewer` sit entirely outside `team-protocol`. | `agents/tech-manager.md:218-222`, agent corpus |
| RV-021 | The manual flow has **no scope-lock gate** (`/app-init` → `/app-plan` → `/app-build` never asks for approval), while `/app-plan`'s "ready to launch the pod?" is an undocumented third gate inside `/app-run`'s "only two gates" contract. | `commands/app-init.md:38`, `commands/app-plan.md:19`, `commands/app-run.md` |
| RV-022 | `/app-learn` is unreachable from every flow — the "living knowledge base" promise never fires, and the `LEARNING:` lines every agent writes into daily fragments are harvested by nothing. | `commands/app-ship.md`, `commands/app-run.md:73` |
| RV-023 | Spawnable-owner roster exists in four copies and one has already drifted (`/app-audit` lists 8 of 10, dropping `ux-designer` + `qa-engineer` — the natural owners of its own "Safe fix" class). | `commands/app-audit.md:71-73` vs `scripts/lib/board.mjs:38-49` |
| RV-024 | Model assignment is inverted at the risk edge: `release-manager` — the only role executing irreversible actions (store upload, rollout) — runs sonnet, as do `monetization-engineer` (money paths) and `qa-engineer` (a ship veto), while advisory execs run opus. | agent frontmatter |
| RV-025 | `board.mjs` takes the **first** id-ish table, and the review-ledger header aliases `Ticket → id` — a board file with the ledger above the table parses the ledger as the board. | `scripts/lib/board.mjs:77,95-109` |

### S3 — Drift and duplication

| ID | Finding | Where |
|---|---|---|
| RV-030 | **~500 of 2,261 agent-corpus lines (~22%) are copy-paste**: the "Talking to the rest of the team" block ×13, the isolation block ×4, the DONE skeleton ×8 in 3 divergent variants. Every block inlines a skill that already exists. | agent corpus |
| RV-031 | The daily-fragment path has **five spellings** across the repo, and `/app-build` step 3 gates on one of them; the standup filename diverges (`<today>.md` vs `standup-<today>.md`) between `/app-build`+`/app-status` and `/app-run`+README. | `commands/app-build.md:96,123`, `commands/app-run.md:55` |
| RV-032 | Knowledge packs contradict themselves and the builders: `architecture-builder` still says XCTest while `stack-defaults` mandates Swift Testing; coverage bar is 95% in one pack, 90% in another; the iOS min-target note contradicts its own column; `aso.md` carries mining artifacts ("Emma", "no app checked in a keyword file") as if they were rules. | `knowledge/*`, `skills/architecture-builder/SKILL.md:21` |
| RV-033 | `${CLAUDE_PLUGIN_ROOT}` missing on the research-doc citations in 6 agent/command files and on `verification-engineer`'s `scripts/verify-done.sh` path — all resolve against the *app project*, where they don't exist. | 7 files |
| RV-034 | `release-manager` re-states `ship-gate.sh`'s five preconditions as prose and never runs the script — the exact failure mode the script's own header documents ("went wrong three times in one session"). | `agents/release-manager.md:50-58` |
| RV-035 | Written-but-never-read docs: `32-board-view.md` (status re-renders without `--out`, so the committed view silently goes stale), `60-releases.md`, `71-verification.md`, `41-monetization.md` (its release checklist is not in the ship gate). | multiple |
| RV-036 | Reviewer/verifier boundary is undefined at the diff level — `code-reviewer` §0/§6/§7 and `verification-engineer` §1/§2 do the same constant-execution work, both spawn `security-privacy-scanner` (duplicate paid spawn), and the post-launch routing table is written out in full twice. | `agents/code-reviewer.md`, `agents/verification-engineer.md`, `agents/tech-manager.md:200-215`, `agents/data-analyst.md:59-84` |
| RV-037 | Skills with no agent-side trigger: `prd-builder`, `requirements-intake`, `architecture-builder`, `sprint-planner` fire only if a command remembers; `house-conventions` claims "every IC and exec" but 4 agents (incl. two execs and `tech-manager`) never invoke it; `defect-hunting` names `qa-engineer` as a trigger and `qa-engineer` doesn't invoke it; `agent-isolation` is missing from 5 spawnable writing roles incl. `devops-engineer` (the most collision-prone files in the repo). | skills + agent corpus |
| RV-038 | Render/validate disagreement: `board-render` asserts `NO REVIEWER` on legacy boards that `board-doctor` deliberately degrades to a warning; its header claims it renders message activity and it never opens the messages file. | `scripts/board-render.mjs:10,148-152` |
| RV-039 | Test-suite gaps against its own "prove the rule can fail" doctrine: ship-gate's exit-2 and both fail-open paths untested; `team-message` per-role and chain guards never exercised (CHANGELOG's "all four guard branches tested firing" is false); `team-doctor` has no negative fixtures, hiding RV-011. | `scripts/test.sh`, `CHANGELOG.md:44` |
| RV-040 | No role owns the project `CLAUDE.md`, localization, or post-ramp incident response; `tech-lead` has no reviewer contract though `/app-build` routes review-of-review to it. | agent corpus |

### S4 — Hygiene

| ID | Finding |
|---|---|
| RV-050 | `firebase-debug.log` is a stray working-tree artifact (untracked, gitignored) — delete it. |
| RV-051 | Doc drift: CONTRIBUTING says 41 assertions (48 actual) and "exactly two scripts" (seven); README's file-layout omits 7 doc paths the team actually writes. |
| RV-052 | No CI whatsoever — `test.sh`, `team-doctor`, plugin validation all run only when a human remembers, in the repo whose thesis is "a rule nobody executes is not a rule". |
| RV-053 | `.mjs` scripts carry shebangs but aren't executable (harmless; call sites use `node`); `ship-gate.sh` exit-code contract drift (missing inputs return 1, documented as 2). |

---

## 3. The revamp — architecture and phases

Sequencing rule: **sound → visible → smart.** Each phase is shippable alone and each later phase
builds on the one before. Everything stays zero-dependency (Node stdlib + POSIX sh) and
Markdown-first — those are the two properties that make this system portable and debuggable, and
no feature below is worth losing them.

### Phase 0 — Make it sound *(fix the register)*

Work RV-001…RV-025 as `AUDIT`-style tickets through the team's own loop. Highlights of *how*, not
just *what*:

- **One owner-contract, two profiles.** Create a single `output-contract` definition (inside
  `team-protocol` or its own small skill): a **code profile** (full 12-field DONE incl. `Branch:`,
  `Shared surfaces touched:`) and a **doc profile** (same fields; `Branch:` still required —
  doc-only owners commit to a branch like everyone else, which is already how worktrees work).
  `verification-engineer` gets the doc profile when it owns a ticket. This one change closes
  RV-006, RV-007, and the 3-variant DONE drift in RV-030 together.
- **`verify-done.sh --docs-only` mode** (skips the test-command requirement, still verifies
  branch + commits + files) so doc tickets are verifiable instead of exempt.
- **Fix tool grants** (RV-003/004) and re-run `team-doctor` — then add the negative fixtures
  (RV-039) so the class stays closed.
- **Integration branch resolved once**: a tiny `scripts/integration-branch.sh` that reads
  `docs/23-git-strategy.md` (fallback `main`) and is the *only* place the base branch comes from;
  all four `verify-done.sh` call sites and the merge gate use it (RV-013).
- **Scaffold `docs/team/messages.md` in `/app-init` and `/app-onboard`** with the header row, and
  name the path in the shared protocol block, not in 18 files (RV-016).
- **Ship-gate rewritten on `lib/board.mjs`** (a ~20-line `.mjs` replaces the awk): one parser,
  fail-closed on a missing Status column, `blocked` counted as in-flight (RV-010, RV-025's
  header-anchoring fix lands in the same lib).
- **Scope-lock as a real gate in `/app-init`'s exit** (one question, skippable with `--yolo`) and
  `/app-plan` made non-interactive when invoked from `/app-run` (RV-021).
- **`/app-learn` wired into `/app-ship`'s final step** and the standup aggregator instructed to
  collect `LEARNING:` lines into a `docs/90-learnings.md` inbox that `/app-learn` consumes
  (RV-022). The living KB starts living.

### Phase 0.5 — What the register could not see *(added to Phase 0 in flight)*

A findings register finds defects. It cannot find an absence. These four are absences, and the
first is the largest single gap in the system.

- **Nothing ever runs the app.** Every gate in this repo verifies that *the process was followed*:
  `verify-done` checks the branch and the test exit code, `board-doctor` checks the board is
  coherent, `ship-gate` checks nothing is in flight, `code-reviewer` checks the diff reads
  correctly. A sprint can go green end to end on an app that does not compile, does not launch, or
  launches to a blank screen. The irony is that `defect-hunting` is built on precisely the right
  instinct — *execute constants, never certify by reading* — and the team simply never pointed it
  at the app. **`scripts/runtime-gate.sh` + the `runtime-gate` skill** close it: build, launch,
  drive the P0 flow, write evidence to `docs/evidence/`. Exit 2 (**cannot evaluate**) is the
  load-bearing part — a machine without Xcode is a normal state, not a pass, and shipping past it
  requires a recorded waiver.
- **Ambiguity is resolved by guessing, then caught in review.** `team-protocol`'s
  "declare, don't dispatch" is the right *mitigation* — it is built on the measured finding that
  the channel went unused in 10 of 10 agent-runs because an agent that can proceed will proceed.
  But it catches the guess after it has been made, at the cost of a full rework cycle. The
  **`spec-critic` skill** removes the ambiguity upstream: one pass after the specs exist and before
  any developer spawns, filing `question` rows for `tech-lead` to answer in a single batch. It is a
  skill invoked by `tech-lead`, deliberately **not** a nineteenth role.
- **A gate that is skipped and a gate that is waived look identical afterwards.** The original
  RV-017 fix was to make the ASO and test-plan gates *conditional* on scope. That reintroduces the
  exact failure class the repo exists to prevent. Replaced with a three-state contract now shared by
  `ship-gate` and `runtime-gate`: `0` clear, `1` blocked by a real condition, **`2` cannot
  evaluate** — naming the missing input, never passing, and requiring an explicit recorded waiver
  to proceed.
- **The system cannot tell whether it is improving.** No cycle time, no review pass rate, no rework
  rate, no count of how often a gate caught something real versus fired on noise. Without it every
  future change to this team — including everything in this document — is a belief rather than a
  result. **Moved out of Phase 5 into Phase 2**, where it rides on the event log for free.

Two further changes to the phases below:

- **Phase 1 gains a pruning pass.** The roster should shrink, not grow. `code-reviewer` and
  `verification-engineer` overlap badly enough that the reviewer does the work *and* delegates it;
  for a utility-tier app `ceo` and `cpo` are one person in two hats; and the Flagship/Utility tier
  in the House KB currently gates nothing, so a three-screen utility app still pays for a CPO, a
  CTO, an ASO specialist and a security reviewer at init. **Role activation by scope** is a small
  change with a large cost and latency payoff.
- **Phase 4's dashboard becomes a control room, not a viewer.** Read-only was over-cautious. The
  correct invariant is not "the dashboard cannot write" but **"nothing writes state except through
  the validated CLI"** — so the page may *invoke the same commands agents invoke* (answer an open
  question, approve a gate, re-prioritise) without weakening a single guarantee.
- **A Phase 7 is now named** so Phase 4 is not built in a way that forecloses it: **multi-project**.
  A studio shipping many apps needs N apps in N lifecycle states and the question "where should the
  next hour go?" — that is the actual agent startup, and one sprint board is not it.

### Phase 1 — Make it lean *(the ponytail pass)*

- Factor the 13-copy protocol block, 4-copy isolation block, and DONE skeletons into their
  existing skills; each agent keeps one invocation line plus only its role-specific deltas.
  **Target: agent corpus from ~2,260 lines to ~1,500 with zero behavior loss.** Smaller agent
  files are not cosmetic — every line is context every spawn pays for, every round.
- Collapse the four spawnable-roster copies to one (the `board-doctor` skill table; commands
  point at it). Same for board-doctor exit-code prose (4 copies) and the incident narrations in
  `/app-ship`/`/app-build` (the lesson lives in `defect-hunting`; the command keeps one line and a
  pointer).
- Draw the reviewer/verifier boundary in one sentence each file: *code-reviewer judges the diff
  and **routes** constants/rules to verification-engineer; verification-engineer executes and is
  the only role that certifies them.* Delete the duplicated sections (RV-036).
- Merge ios/android developer shared body (~85% identical) into a `mobile-developer-core`
  skill with two thin platform files.

### Phase 2 — The board becomes an event log *(the study's own P1)*

The root cause of the `done_without_review` / `ledger_cycle_mismatch` anomaly classes is that
**status is a hand-edited table cell**. The team's own research ranked event-sourcing the board as
the highest-value port and deferred it. Do it now, lean:

- `docs/31-board-events.jsonl` — append-only: `{ts, ticket, event, by, detail}` where `event` ∈
  `created|claimed|done_reported|verified|review_requested|approved|changes|merged|blocked|unblocked|qa_passed|closed`.
- **`scripts/board.mjs` CLI** (extends the existing lib): `board add|move|assign|show`. It
  validates the transition, appends the event, **regenerates `docs/31-board.md` as a view**, and
  runs the doctor — illegal states are rejected at write time instead of detected after.
- Agents and the orchestrator stop hand-editing tables; `31-board.md` stays the human-readable
  artifact, now generated. `board-doctor` remains as the backstop for hand edits and legacy
  boards (graceful degradation, as today).
- The review ledger and the message ledger stay as they are — they're already append-only and
  already correct.

This kills entire anomaly classes, gives every state change a timestamp and an author (the
provenance the study admired), and — the real prize — produces the **event stream the dashboard
in Phase 4 replays.**

### Phase 3 — Communication, finished

The protocol design is right (declare-and-route matches how subagents actually behave — 10/10
runs proved exhortation doesn't). What's missing is closing the loop mechanically:

- **`scripts/messages-render.mjs`**: per-ticket thread view, open-questions list, per-role send
  counts vs guard budget. Wired into `/app-status` and the standup. Today the ledger is written
  and validated but *nothing renders it* — a channel nobody can read back is half a channel.
- **Unify the guard**: `team-message.sh` and `board-doctor` share one window definition (move the
  counting into `lib/board.mjs`'s `parseMessages`, both call it). Sanitize all five fields.
  Exclude ticketless rows from per-ticket checks (RV-015).
- **Give every role a channel.** `release-manager` + `security-reviewer` join `team-protocol`;
  execs get the two-line vocabulary (`answer`/`decision` rows close questions); `tech-lead`
  becomes spawnable mid-round as the designated answerer: each round, the orchestrator batches
  open `question` rows and spawns `tech-lead` **once** with all of them — answers land as ledger
  rows before the next dev wave. That converts "declare, don't dispatch" from a mitigation into a
  working Q&A cycle with one extra spawn per round, only when questions exist (RV-020).
- **Escalation targets that exist**: `cpo`/`ceo` escalations route through the same batched
  mechanism, or explicitly to the user — never to a role no command spawns.

### Phase 4 — The dashboard *(see it happening, live)*

A real-time local frontend, built the same way everything else here is built: **zero
dependencies, one file, reading the Markdown/JSONL that is already the source of truth.** The
dashboard is a pure *projection* — it never writes, so it can never corrupt state, and it works
on any project the team has ever touched.

- **`scripts/studio-dashboard.mjs`** — Node stdlib only (`http`, `fs`, `fs.watch`). Serves a
  single embedded HTML page on `localhost:4173` plus two endpoints:
  - `GET /state` — JSON assembled via `lib/board.mjs` (the one parser): board, events, messages,
    bugs, findings, standups, learnings inbox.
  - `GET /events` — Server-Sent Events; `fs.watch` on `docs/` (2s debounce) pushes "refetch".
- **Panels** (all derived, nothing stored):
  - **Kanban** — swimlanes by status, per-owner load, NEEDS ATTENTION block (stranded/blocked
    outlined red — same semantics as `board-render`, same lib, so they can't disagree).
  - **Team feed** — the message ledger as threaded conversations per ticket; open questions
    surfaced; guard-budget meters per role.
  - **Activity timeline** — Phase 2's event log replayed: spawns, DONEs, verdicts, merges, in
    order with timestamps. This is "watch the team work".
  - **Sprint progress** — burn-down from events, cycle counts vs cap, spawn budget spent,
    rounds elapsed; standup history.
  - **Dependency graph** — SVG from the existing graph helpers (no mermaid runtime needed
    locally; the GitHub-rendered mermaid view stays for the repo).
- **Launch:** `/app-dashboard` command (or `/app-status --web`) starts it; `/app-run` prints the
  URL at sprint start. Static mode `--export docs/32-board-view.html` for sharing without a
  server.
- **Explicitly not building** (YAGNI until proven): websockets libraries, React/build steps, a
  database, auth (localhost only), write actions from the UI. The moment the dashboard can write,
  it's a second orchestrator and every integrity guarantee needs re-proving.

Terminal users lose nothing: `/app-status` and `board-render` remain the no-server path.

### Phase 5 — Smarter orchestration

- **Round journal** — the orchestrator appends one JSONL line per round (tickets waved, verdicts,
  retries, wall-clock). Feeds the dashboard burn-down and gives `/app-status` a trend line.
  Today the cascade guard is enforced per-send but never summarized; this is the summary.
- **Warm managers where the harness allows.** On harnesses with named agents + SendMessage,
  `tech-manager` (and `tech-lead` in its Q&A role) persist across a sprint instead of being
  respawned cold each round — context survives, the ledger stays the durable record. Strictly
  optional: the respawn model remains the portable baseline, and *all durable state stays in the
  files* so the two modes are interchangeable mid-sprint.
- **Model assignment by blast radius** (RV-024): `release-manager` and `monetization-engineer`
  move to opus (irreversible actions, money paths); advisory exec passes that produce one doc can
  drop a tier. One-line frontmatter changes; document the principle in CONTRIBUTING.
- **Auditor soft-routing made real** (RV-019): one canonical auditor list in the `code-reviewer`
  file with the detect-else-degrade rule; `/app-audit` points at it.

### Phase 6 — The studio tests itself

- **CI** (GitHub Actions, one workflow): `sh scripts/test.sh` + `node scripts/team-doctor.mjs` +
  the plugin validator, on every push/PR. The repo's central thesis demands it (RV-052).
- **Close the test gaps** (RV-039): ship-gate fail-open fixtures, guard-branch firing tests,
  team-doctor negative fixtures (a fixture plugin with a missing skill / unreachable role), a
  `--json` schema assertion.
- **A doc-graph check in `team-doctor`**: every `docs/NN-*.md` written by some step must be read
  by some step (would have caught RV-035), and every path spelling (fragments, standups) must
  match one canonical pattern (would have caught RV-031).

---

## 4. Sequencing and effort

| Phase | Contents | Effort | Depends on |
|---|---|---|---|
| 0 — Sound | RV-001…025 fixes | 1–2 sessions | — |
| 1 — Lean | boilerplate → skills, boundary cleanups | 1 session | 0 |
| 2 — Event board | events.jsonl + `board.mjs` CLI + generated view | 1–2 sessions | 0 |
| 3 — Comms | messages renderer, unified guard, tech-lead Q&A round, roles onboarded | 1 session | 0 (renderer), 2 (guard lib) |
| 4 — Dashboard | `studio-dashboard.mjs` + `/app-dashboard` | 1–2 sessions | 2, 3 |
| 5 — Smarter | round journal, warm managers, model tiers | 1 session | 2 |
| 6 — Self-test | CI + test gaps + doc-graph check | 1 session | 0 |

Phases 0, 1, 6 are pure hardening and can start immediately. 2→4 is the visibility arc. 3 and 5
slot in anywhere after 0.

---

## 5. Principles that must survive the revamp

1. **Markdown/JSONL on disk is the only durable state.** Dashboards, warm agents, and CLIs are
   projections and conveniences; kill any of them and the team still runs.
2. **One parser.** Every reader of the board/ledger/messages goes through `lib/board.mjs`.
   `ship-gate`'s awk was the counterexample and it fail-opened twice.
3. **Gates fail closed.** "Cannot evaluate" is a distinct, loud outcome — never CLEAR.
4. **Every rule must be watched failing once** before it is trusted — including the new tests,
   the CI, and the dashboard's derived numbers.
5. **Zero dependencies.** Node stdlib + POSIX sh. The day this needs `npm install`, it stops
   working on a vanilla install and stops being trustworthy on an agent's machine.
6. **Writes go through validators; readers never write.** Phase 2's CLI for state, the dashboard
   strictly read-only.
7. **Human gates stay at two** — scope-lock and ship. Everything else is a report, not a prompt.
