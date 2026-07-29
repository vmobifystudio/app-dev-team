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

## The channel: `docs/team/messages.md`

One append-only ledger for the whole team. It works on a vanilla install, survives an agent dying
mid-run, is readable by the user, and gives a restarted agent its history back.

```markdown
## Team messages (append-only — never edit or delete a line)

| Timestamp | From | To | Ticket | Kind | Summary | Body |
|---|---|---|---|---|---|---|
| 2026-07-29T10:12Z | android-developer | tech-lead | APP-004 | question | Which error type for a failed toggle? | Spec names TodoError but the repo throws IOException. Which wins? |
| 2026-07-29T10:19Z | tech-lead | android-developer | APP-004 | answer | Map to TodoError.Io at the repo boundary | Repository catches and maps. ViewModel only ever sees TodoError. Spec §Patterns updated. |
```

**Kinds:** `question` · `answer` · `handoff` · `blocker` · `fyi` · `escalation` · `decision`

**`answer` and `decision` each close exactly one open `question` on that ticket** — `board-doctor`
pairs them by count. So do not use `decision` for a note that decides nothing: it will silently
consume a real open question. Observed live — a `decision` row correcting a tooling mistake made a
genuinely unanswered product question look resolved, and the ticket had already shipped on the
assumption underneath it. **Use `fyi` for anything that is not an answer.**

Rules:

- **Append, never edit.** Correct a wrong line by appending a later one.
- **`Summary` is one line and must stand alone.** It is what the orchestrator and the user read.
- **Every message names a ticket** (or `—` for project-wide). A message with no ticket cannot be
  routed or closed.
- A `question` is not resolved until an `answer` **or** a `decision` with the same ticket exists.
  `board-doctor` reads this ledger (as a sibling of the board) and reports `question_unanswered` —
  and says explicitly when the ticket has already reached `qa`/`done`, i.e. shipped on an
  unconfirmed assumption.

Write with the helper so the format and the guard stay honest:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/team-message.sh" \
   --from android-developer --to tech-lead --ticket APP-004 --kind question \
   --summary "Which error type for a failed toggle?" \
   --body "Spec names TodoError but the repo throws IOException. Which wins?"
```

If the helper is unavailable, append the row by hand in exactly the shape above.

## Who may talk to whom

Direct messages follow the org chart. Anything else goes through `tech-manager`.

| From | May message directly |
|---|---|
| any IC (`ios-developer`, `android-developer`, `backend-developer`, `monetization-engineer`) | `tech-lead` (patterns, spec questions) · `tech-manager` (scope, blockers, board) · `ux-designer` (flow/token gaps) |
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
Daily fragment: <path to docs/daily/<today>-<role>-APP-NNN.md that you wrote>
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

**DOC profile** — `ux-designer`, `qa-engineer`, `aso-specialist`, `data-analyst`,
`verification-engineer` when it owns a ticket:

```
DONE: APP-NNN
Worktree: <the path you were given, or "none — shared tree">
Branch: docs/APP-NNN-short-slug        (created BEFORE any file was written)
Files: <the docs you wrote or edited>
Mutation confirmed: git diff --numstat -> <N files, +A/-B>
Daily fragment: <path to docs/daily/<today>-<role>-APP-NNN.md that you wrote>
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
| The aggregated standup (tech-manager only) | `docs/daily/<today>.md` |
| The team channel | `docs/team/messages.md` |
| A review verdict | `docs/53-reviews/APP-NNN-cycle-N.md` |

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

Two agents can burn a whole budget agreeing with each other. Hard limits, enforced by
`team-message.sh` at send time and re-checked by `board-doctor` against the ledger afterwards —
so a row appended by hand cannot route around the guard:

| Limit | Value | Why |
|---|---|---|
| Messages per role, per round | **10** | A role sending more is looping, not working |
| Same-pair cooldown | **2 messages** on one ticket without a third party | A ↔ B twice is a conversation; three times is a stall |
| Chain depth | **4** | A asks B who asks C who asks D — stop and escalate |
| Unanswered question age | **1 round** | Then it becomes a `tech-manager` action item |

On breaching any limit: stop messaging, write one `escalation` to `tech-manager` naming both
positions in one sentence each, and move on. Do not re-send.

`tech-manager` resolves it or escalates to the user — it never re-opens the same pair.

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
