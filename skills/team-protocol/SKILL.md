---
name: team-protocol
description: On an app-dev-team project, use whenever one role needs something from another — a blocker, a spec question, a handoff, an escalation — and as the reference for the team ledger (docs/team/messages.jsonl), who may message whom, and the output contract. Used by every role.
---

# Team protocol

The core every role needs. Read a reference only when the situation names it:

| Read | When |
|---|---|
| `references/channel.md` | sending a material message (the obligation rule), registering a formal artifact (ADR, PDR, DDR, WAIVER, INCIDENT, ASSUMPTION), querying channels, migrating a pre-log project |
| `references/mid-sprint-qa.md` | §Mid-sprint Q&A — you are the `/app-build` orchestrator, `tech-manager`, or `tech-lead` answering the batch |
| `references/output-contract.md` | what a CODE / DOC profile field means, which roles use which profile, gate verdict blocks |
| `references/anti-ping-pong.md` | a send was refused, or you are auditing a ledger |
| `references/evidence-bundle.md` | §Evidence bundle — you write or audit a test claim (`qa-engineer`, `test-automation-engineer`, `release-auditor`) |

## The channel: `docs/team/messages.jsonl`

One append-only event log for the team. `docs/team/messages.md` is its **generated** view — never
hand-edit it. Write with the helper; it is the only writer:

```bash
sh "${CLAUDE_PLUGIN_ROOT}/scripts/team-message.sh" \
   --from android-developer --to tech-lead --ticket APP-004 --kind question \
   --summary "Which error type for a failed toggle?" \
   --body "Spec names TodoError but the repo throws IOException. Which wins?"
```

- **Kinds:** `question` · `answer` · `handoff` · `blocker` · `fyi` · `escalation` · `decision`.
- **`answer` and `decision` each close exactly one open `question` on that ticket**, oldest first.
  A `decision` that decides nothing silently consumes a real open question — **use `fyi` for
  anything that is not an answer.** An `answer`/`decision` naming no artifact (`--artifact`) or
  transition is refused.
- **Every message names a ticket** — or the ASCII hyphen `-`, and only `-`, for project-wide
  chatter (`--ticket -`). An em dash is read as a ticket ID and trips the pair guard.
- **`--summary` is one line and must stand alone.** Append, never edit; correct a record by
  appending a later one.

## Who may talk to whom

Direct messages follow the org chart; anything else goes through `tech-manager`.

| From | May message directly |
|---|---|
| any IC (`ios-developer`, `android-developer`, `backend-developer`, `web-developer`, `monetization-engineer`, `test-automation-engineer`) | `tech-lead` (patterns, spec) · `tech-manager` (scope, blockers, board) · `ux-architect` (flow/state gaps) · `product-designer` (token/component gaps) · `product-manager` (what a criterion means) |
| `code-reviewer` | the ticket's owner · `tech-lead` · `tech-manager` |
| `qa-engineer` | the ticket's owner · `tech-manager` |
| `tech-lead` | any IC · `tech-manager` · `cto` |
| `tech-manager` | anyone |
| `cpo` ↔ `cto` | each other · `ceo` |
| anyone | `tech-manager`, always |

An IC never messages `ceo`, `cpo` or `cto`. Product ambiguity goes to `tech-manager`, who decides
whether it needs `cpo` — that stops every IC independently re-opening settled scope.

## ICs (developers, reviewers, QA): declare, don't dispatch

An agent that can proceed will proceed; it cannot wait for an answer inside its own run. So your
primary obligation is the `Assumptions & open questions` field of your output contract: every place
the spec did not answer something and you decided anyway, with the decision and the reasoning. If
you sent a message, paste its ledger row; if not, write `ASSUMED, NOT RAISED`. **Never write that
you raised something you did not** — the orchestrator and the standup read that line as fact. The
orchestrator files every `ASSUMED, NOT RAISED` as a real question for you.

Send a live `question` only when you can keep working on another part of the ticket meanwhile.

## Ask before you block

`BLOCKED` costs a re-spawn. (1) Re-read the impl spec and flow doc. (2) Send one `question` and
keep working elsewhere. (3) Only then (`Need: tech-lead` is answered this round, then you re-spawn):

```
BLOCKED: APP-NNN
Reason: <one paragraph>
Need: <who needs to answer what>
```

Never just "unclear" — name **who** must answer **what**.

## Limits

Hard caps live in `${CLAUDE_PLUGIN_ROOT}/scripts/lib/messages.mjs` (per role per round, same-pair cooldown, chain depth,
per-ticket budget, duplicate question, re-opening a decided thread needs `--evidence`); a refusal
writes nothing and states its code and remedy. **Escalation after one unresolved round** is
mandatory: a second question while your first is unanswered is refused — escalate the first. On breaching any of them: stop messaging, write one
`escalation` to `tech-manager` naming both positions in one sentence each, and move on. Table:
`references/anti-ping-pong.md`.

## Output contract

Ticket-working agents return the **CODE** or **DOC** profile, starting `DONE: APP-NNN`; gating roles
return their own verdict block. `spawn-prompt.mjs` inlines the exact fields into your spawn prompt —
return every one, in order. A field you omit is a gate that silently passes. Field meanings:
`references/output-contract.md`.

## Canonical paths — no other spelling is recognised

| Artifact | Path |
|---|---|
| Your per-run fragment | `docs/daily/<today>-<role>-<ticket>.md` |
| Same, for a spec-writing exec with no ticket (`ceo`, `cpo`, `cto`) | `docs/daily/<today>-<role>-spec.md` |
| The aggregated standup (tech-manager only) | `docs/daily/<today>.md` |
| The team channel (source of truth) · its generated view | `docs/team/messages.jsonl` · `docs/team/messages.md` |
| A review verdict | `docs/53-reviews/APP-NNN-cycle-N.md` |
| Second / specialist verdicts | `docs/53-reviews/APP-NNN-cycle-N-tech-lead.md` · `docs/53-reviews/APP-NNN-cycle-N-security.md` · `docs/53-reviews/APP-NNN-cycle-N-verification.md` |
| Incident ledger | `docs/team/incidents.jsonl` |
| ship-gate · journey-gate · runtime-gate recorded verdicts | `docs/team/ship-gate-verdict.json` · `docs/team/journey-result.json` · `docs/team/runtime-result.json` |
| Evidence, two dirs by writer: screenshots + human bundles · script-written gate records | `docs/54-evidence/` · `docs/team/evidence/` |
| memory-curator's ledger | `docs/team/memory.jsonl` |
| Journey contract · one declared P0 journey | `docs/team/journeys/README.md` · `docs/team/journeys/<journey-id>.json` |
| Platform, toolchain, test scopes · artifact-to-commit binding | `docs/team/project-profile.json` · `docs/team/release-candidates.jsonl` |
| Run ledger · slot leases (gitignored) · schema registry | `docs/team/runs.jsonl` · `docs/team/worktree-slots.json` · `docs/team/schema-registry.json` |
| Dispatch manifests | `docs/team/capabilities.json` · `docs/team/risk-policy.json` · `docs/team/schedule.json` · `docs/team/context-manifest.json` |
| HMAC actor keys — `deny_all`, never writable by any role | `docs/team/actors.json` |
| Per-spawn actor tokens — script-written only | `docs/team/actor-tokens.jsonl` |
| Saved IC report (SubagentStop hook) | `docs/team/reports/<ticket>-<UTC>.md` |

## Evidence bundle fields

A test claim with no discoverable bundle at `docs/54-evidence/<journey>-<build-id>.md` stays
`unverified`. Every field is required; one you cannot fill says `unknown` and sets
`Result: unverified`: `Build id:` · `Device:` · `OS:` · `Inputs:` · `Screenshot/recording:` ·
`Logs:` · `Analytics events:` · `Result:` · `Requirement IDs:` · `Tester identity:` ·
`Timestamp:` · `Artifact hash:`. Why each: `references/evidence-bundle.md`.

## Escalate to the user when — and only when

- Two roles disagree and neither has authority (a `cpo`/`cto` scope-vs-cost split)
- A requirement is genuinely ambiguous and guessing would build the wrong thing
- The review-cycle cap or spawn budget is hit
- A change is destructive and irreversible (data migration, billing, a store submission)

Escalate with the question in one sentence, both options with their cost, and **a recommendation**.

## Never

- Never invent an answer to a question you raised. An unanswered question is reported, not guessed.
- Never relay a message by paraphrase when you can point at its ledger row.
- Never send a message you have already sent. Re-sending is not escalation.
- Never `fyi` the whole team. Address one role.
