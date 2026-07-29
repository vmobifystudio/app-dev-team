# Study: how `agent-teams-ai` orchestrates a team — and what we should steal for `app-dev-team`

**Date:** 2026-07-29
**Subject:** `github.com/777genius/agent-teams-ai` @ `main` (v2.11.0, AGPL-3.0 shell)
**Method:** sparse clone of `agent-teams-controller/`, `mcp-server/`, `packages/agent-graph/`,
`src/features/`, `docs/team-management/`, `docs/research/`. Closed components were *not* reverse
engineered — see §1.
**Purpose:** improve the Mobify `app-dev-team` plugin (`~/.claude/plugins/cache/mobify-studio/app-dev-team`).

---

## 1. What is and isn't readable

| Component | Status |
|---|---|
| `agent-teams-controller/` — task store, kanban, agenda, review lifecycle, messaging, cross-team | **Readable.** Plain CommonJS JS, ~6k lines, with unit tests. This *is* the orchestration. |
| `mcp-server/` — the tool surface agents actually call | **Readable.** TypeScript, ~2.5k lines. |
| `docs/team-management/` — 40 design docs incl. 3.6k-line control-plane plan | **Readable**, and unusually candid about failure modes. |
| `claude-multimodel` runtime binary (`runtime.lock.json`) | **Closed.** Source repo `777genius/agent_teams_orchestrator` is private (404). |
| `terminal-daemon` (`terminal-platform.lock.json`) | **Closed.** |

The closed binaries are the **provider shim** (spawning/multiplexing Claude Code, Codex, OpenCode,
Cursor… and pumping their stdio) and the **PTY host**. The *team logic* — who owns what, what gets
reviewed, who acts next — is entirely in the open JS. So the interesting part is studyable.

---

## 2. Their architecture in one picture

```
Agent (Claude Code / Codex / OpenCode)
   │  MCP tool calls only — agents never read the board files
   ▼
mcp-server  (≈45 tools in 10 groups, gated by a `teammateOperational` flag)
   ▼
agent-teams-controller  (pure logic, no UI, no network)
   ▼
~/.claude/teams/{team}/   tasks · kanban · inboxes · processes
   • every write: tmp-file + rename (atomicFile.js)
   • every multi-file op: reentrant board lock (boardLock.js + fileLock.js)
```

Three properties matter more than the file layout:

1. **Agents are given a rendered queue, not the database.** The only read paths are
   `member_briefing`, `lead_briefing`, `task_briefing`. `task_list` is explicitly demoted in the
   briefing text: *"Use `task_list` only to search/browse inventory rows, not as your working queue."*
2. **Tool access is role-scoped in one table.** `mcpToolCatalog.js` marks each group
   `teammateOperational: true|false`. Teammates get `task`/`review`/`message`/`process`/`workSync`/
   `crossTeam`. Only the lead gets `team_*`, `kanban_*`, `lead_briefing`. One place to audit.
3. **Nothing persists "who should act next."** It is recomputed on every read. See §3.

---

## 3. The five mechanisms worth stealing

### 3.1 The agenda is *derived*, never stored — with named anomalies

`agenda.js:buildAgendaItem()` computes, per task, from persisted facts only:

- `actionOwner` — `{member|lead|user|none}`
- `nextAction` — `execute | review | apply_changes | assign_owner | assign_reviewer |
  clarify_with_lead | clarify_with_user | repair_dependencies | wait_dependency | none`
- `queueCategory` — `actionable | awareness | oversight | waiting | done`
- `reasonCode` — the *why*, e.g. `owner_ready`, `needs_fix`, `review_requested_waiting_pickup`
- `derivedFrom` — provenance list, e.g. `["history_review_requested", "dependency_graph"]`

…via a strict precedence cascade: `deleted → approved → user clarification → lead clarification →
missing owner → invalid owner → review state → broken deps → waiting deps → needsFix → in_progress
→ pending`.

**The key move:** the cascade has explicit branches for *broken* states, and each routes to the lead
as `oversight` work rather than stalling:

| Condition | reasonCode | Routed to |
|---|---|---|
| task has no owner | `owner_missing` | lead, `assign_owner` |
| owner isn't on the roster | `owner_invalid` | lead, `assign_owner` |
| owner == reviewer | `self_review_invalid` | lead, `assign_reviewer` |
| in review, reviewer unresolvable | `review_reviewer_missing` | lead, `assign_reviewer` |
| `blockedBy` points at a deleted/missing task | `dependency_broken` | lead, `repair_dependencies` |

This is our §N problem solved mechanically. A finding that exists but is scheduled to nobody
*cannot* be silently skipped, because the derivation surfaces it as a lead action item every single
time the board is read.

**What we do today:** `docs/31-board.md` stores `Status` as a hand-edited column and `cycles=N` in a
free-text Notes field. There is no way to detect that a row drifted, lost its owner, or was reviewed
by its own author.

### 3.2 Review state is derived from an append-only event log

`reviewState.js` walks `task.historyEvents` **backwards** for the newest of
`review_requested | review_started | review_changes_requested | review_approved`, with explicit
reset rules: a `status_changed → in_progress|deleted` resets to `none`; a `status_changed → pending`
triggers a lookback that *preserves* `needsFix` but clears `review`/`approved`.

The persisted `task.reviewState` field and the kanban column are only **fallbacks**, and every
return value carries a `source` string (`history_review_approved`, `task_review_state_pending_reset`,
`kanban_column`…). You can always answer "why does this say approved?"

That's the same discipline as our §N1 register — a stable status plus its provenance — applied at
per-task granularity.

### 3.3 Work-sync: a heartbeat that an agent cannot fake

`workSync.js`. Members call `member_work_sync_report` with:

```
state: 'still_working' | 'blocked' | 'caught_up'
agendaFingerprint: <hash of the agenda the member was actually shown>
reportToken: <issued by the control plane>
taskIds, note
```

Both `agendaFingerprint` and `reportToken` are **required** (`assertReportBody`). The point:
**a member cannot claim `caught_up` against a stale view of its own queue.** If work landed after
the fingerprint it was shown, the claim is invalid. If the control plane is unreachable, the report
is written to a durable `pending-reports.json` intent file and explicitly *not* treated as accepted —
the returned message is: *"Continue concrete task work; do not treat this as a confirmed lease yet."*

The companion design doc (`member-work-sync-review-obligation-plan.md`, 2,078 lines) is worth
reading in full. Its central admission:

> "A `member_work_sync_report(still_working)` can suppress more nudges, but it does not prove that
> the reviewer called `review_start`."

Their fix is an **obligation state machine** — `review_requested → review_pickup_required`,
cleared only by `review_started` or a decision — with the nudge keyed by `reviewRequestEventId`
(not the whole fingerprint, so it's genuinely one-shot), and **escalation to the lead after an
ignored correction rather than re-nudging the member**.

This is the direct answer to "the agent returned `DONE` but the work isn't there."

### 3.4 Cascade guard — 59 lines that prevent runaway agent chatter

`cascadeGuard.js`:

```
MAX_PER_MINUTE   = 10   // cross-team messages from one team
PAIR_COOLDOWN_MS = 3000 // per (fromTeam → toTeam) pair
MAX_CHAIN_DEPTH  = 5    // A→B→C→…
WINDOW_MS        = 60000
```

Depth travels in the message envelope itself (`crossTeamProtocol.js`):
`<cross-team from="…" depth="2" conversationId="…" replyToConversationId="…" />`.

Cheap, and it is the difference between "agents collaborate" and "two agents ping-pong until the
token budget is gone."

### 3.5 Bounded briefings with *explicit* omission lines

Every briefing is hard-capped — 50 actionable, 30 awareness, 8 expanded contexts, 1,200 description
chars, 500 comment chars, 25 anomalies — and truncation **always** emits a visible line:

```
... 12 more Actionable item(s) omitted. Use task_list filters and task_get for drill-down.
```

Never a silent cap. That is our own "no silent caps" rule, implemented.

---

## 4. Smaller ideas worth taking

- **`<info_for_agent>` blocks** (`agentBlocks.js`). Agent-only content wrapped in a machine-strippable
  tag, with `stripAgentBlocks()` applied before anything reaches a human surface — and a hard repo
  rule: *"Use `wrapAgentBlock(text)` instead of manually concatenating agent block markers."*
  We currently interleave agent instructions and user-facing prose in the same doc.
- **Provider-adaptive protocol rendering** (`memberMessagingProtocol.js`). The same instruction is
  rendered per runtime — `SendMessage` for native, `agent-teams_message_send` for OpenCode/Codex,
  with an alias list covering the four name manglings MCP clients apply. Only relevant if we ever
  mix Claude with Codex agents.
- **Reentrant board lock with a depth counter** (`boardLock.js`) — because one logical operation
  touches tasks + kanban + history, and naive locking self-deadlocks.
- **Source-file-size ratchet.** Their `AGENT_CRITICAL_GUARDRAILS.md` caps new files at 800 lines and
  freezes existing offenders in `scripts/ci/source-file-size-baseline.json` — legacy files may
  shrink, never grow, and exceptions can't be added. A clean §N2-shaped mechanical rule.
- **Sandbox rule, stated as a guardrail:** *"Do not test agent teams … on real user projects."*
  Named repos are called out explicitly. We should have the same line about this repo.

---

## 5. What I'd change in `app-dev-team`

Current state: `/app-build` reads `docs/31-board.md`, spawns devs in parallel, streams
`code-reviewer` per returning ticket, caps review cycles at 2, and writes `docs/daily/<today>.md`.
The loop shape is right. The **state model** is the weak part.

Ranked by value / effort:

| # | Change | Effort | Why |
|---|---|---|---|
| **P1** | Make the board **derived**. Append-only `docs/31-board-events.jsonl` as the source of truth; `docs/31-board.md` becomes a generated view. | M | Kills status drift; makes "who acts next" recomputable and auditable. Precondition for P2/P3. |
| **P2** | **Board doctor** — a script implementing §3.1's cascade. Run it as step 0 of `/app-build`; refuse to spawn anyone while any anomaly is open. | S | Catches `owner_missing`, `owner_invalid`, `self_review_invalid`, `dependency_broken` *before* burning a sprint's tokens. Direct §N enforcement. |
| **P3** | **Reviewer identity binding.** Record `review_requested`/`review_started`/decision as events with actor. Forbid owner == reviewer. Make "claimed review that never started" visible. | S | Today we rely on remembering to spawn a different agent. §3.2/§3.3. |
| **P4** | **Cascade guard for our loop.** Alongside the existing 2-cycle cap: max agent spawns per ticket, max delegation depth, max spawns per round. | S | Bounds token burn on a runaway loop. §3.4. |
| **P5** | **`<info_for_agent>` convention + bounded, explicitly-truncated briefings** in every agent prompt. | S | Cleaner handoffs; no silent context loss. §3.5, §4. |

Notes on implementation: we do **not** need their file-lock machinery — Claude Code's own
`TaskCreate`/`TaskUpdate`/`TaskList` already give us a serialized task store, and `Workflow` gives us
deterministic fan-out. The transferable part is the **derivation logic and the anomaly vocabulary**,
not the persistence layer.

---

## 6. Reminder on provenance

Their shell is AGPL-3.0. Everything above is **conceptual** — state-machine shapes, precedence
ordering, guard constants, and naming. Do not copy `agent-teams-controller` source into our plugin.
Re-implement from the described behaviour.

Standing security position (see the 2026-07-29 assessment): do not run the app itself against this
repo. `--dangerously-skip-permissions` and `bypassPermissions` are wired into their team
provisioning and `ScheduledTaskExecutor`, driven by a closed binary from a private repository, with
a bus factor of one and no `SECURITY.md`. Studying the source carries none of that risk; running the
product against a tree containing our keystore, Firebase credentials, and Play publishing identity
does.
