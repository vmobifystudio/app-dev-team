---
name: team-protocol
description: Use whenever one role needs something from another role — a blocker, a spec question, a cross-platform divergence, a handoff, or an escalation. Defines the durable team message ledger, who may talk to whom, the anti-ping-pong guard, and when to escalate to the user instead. Triggers from every agent that would otherwise say "I need X from Y" and stop.
---

# Team protocol

A team is not a set of roles. It is a set of roles plus an agreed way to talk.

Without one, this happens: an IC hits an ambiguity, writes `BLOCKED: needs tech-lead`, and exits.
The orchestrator reads it, spawns `tech-lead` with a paraphrase, gets an answer, paraphrases it
back, and re-spawns the IC from cold. Three context rebuilds, two lossy translations, and the
original question is now a summary of a summary.

## The channel: `docs/team/messages.jsonl`

One append-only event log for the whole team, schema `studio-event-schema/v1`. It works on a vanilla
install, survives an agent dying mid-run, and gives a restarted agent its history back.

`docs/team/messages.md` is the **generated human view** of that log — the same relationship
`docs/31-board.md` has to `docs/31-board-events.jsonl`. **Never hand-edit it.** A hand edit is
overwritten by the next render and is invisible to every rule.

```json
{"id":"MSG-0421","v":1,"ts":"2026-07-29T10:12Z","project":"tipjar","thread":"THR-APP-004",
 "ticket":"APP-004","kind":"question","from":"android-developer","to":["tech-lead"],
 "priority":"material","blocking":false,"requires_response":true,"expires_after_round":6,
 "requirements":["REQ-031"],"summary":"Which error type for a failed toggle?",
 "body":"Spec names TodoError but the repo throws IOException. Which wins?","status":"open"}
```

**Kinds:** `question` · `answer` · `handoff` · `blocker` · `fyi` · `escalation` · `decision`

**`answer` and `decision` each close exactly one open `question` on that ticket** — pairing is by
count, oldest first. So do not use `decision` for a note that decides nothing: it will silently
consume a real open question. Observed live — a `decision` correcting a tooling mistake made a
genuinely unanswered product question look resolved, and the ticket had already shipped on the
assumption underneath it. **Use `fyi` for anything that is not an answer.**

Rules:

- **Append, never edit.** Correct a wrong record by appending a later one.
- **`--summary` is one line and must stand alone.** It is what the orchestrator and the user read.
- **Every message names a ticket** — or the ASCII hyphen `-`, and only `-`, for project-wide
  chatter: `--ticket -`. This said `—` (an em dash), which `team-message.sh` does not recognise as
  the sentinel: it treats it as an ordinary ticket ID, so every project-wide broadcast joined one
  pseudo-thread and the third one was **refused by the anti-ping-pong pair guard**. The guard is
  skipped for `-` precisely because broadcast chatter carries no thread. A message with no ticket at
  all cannot be routed or closed.
- A `question` is not resolved until an `answer` **or** a `decision` on the same ticket exists.
  `board-doctor` reads the channel (as a sibling of the board) and reports `question_unanswered` —
  and says explicitly when the ticket has already reached `qa`/`done`, i.e. shipped on an
  unconfirmed assumption.

Write with the helper. It is the only writer; there is no hand-edit fallback, because a row appended
by hand routes around every rule below:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/team-message.sh" \
   --from android-developer --to tech-lead --ticket APP-004 --kind question \
   --summary "Which error type for a failed toggle?" \
   --body "Spec names TodoError but the repo throws IOException. Which wins?"
```

**A project that predates the event log keeps working.** The first send migrates
`docs/team/messages.md` into `docs/team/messages.jsonl`, announces that it did, and marks every
migrated record `provenance:"inferred"` — priority, status, thread and the follow-up round were never
recorded in Markdown, so they were reconstructed, not read. Nothing is stranded and nothing is
claimed that was not there.

## Message obligations — what a message must yield

Every **material** message must yield one of four things:

| Obligation | How you satisfy it |
|---|---|
| a decision | `--kind decision`, or `--decision "<the call>"` |
| a state transition | `--transition APP-004:merged` |
| an artifact update | `--artifact ADR-003` or `--artifact docs/22-impl-spec-ios.md` |
| a timed follow-up | automatic on `question`/`blocker`/`escalation`/`handoff`; set explicitly with `--expires-after-round N` |

A message with none of them is **refused at send time, with the reason**. It never reaches the log.

The sharp edge: **an `answer` or a `decision` that names no artifact is refused.** A closed ledger is
not delivery (DR4-006) — if the answer was not folded into a spec, an ADR, or a ticket transition,
the next agent to read the spec still reads the old answer, and "every question answered" was the
metric that hid it. `messages-render` has a `DELIVERY` block listing every one that slipped through.

**`fyi` is the escape hatch, and it must be chosen.** `--kind fyi` (or `--priority fyi`) exempts a
message from the obligation rule. Nothing defaults into it: if you find yourself reaching for it to
get a message past the check, the message probably should not be sent.

## Threads and channels are derived, never authored

A **thread** is the messages sharing a ticket. A **channel** is a query over the log:
`#founder-decisions` · `#product` · `#design` · per-platform (`#ios`, `#android`, `#backend`) ·
per-ticket (`#app-004`) · `#artifacts`. Nothing subscribes and nothing is filed into a channel —
membership is computed from who sent it, to whom, about what.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" channels     # every channel the log can produce
```

This is the board's rule again: a view may only show what the log can produce. The moment a channel
becomes a place state is written, it is a second source of truth.

## Formal artifacts

Six record types, each with an ID series, a declared writer and declared readers. One command writes
the file **and** registers it on the channel, because a file nobody knows exists and a claim with no
content fail in exactly the same way:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/messages.mjs" artifact <TYPE> --by <role> --title "<one line>"
```

| Type | Path | Writer | Readers | Extra required |
|---|---|---|---|---|
| `ADR` architecture decision | `docs/24-adr/` | `cto`, `tech-lead` | `tech-lead`, the IC pod | — |
| `PDR` product decision | `docs/16-pdr/` | `cpo`, `ceo` | `tech-manager`, `tech-lead`, `qa-engineer` | — |
| `DDR` design decision | `docs/17-ddr/` | `ux-architect`, `product-designer` | `ios-developer`, `android-developer`, `tech-lead` | — |
| `WAIVER` | `docs/72-waivers/` | `security-reviewer`, `cto` | `release-manager`, `tech-manager` | `--expires YYYY-MM-DD` |
| `INCIDENT` | `docs/73-incidents/` | `release-manager`, `qa-engineer` | `tech-manager`, `cto` | — |
| `ASSUMPTION` | `docs/25-assumptions/` | `tech-lead`, `cpo`, the IC pod | `tech-manager`, `qa-engineer`, `product-validator` | `--owner`, `--confidence`, `--validate-by` |

**An expired waiver is a finding.** `board-doctor` reports `waiver_expired` and keeps reporting it: a
period that ended without anyone noticing is a permanent exemption granted by accident. The same rule
runs on assumptions — `assumption_unvalidated` once `--validate-by` passes, because an assumption
past its date is a belief with a timestamp.

Cite the ID when you close the question it settles: `--artifact ADR-003`. That is what turns "we
discussed it" into "here is where it lives".

## Who may talk to whom

Direct messages follow the org chart. Anything else goes through `tech-manager`.

| From | May message directly |
|---|---|
| any IC (`ios-developer`, `android-developer`, `backend-developer`, `web-developer`, `monetization-engineer`, `test-automation-engineer`) | `tech-lead` (patterns, spec questions) · `tech-manager` (scope, blockers, board) · `ux-architect` (flow/state-inventory gaps) · `product-designer` (token/component gaps) · `product-manager` (what an acceptance criterion means) |
| `code-reviewer` | the ticket's owner · `tech-lead` (pattern disputes) · `tech-manager` (verdicts) |
| `qa-engineer` | the ticket's owner · `tech-manager` |
| `tech-lead` | any IC · `tech-manager` · `cto` |
| `tech-manager` | anyone |
| `cpo` ↔ `cto` | each other · `ceo` |
| anyone | `tech-manager`, always |

An IC never messages `ceo`, `cpo`, or `cto` directly. Product ambiguity goes to `tech-manager`,
who decides whether it needs `cpo`. This is not politeness — it stops every IC independently
re-opening settled scope.

## Why ICs mostly won't message — and what to do about it

Measured across three dry runs and ten agent-runs: **the live channel was used zero times.** That
includes a run where the agent hit a planted ambiguity, was handed the exact command, decided it
*should* raise the question — and then reported that it had, when it had not.

That is not laziness, it is structural. **An agent that can proceed will proceed.** It cannot block
waiting for an answer inside its own run, so it must decide anyway; sending the message costs it a
step and buys it nothing before it finishes. The declaration is where the value is, and the routing
is somebody else's job.

So the protocol splits by role:

**ICs (developers, reviewers, QA) — declare, don't dispatch.**
Your primary obligation is the `Assumptions & open questions` field in your output contract. Every
place the spec did not answer something and you decided anyway goes there, with the decision and
the reasoning. If you also sent a message, paste the ledger row. If you did not, write
`ASSUMED, NOT RAISED`. **Never write that you raised something you did not** — the orchestrator and
the standup both read that line as fact, and a false entry is worse than a missing one.

**The orchestrator and `tech-manager` — route what was declared.**
Every `ASSUMED, NOT RAISED` becomes a real ledger row filed on the agent's behalf, and an item for
the role that owns the answer. Nothing is lost because an IC was mid-flow.

**Use the live channel when you genuinely can keep working.** A spec question you can park while you
build another part of the ticket is worth sending immediately — the answer may arrive before you
need it. That is the case the channel is actually for, and it is rarer than it looks.

## Mid-sprint Q&A — the mechanism that actually answers

Declaring an assumption only helps if something later answers it. Until now nothing did: a
`question` landed on the ledger and sat there until a human read it. So each round of `/app-build`
opens with a **Q&A step** — one batched pass that closes the ledger before the next wave inherits
the guesses.

**Where it sits in the round.** After the board-doctor pre-spawn gate and after the previous wave's
`ASSUMED, NOT RAISED` lines have been filed as `question` rows — so this round answers last round's
guesses — and **before any developer is spawned**:

```
1. board-doctor gate
2. route the finished wave's "ASSUMED, NOT RAISED" into question rows
3. MID-SPRINT Q&A          ← this section
4. spawn the developer wave
```

Round 1 has no prior wave and usually no ledger; the render exits 2 and the step is a no-op.

**What counts as open.** A `question` row on a ticket with no matching `answer` or `decision` on the
same ticket. Matching is by count, oldest first — each resolution closes the earliest still-open
question on that ticket, exactly as `board-doctor` counts it. Read the batch, do not re-derive it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/messages-render.mjs" docs/team/messages.jsonl --board docs/31-board.md
```

The `OPEN QUESTIONS` block **is** the batch. Empty block, or exit 2, means skip to the wave.

**How it is batched.** Group by ticket and spawn `tech-lead` **once** for the whole batch — never
once per question, never once per ticket. One spawn, one context, every open question in it.

**What `tech-lead` must emit.** One ledger row per open question, and nothing that is not a row:

- It can answer → an `answer` row on that ticket, addressed to the asker. This is what closes the
  count.
- It cannot answer → **one** `escalation` row to `tech-manager` covering every question it could not
  settle on that ticket, naming for each what decision is needed and who owns it (`cpo` for product
  scope, `cto` for architecture, the user for anything irreversible). An `escalation` deliberately
  does **not** close the question: it stays open and keeps rendering until the owner answers it.

Prose in the spawn's reply is not an answer. If the row is not on the ledger, the question is open.

**The guard still holds.** The pair budget already caps one asker at 2 questions per ticket, so the
2 answers back fit inside it — the batch does not need an exemption and does not get one. If a
ticket somehow carries more than 2 open questions from the same role, the ledger was written around
the guard: answer the two you can and put the rest in the single `escalation`.

**Questions on a ticket that already reached `qa`/`done`.** Answer them anyway — the renderer flags
these first because the ticket shipped on the assumption. If the real answer contradicts what
shipped, `tech-manager` files a `BUG-NNN` against it. Never close one of these with a `decision`
that merely ratifies whatever the code happens to do.

**Verifying the step ran.** Re-render after the spawn. The open count must have fallen by the number
of `answer` rows, and every question still open must have an `escalation` naming its owner. If
neither is true, the spawn produced prose; retry once, then it becomes a `tech-manager` action item.

## The output contract — what every ticket-working agent returns

The sprint loop parses your closing block. It is not a summary for a human; it is the input to
`verify-done.sh`, the merge gate, the collision check, and the standup. **A field you omit is a
gate that silently passes.**

There are two profiles. Every spawnable ticket owner uses one of them — including roles whose
ticket produces documents rather than code, because a doc ticket is still work on a branch that
still has to be verified and merged.

**CODE profile** — `ios-developer`, `android-developer`, `backend-developer`,
`monetization-engineer`, `devops-engineer`:

```
DONE: APP-NNN
Worktree: <the path you were given, or "none — shared tree">
Branch: feat/APP-NNN-short-slug        (created BEFORE any file was written)
Staged (explicit paths): <list>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Files: <list>
Tests: <count> added, <exact command run>, exit 0
Second-path check: <the writers/readers you grepped, or "none applicable">
Daily fragment: <path to docs/daily/<today>-<role>-<ticket>.md that you wrote>
Assumptions & open questions: <every place the spec did not answer something and you decided
  anyway, with the decision and the reasoning. Paste the docs/team/messages.md ledger row for each
  one you raised; write "ASSUMED, NOT RAISED" for each one you did not. Never write that you
  raised something you did not — the orchestrator and the standup read this line as fact.>
Shared surfaces touched: <files/types that are not exclusively yours — a shared model, an error
  type, a DI graph, a design-system component — or "none". Also name any cross-cutting abstraction
  you had to CREATE (an analytics logger, a clock, a result wrapper): if another ticket needed one
  too, you have both just built it and the merge will pick one arbitrarily.>
Next: code-reviewer
```

**DOC profile** — `ux-architect`, `product-designer`, `product-manager`, `product-researcher`,
`qa-engineer`, `aso-specialist`, `data-analyst`, `verification-engineer` when it owns a ticket:

```
DONE: APP-NNN
Worktree: <the path you were given, or "none — shared tree">
Branch: docs/APP-NNN-short-slug        (created BEFORE any file was written)
Files: <the docs you wrote or edited>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Daily fragment: <path to docs/daily/<today>-<role>-<ticket>.md that you wrote>
Assumptions & open questions: <as above — ledger row or "ASSUMED, NOT RAISED">
Shared surfaces touched: <single-owner docs another ticket may also be writing —
  13-design-tokens.md, 52-analytics.md, 15-aso.md, 50-test-plan.md — or "none">
Next: <the role that consumes this doc>
```

The DOC profile has no `Tests:` line, so the loop verifies it with
`verify-done.sh <branch> <base> --docs-only`: branch, commits and changed files are still checked,
the test command is not required. **`Branch:` is required in both profiles.** A doc ticket with no
branch cannot be verified, cannot be merged, and cannot be told apart from a ticket nobody worked.

Roles that **gate** rather than work tickets — `code-reviewer`, `security-reviewer`,
`verification-engineer` in its certifying role, `release-manager`, `tech-lead`, `tech-manager` —
return their own verdict block instead (`APPROVED:` / `REQUEST CHANGES:` / `SECURITY:` /
`VERIFICATION:` / `SHIP CANDIDATE:`). A role that can do both says which it is doing in its first
line.

Canonical paths, used verbatim by the loop — no other spelling is recognised:

| Artifact | Path |
|---|---|
| Your per-run fragment | `docs/daily/<today>-<role>-<ticket>.md` |
| Same, for a spec-writing exec with no ticket (`ceo`, `cpo`, `cto`) | `docs/daily/<today>-<role>-spec.md` |
| The aggregated standup (tech-manager only) | `docs/daily/<today>.md` |
| The team channel (source of truth) | `docs/team/messages.jsonl` |
| ...and its generated view | `docs/team/messages.md` |
| A review verdict | `docs/53-reviews/APP-NNN-cycle-N.md` |
| ship-gate.sh's last recorded verdict | `docs/team/ship-gate-verdict.json` |
| memory-curator.mjs's proposed/reviewed ledger | `docs/team/memory.jsonl` |
| The journey-declaration contract (journey-gate) | `docs/team/journeys/README.md` |
| journey-gate's recorded verdict, read by the readiness reducer | `docs/team/journey-result.json` |
| runtime-gate's recorded verdict, read by the readiness reducer | `docs/team/runtime-result.json` |
| The project's platform, pinned toolchain and test scopes (F6) | `docs/team/project-profile.json` |
| The artifact bound to its commit (F17) | `docs/team/release-candidates.jsonl` |
| Every `name/vN` this studio writes, and who reads it (F7) | `docs/team/schema-registry.json` |

If you hit a blocker, end with this instead — and name **who** must answer **what**, never just
"unclear":

```
BLOCKED: APP-NNN
Reason: <one paragraph>
Need: <who needs to answer what>
```

## Ask before you block

`BLOCKED` is expensive: it discards a warm context and costs a full re-spawn. Before writing one:

1. Can the spec answer it? Re-read the impl spec and the flow doc first.
2. Can one message answer it? Send a `question` to the right role and **keep working on another
   part of the ticket** while you wait. Only block if nothing else on the ticket can proceed.
3. Only then `BLOCKED`, and the blocker must name **who** must answer **what** — never just
   "unclear".

## Anti-ping-pong guard

Two agents can burn a whole budget agreeing with each other. Hard limits, with **one implementation**
in `scripts/lib/messages.mjs`: `team-message.sh` calls it to refuse the send, `board-doctor` calls it
to audit a log written by hand or migrated around it. The numbers used to be stated in three files
and two of them disagreed — a ledger the script had happily written was reported as a breach, and a
chain it refused was invisible to the doctor.

| Limit | Value | Why |
|---|---|---|
| Messages per role, per round | **10** | A role sending more is looping, not working |
| Same-pair cooldown | **2 messages** on one ticket without a third party | A ↔ B twice is a conversation; three times is a stall |
| Chain depth | **4 roles** on one ticket | A asks B who asks C who asks D — stop and escalate |
| Per-ticket discussion budget | **12 messages** | The pair and chain caps bound *who* talks; nothing bounded *how much*, so a thread could grow forever by rotating participants |
| Duplicate question | **refused** | Same ticket, same question already asked. Re-asking is not escalation: it produces a second unanswered question, not an answer |
| Escalation after one unresolved round | **mandatory** | You already have an unanswered question on this ticket. A second one is a second thing nobody answered — escalate the first |
| Reopening a resolved thread | **needs `--evidence`** | A ticket that reached a `decision` does not reopen on a new opinion. Say what changed and where it is recorded, or the decision stands |
| Unanswered question age | **1 round** | Then it becomes a `tech-manager` action item |

Every one of those refusals states its code, its reason and its remedy, and **nothing is written** —
a refusal that had already appended is a message the sender believes went out and no guard ever
counted.

On breaching any limit: stop messaging, write one `escalation` to `tech-manager` naming both
positions in one sentence each, and move on. Do not re-send. An `escalation` is exempt from every
volume limit, because it is the prescribed way *out* of each of them.

`tech-manager` resolves it or escalates to the user — it never re-opens the same pair.

## Evidence bundle — what makes a test claim believable

A test result is a **claim by the actor that ran it**. `release-auditor` will not accept one, and
neither should anyone else, unless it resolves to a discoverable evidence bundle.

**A test claim with no discoverable evidence bundle stays `unverified`.** Not failed — unverified,
which is a different and more honest thing: nobody knows. A release whose critical journeys are
`unverified` does not ship.

Bundles live at `docs/54-evidence/<journey>-<build-id>.md`, one per critical journey per build,
written by `qa-engineer` and `test-automation-engineer`. Twelve fields, every one required:

| Field | Why it is required |
|---|---|
| `Build id:` | which artifact — a result about another build is about another product |
| `Device:` | the device class from the matrix, named, not "a phone" |
| `OS:` | version, because the defect is usually version-specific |
| `Inputs:` | the exact inputs used, so the run can be repeated |
| `Screenshot/recording:` | a path in the repo — the thing a human can look at |
| `Logs:` | a path — what the machine saw while the human was looking |
| `Analytics events:` | the events actually emitted, because instrumentation is a shipped feature too |
| `Result:` | `pass` · `fail` · `unverified`, and nothing else |
| `Requirement IDs:` | what this proves, back to `docs/10-prd.md` — a result proving nothing is noise |
| `Tester identity:` | which agent or human ran it, so self-approval is visible |
| `Timestamp:` | ISO 8601, so ordering against the build is checkable |
| `Artifact hash:` | ties the evidence to the binary — this is what stops evidence drifting builds |

A field you cannot fill is not omitted: write it with `unknown` and set `Result: unverified`. An
omitted field reads as a bundle that passed, which is exactly the failure this contract exists to
stop.

## Escalate to the user when — and only when

- Two roles disagree and neither has authority (a `cpo`/`cto` scope-vs-cost split)
- A requirement is genuinely ambiguous and guessing would build the wrong thing
- The review-cycle cap or spawn budget is hit
- A change is destructive and irreversible (data migration, billing, a store submission)

Escalate with: the question in one sentence, both options with their cost, and **a recommendation**.
Never escalate a menu with no recommendation — that is delegating the thinking back to the user.

## Never

- Never invent an answer to a question you raised. An unanswered question is reported, not guessed.
- Never relay a message by paraphrase when you can point at its ledger row.
- Never send a message you have already sent. Re-sending is not escalation.
- Never `fyi` the whole team. Address one role.
