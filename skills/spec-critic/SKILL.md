---
name: spec-critic
description: Use after the impl specs and the board exist but before any developer is spawned, to find every question a developer would otherwise be forced to guess at — error types, empty/failure states, cancel paths, source of truth, units, offline, atomicity. Produces `question` rows in the team ledger for tech-lead to answer in one batch. Triggers from /app-plan and from tech-lead whenever a sprint is about to start.
---

# Spec critic

`tech-lead` runs this. **Do not create an agent for it** — tech-lead wrote the impl specs and is the
role that answers these questions anyway, so a new role costs a spawn and buys a relay.

Run it **once per sprint**, after `docs/22-impl-spec-*.md` and `docs/31-board.md` exist and before
`/app-build` spawns anyone. Not once per ticket.

## Why it exists

Measured across three dry runs and ten agent-runs, the live team channel was used **zero times** —
including a run where the agent hit a planted ambiguity, decided it should raise it, and then
reported that it had, when it had not. An agent that can proceed will proceed. The full story is in
`skills/team-protocol/SKILL.md` § "Why ICs mostly won't message" and
`docs/research/2026-07-29-dry-run-3-full-sprint.md`.

"Declare, don't dispatch" catches the guess *after* it was made. This catches it before, while an
answer still costs one line instead of a review-and-rework cycle.

## What you hunt

For each ticket on the board, read its acceptance criteria and the spec section it points at, then
ask what a developer would have to invent. **Ground every question in an acceptance criterion — a
question no criterion depends on is noise.**

- **Error type at a boundary.** Which type crosses repo → view model? What does the spec's named
  type map to when the platform throws its own?
- **Empty, loading, failure.** Each is a state with UI. Which of the three does the spec skip?
- **Source of truth.** Two components hold the same value — which one wins when they disagree?
- **Cancel.** The happy path is usually specified and the cancel branch usually is not. This project
  shipped a photo picker whose success branch was right and whose cancel branch wiped the existing
  photo (`skills/defect-hunting/SKILL.md` §1).
- **Idempotency and atomicity.** Run it twice — same result? Fail halfway — is the write all or
  nothing?
- **Validation ownership.** Which layer rejects bad input: UI, view model, or repository? Named once
  or in all three?
- **Exact copy.** A user-visible string the spec describes but does not quote.
- **Numbers.** Units, and what happens exactly *at* the boundary value, not near it.
- **Offline.** Queue, fail, or read stale?

## The discipline that keeps it from becoming noise

Every question must:

1. **Name the ticket.** A question with no ticket cannot be routed or closed.
2. **Be answerable in one sentence.** If it needs a design discussion, it is a scope issue — send it
   to `tech-manager` as a `blocker`, not to `tech-lead` as a question.
3. **State the two-or-more plausible answers a developer would pick between.** If you can only think
   of one plausible answer, the spec is terse, not ambiguous. **Do not file it.**

Cap at **3 questions per ticket**, highest-risk first. If you dropped any, say so and name what you
dropped — this codebase forbids silent caps.

## Filing them

One `question` row **per ticket**, carrying up to three numbered questions in the body — not one row
per question. Two reasons: the anti-ping-pong guard refuses a third send on the same pair and
ticket, and `board-doctor` pairs questions to answers **by count**, so three rows need three
separate answers to close while one row closes with one.

**`--from` is the ticket's `Owner`, never `spec-critic`.** You are a skill, not a role: you are in
no org-chart row, so an answer addressed back to you is addressed to nobody and the developer who
needed it never sees it. File on the owner's behalf — the same thing `/app-build` step 1a does with
an `ASSUMED, NOT RAISED` line — so the `answer` comes back to a party that will actually read it.

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/team-message.sh" \
   --from ios-developer --to tech-lead --ticket APP-004 --kind question \
   --summary "3 spec gaps on APP-004: error type, cancel path, empty state" \
   --body "1) Toggle failure: TodoError or the IOException the repo throws? 2) Picker cancel: keep the existing photo or clear it? 3) Empty list: placeholder copy is unspecified — exact string?"
```

The helper exits `1` if it refuses the send. **A refused send is not a sent message** — if it
refuses, stop and file one `escalation` to `tech-manager` instead. Never write that you raised a
question you did not raise.

## Then — and the fold-back is the delivery

`tech-lead` answers in the same run wherever it can — it wrote the specs, so most answers are one
line — with an `answer` row per ticket. Then, **mandatorily**, it edits each answer into
`docs/22-impl-spec-*.md` at the section the question was about, and names the edited section in the
`answer` body.

**A closed ledger is not delivery.** The developer is spawned against the impl spec; it is not
handed the ledger and has no reason to read it. So the row closes the count and the *edit* is what
reaches the person who has to decide. Skip the fold-back and the board renders clean, the doctor
reports no `question_unanswered`, and the developer guesses exactly as if nobody had asked — a
metric that cannot fail. Answering without editing the spec is not answering; it is scoring.

Anything still open after this round becomes a `tech-manager` action item under the
unanswered-question rule in `team-protocol`.

## Never

- Never file a question you can answer by re-reading the spec. Read it first.
- Never file style preferences, naming opinions, or "consider also…". This is ambiguity only.
- Never answer your own question in the ledger — you are the critic, not the decider.
