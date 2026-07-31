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
  URL at sprint start. Static mode `--export docs/34-dashboard.html` for sharing without a
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

## 4.5 Action items — the executable backlog

One PR per phase. Each item is scoped to be verifiable on its own; the **Proof** column is what
must be *executed* before the item is called done, because in this repo a fix certified by reading
is not a fix.

### Phase 0 — Soundness ✅ SHIPPED (v1.5.0, `dc21f65`)

RV-001…025 closed, `runtime-gate` and `spec-critic` added, contracts unified, 48 → 82 assertions.
Deferred out of Phase 0 deliberately: mid-sprint Q&A (→ P3), self-metrics (→ P2), CI (→ P6).

### Phase 1 — Lean and prune

| # | Item | Proof |
|---|---|---|
| 1.1 | Merge the `ios-developer` / `android-developer` shared body (~85% identical) into a `mobile-developer-core` skill; keep two thin platform files | corpus line count; both files still name their own conventions pack |
| 1.2 | Collapse the remaining 4-copy board-doctor exit-code prose and the `verify-done` invocation copies to one pointer each | `grep -c` per duplicated block returns 1 |
| 1.3 | **Role activation by tier.** The Flagship/Utility tier in the House KB gates nothing today — a 3-screen utility app still pays for CEO, CPO, CTO, ASO and security at init. Gate the roster by scope in `/app-init` and `/app-run` | run `/app-init --utility` dry and assert the exec fan-out is reduced and named |
| 1.4 | Merge `ceo`+`cpo` into one founder pass **for utility tier only**; flagship keeps both | team-doctor clean; both paths documented |
| 1.5 | Finish the `code-reviewer` / `verification-engineer` boundary — Phase 0 stated it; verify no duplicated section survives | diff the two files for shared paragraphs |
| 1.6 | Fix knowledge-pack self-contradictions (RV-032): XCTest vs Swift Testing in `architecture-builder`, 95% vs 90% coverage, the iOS min-target row that contradicts its own note, `aso.md`'s mining artifacts ("Emma", "no app checked in a keyword file") | each contradiction grepped and shown resolved |
| 1.7 | Trim `defect-hunting` §3's shell-authoring subsection out of the review path (dead context on every review) into its own reference | reviewer-loaded line count drops |

> **Scope note added mid-Phase-1 (owner direction).** The end goal is a team of specialists that,
> once requirements are sorted, builds **iOS, Android, or any other product** autonomously and in
> coordination. Today the roster is hard-wired to mobile: `ios-developer`, `android-developer`,
> `aso-specialist` and the store-readiness gate assume an app-store product. That means item 1.3 has
> **two axes, not one**:
>
> - **Tier** (Flagship / Utility) — how much process the work deserves.
> - **Product type** (iOS app · Android app · backend service · web app · CLI · library) — *which
>   specialists exist at all*.
>
> Build the activation mechanism to take both from the start. A backend-only product should never
> spawn an ASO specialist or a store-readiness gate, and should never be blocked by a runtime gate
> looking for an `.xcodeproj`. Getting this shape right in Phase 1 is what makes the team
> generalisable later without a second rewrite; getting it wrong hard-codes "mobile app studio" into
> the activation layer, which is the one place it is most expensive to undo.
>
> Corollary for `runtime-gate` (shipped in Phase 0): it already detects project type and returns
> CANNOT EVALUATE for a tree that is neither iOS nor Android. When product types broaden, that
> detection is the natural extension point — a web product's runtime gate is "does it build and does
> the page render", a CLI's is "does it run `--help` and exit 0". Same three-state contract.

### Phase 2 — Event-sourced board + self-metrics

| # | Item | Proof |
|---|---|---|
| 2.1 | `docs/31-board-events.jsonl`, append-only: `{ts, ticket, event, by, detail}` | schema documented in `sprint-planner` |
| 2.2 | `scripts/board.mjs` CLI: `add \| move \| assign \| show` — validates the transition, appends the event, regenerates `31-board.md` as a **view**, runs the doctor | illegal transition rejected at write time (probe it) |
| 2.3 | Agents and orchestrator stop hand-editing the board table; `board-doctor` stays as the backstop for hand edits and legacy boards | legacy board still degrades to warnings, not errors |
| 2.4 | **Self-metrics** (moved from P5): cycle time per ticket, review pass rate, rework rate, gate-fire counts — derived from the event log | `/app-status` prints a trend block on a seeded event log |
| 2.5 | Migration path for an existing hand-written board → events | run against `scripts/fixtures/*.md` |

#### Phase 2 design — the state machine (decided up front)

The whole point of event-sourcing is that **illegal states become unrepresentable**, so the
transition table is the design. Anything not in it is rejected at write time rather than detected
afterwards by the doctor.

```
                 ┌──────────── changes ─────────────┐
                 v                                  │
todo ──claimed──> in_progress ──done_reported──> (verify) ──review_requested──> in_review
  ^                   │                                                            │
  │                   └── blocked ──> blocked ──unblocked──┐                        │
  │                                                        │                   approved
  └────────────────────── (re-open, admin only) ───────────┘                        │
                                                                                    v
                                          done <──closed── qa <──merged──── (merge gate)
```

**Events** (append-only, `{ts, ticket, event, by, detail}`):
`created · claimed · done_reported · verified · rejected · review_requested · started · approved ·
changes · merged · qa_passed · qa_failed · blocked · unblocked · closed`

**Rules the CLI enforces at write time** — each one exists because the current hand-edited board
allows its violation and the doctor can only catch it later:

| Rule | Replaces the anomaly |
|---|---|
| `review_requested` requires a preceding `verified` for that ticket | `DONE` believed unverified |
| `approved` must be authored by someone ≠ the ticket's owner | `self_review` |
| `merged` requires a preceding `approved` **by a non-owner** | `done_without_review`, and the live merge that slipped through the check/append window |
| `changes` increments the cycle counter; the 3rd is refused and forces `blocked` | `cycle_cap_breached` drift between the column and the ledger |
| a `claimed` on a ticket whose dependency has no `merged` is refused | `stranded` — the silent one |
| `blocked` on a ticket cascades a recomputed readiness for its dependents | dependents stranded by a mid-round block |
| any event on an unknown ticket is refused | `malformed_row` |

**`docs/31-board.md` becomes a generated view.** It stays human-readable and diffable — that
property is non-negotiable — but it is regenerated from the log, never hand-authored. `board-doctor`
survives unchanged as the backstop for hand edits, legacy boards, and anything that bypasses the
CLI; its job shifts from *primary gate* to *drift detector*, and a divergence between the log and
the rendered table becomes its own anomaly.

**Why the cycle counter moves into the log.** Today `Cycles` is a column an agent edits and the
ledger is a separate list, so the two drift — dry run 3's finding 1 was exactly this, a drifted
ledger word silently filtered by the parser, which then reported a milder anomaly than the real one.
Derived-on-read means they cannot disagree.

**Migration.** `board.mjs migrate` reads an existing hand-written board plus its ledger and emits a
best-effort event log, marking anything it cannot reconstruct as `provenance: inferred` rather than
inventing timestamps. An inferred log is honest; a fabricated one is the same class of lie as a
false `DONE`.

### Phase 3 — Communication, finished

| # | Item | Proof |
|---|---|---|
| 3.1 | **Mid-sprint Q&A — the open half of the loop.** Each round, batch open `question` rows and spawn `tech-lead` once to answer them into the ledger before the next dev wave | seed 3 open questions, run a round, assert `answer` rows appear and the questions close |
| 3.2 | `scripts/messages-render.mjs` — per-ticket threads, open-questions list, per-role send counts vs guard budget. Wire into `/app-status` and the standup | render the fixture ledger; assert thread grouping |
| 3.3 | Unify the anti-ping-pong guard: move counting into `lib/board.mjs`, called by both `team-message.sh` and `board-doctor` | one window definition; both agree on a seeded breach |
| 3.4 | Give execs (`ceo`/`cpo`/`cto`) the `answer`/`decision` vocabulary so a routed escalation can actually close a question | seeded escalation closes; `question_unanswered` clears |
| 3.5 | `board-render` "recent activity" panel to include message activity (its header has always claimed this) | rendered output contains both ledgers |

#### Phase 4 redesign — what dry run 4 says the dashboard must actually show

The original panel list was designed from the outside, before the pipeline had ever run. Having run
it once, three of the panels are wrong-headed and three things that matter were missing. Revise
before building:

**What the run proved a human actually needs to see, in priority order:**

1. **Why is nothing moving?** The single most useful fact in the whole run was "all three tickets
   are blocked, and here is the one reason." A burn-down chart would have shown a flat line and
   explained nothing. The top panel is **NEEDS ATTENTION with causes**, not progress.
2. **What is inspectable but not runnable.** `code-reviewer` never ran because a missing simulator
   blocked a path that also gates static review (DR4-002). A human seeing "3 tickets awaiting
   review, 0 reviewers ever spawned" would have caught that in seconds; nothing surfaced it.
3. **Unowned artifacts.** `/project.yml` sat between two charters and was nearly the run's
   fatal blocker (DR4-019). The dashboard should name any artifact a spec requires that no ticket
   owns.
4. **Roles spawned before their inputs existed** (DR4-018) — an ordering violation nothing detects.
5. **Work with no provenance.** QA's test plan and bug report — the best artifacts of the run —
   were written with no branch, no ticket, no commit (DR4-007). A panel listing files changed in
   the tree that belong to no ticket would have caught it immediately.
6. **Open questions, and whether the answer reached anyone.** A closed ledger is not delivery
   (DR4-006). Show question → answer → *and the artifact the answer was folded into*.

**Demoted:** the burn-down (flat and uninformative on a blocked sprint), the dependency graph (three
tickets — the table was clearer), and the activity timeline as a primary panel (useful for
forensics, not for "what do I do now").

**The control-room actions the run actually wanted:** unblock a ticket with a recorded reason,
answer an open question, assign an unowned artifact. Not "re-prioritise" — nobody wanted that once.

### Phase 4 — The dashboard (control room)

| # | Item | Proof |
|---|---|---|
| 4.1 | `scripts/studio-dashboard.mjs` — Node stdlib only (`http`, `fs`, `fs.watch`), single embedded HTML page, `localhost:4173` | starts with zero deps on a clean machine |
| 4.2 | `GET /state` assembled via `lib/board.mjs`; `GET /events` SSE with 2s debounced `fs.watch` | edit a doc, assert the page refetches |
| 4.3 | Panels: kanban w/ NEEDS ATTENTION, threaded team feed, **activity timeline replaying the event log**, sprint burn-down, dependency graph (SVG) | each panel renders against a seeded project |
| 4.4 | **Control-room actions** — answer a question, approve a gate, re-prioritize — invoked strictly through the same validated CLI agents use. Never a direct state write | attempt a direct write and assert it is impossible by construction |
| 4.5 | `/app-dashboard` command; `--export docs/34-dashboard.html` static mode; `/app-run` prints the URL | both modes exercised |

### Phase 5 — Smarter orchestration

| # | Item | Proof |
|---|---|---|
| 5.1 | **Cost ceiling / economics.** No budget awareness exists today; an unattended `/app-run` has no economic brake. Track spend per round, enforce a ceiling, surface it in the standup | seeded ceiling stops a run and reports why |
| 5.2 | **Model escalation on retry** — first attempt sonnet, re-spawn after `REQUEST CHANGES` goes opus. A ticket that failed review is by definition harder than it looked | assert the second spawn's tier differs |
| 5.3 | Round journal (JSONL, one line per round) feeding burn-down and `/app-status` trend | a 3-round seeded sprint produces 3 lines |
| 5.4 | Warm managers where the harness supports named agents + SendMessage; respawn model stays the portable baseline, all durable state stays in files | both modes interchangeable mid-sprint |
| 5.5 | Auditor soft-routing made real (RV-019): one canonical list, detect-else-degrade, never a silent skip | run with the Axiom plugin absent; assert a stated degrade |

### Phase 6 — The studio tests itself ✅ SHIPPED (210 → 295 assertions)

| # | Item | Proof |
|---|---|---|
| 6.1 ✅ | CI (one GitHub Actions workflow): `test.sh` + `team-doctor` + plugin validation on push/PR | landed early, `.github/workflows/checks.yml` |
| 6.2 ✅ | Doc-graph check in `team-doctor`: every `docs/NN-*` has a **declared** producer and at least one reader (`doc_undeclared` · `doc_unread` · `doc_writer_silent` · `doc_unused`) | four seeded orphans in a scratch plugin, each proven to fire; the `.md`-on-a-`.jsonl` bug is asserted gone |
| 6.3 ✅ | Path-spelling check: fragments, standups, verdicts and the ledger match one pattern each, and the pattern must still be published in `team-protocol`'s paths table | 13 variant spellings found and normalised in the real tree; 3 seeded variants proven to fire |
| 6.4 ✅ | RV-039 assertion gaps: `board-render` exit 2 + rendered values, `ship-gate` QA-hold and S3/S4 notes, `team-message` usage exits, `runtime-gate` **FAIL(1)**, **PASS(0)** and the `RUNTIME_GATE_BUILD_TIMEOUT` branch, `--json` schema for `board-doctor` and `board.mjs show` | 21 deliberate mutations of the scripts; every one caught by at least one new assertion |
| 6.5 ✅ | **DR4-023 / DR4-024**: generated CI must be able to go red and must install nothing undeclared — executable, in `ship-gate.sh` | seeded workflows: `\|\| true`, `continue-on-error`, an unprotected pipe, `brew install`; plus the control cases that must stay CLEAR |

Not done, and why: **DR4-018** (a role spawned before its declared inputs exist) and **DR4-019** (an
artifact a spec requires that no ticket owns) both need a declaration that does not exist yet — a
per-role `Inputs:` contract and a spec→artifact→ticket link. The plugin-level half of DR4-019 *is*
covered: `doc_undeclared` fires on any document no step declares a producer for. The project-level
half needs Phase 7's registry work to have somewhere to stand.

### Phase 7 — Portfolio (multi-project)

| # | Item | Proof |
|---|---|---|
| 7.1 | A registry of app projects with lifecycle state | lists N seeded projects |
| 7.2 | Dashboard multi-project view answering "where should the next hour go?" | ranks seeded projects by attention needed |
| 7.3 | Cross-project learning: failure corpus accumulated from every app, not just conventions from shipped ones | a defect class seen in 2 projects is surfaced |

### Phase R — The one that matters most: **run it**

Not a code phase. Nine of ten commands have never executed once; `/app-build` is the sole exception
and even that was human-driven over three tickets with QA and the bug loop never reached. Every
previous time this system was actually run, running it found defects reading had not.

| # | Item | Proof |
|---|---|---|
| R.1 | One small real greenfield app, end to end through `/app-run` | a built, launching app + every command exercised at least once |
| R.2 | Write it up as `docs/research/<date>-dry-run-4-*.md` in the house format: hypotheses in advance, so it can fail | ≥2 hypotheses falsified (the previous runs each falsified 2) |
| R.3 | Feed findings back as the next register | a new RV-NNN table |

**Sequencing note.** Phase R should run **after Phase 1 and Phase 2** — Phase 2 gives the event log
that makes a dry run legible, and Phase 1 keeps the context cost sane — but **before Phase 4**,
because building a dashboard for a pipeline nobody has run end to end is designing a cockpit for an
aircraft that has not flown.

## 5. Principles that must survive the revamp

## 6. Revamp execution status — 2026-07-31

The external adversarial review confirmed that the foundation is strong but identified a trust
closure gap: the team can record board activity, yet cannot durably resume an interrupted run,
prove exactly which context was used, or bind an approval to immutable evidence. This section is
the executable action plan for closing that gap.

### P0 — implement in the code-only phase

| Workstream | Deliverable | Status / exit criterion |
|---|---|---|
| Durable execution | Append-only run ledger with run ID, attempt ID, phase checkpoints, lease/heartbeat, terminal status, and orphan detector | ✅ Implemented and smoke-tested; `run-doctor` detects expired leases, duplicate active attempts, malformed records, and broken chains |
| Context integrity | Deterministic layered context manifest containing source paths, hashes, git revision, omissions, reasons, precedence, and token estimate; freshness verifier | ✅ Implemented and smoke-tested; changed sources or revisions return stale |
| Approval integrity | Approval evidence binding to commit, diff hash, context snapshot, and evidence hash; optional strict policy gate | ✅ Implemented; strict mode rejects incomplete or mismatched evidence |
| Audit anchoring | Release-time anchor for the board event-chain tip and log digest | ✅ Implemented; verification distinguishes intact, changed, and unavailable |
| Regression protection | Positive and negative tests for every new fail-closed branch; mutation entries for new gates | ✅ New paths have positive/negative regression cases; broader mutation expansion remains ongoing |

### P1 — design and scaffold after P0

Governed memory provenance, prompt registry, deterministic scheduler, evaluation laboratory,
capability manifests, impact propagation, risk routing, incident/release-health records, layered
context compilation, and manager failover now have executable scaffolds and regression checks.
Runtime integration into every dispatch path remains open.

### P2 — live validation after CICD/device access

Runtime/mobile state matrices, device accessibility and performance validation, CI execution,
replay drills, production-release rehearsals, and product/market validation. Code-only completion
does not certify these outcomes; each requires recorded evidence from the target environment.

### Definition of Revamp Complete for this coding phase

The repository has deterministic tools and documentation for the P0 workstreams, tests prove both
pass and fail paths, the action plan records all remaining P1/P2 work, and the working tree is
reviewable. “10/10” is reserved for the later evidence-backed operating phase, not merely for
having added scripts.

### Revamp commits

- `42975c4` — durable runs, context freshness, approval binding, audit anchoring.
- `60979b6` — governed memory, prompt registry, evaluation laboratory.
- `eebe698` — deterministic scheduler, capabilities, impact propagation.
- `30b5a64` — risk routing and incident lifecycle records.
- `084c6ac` — layered context compilation and manager failover.
- `4202555` — end-to-end handbook current-state documentation.

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
