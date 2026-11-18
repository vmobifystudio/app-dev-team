# team-protocol — the channel in full

Loaded from `team-protocol` SKILL.md when you send a material message, register a formal artifact, query channels, or migrate a pre-log project. Record shape (schema `studio-event-schema/v1`):

```json
{"id":"MSG-0421","v":1,"ts":"2026-07-29T10:12Z","project":"tipjar","thread":"THR-APP-004",
 "ticket":"APP-004","kind":"question","from":"android-developer","to":["tech-lead"],
 "priority":"material","blocking":false,"requires_response":true,"expires_after_round":6,
 "requirements":["REQ-031"],"summary":"Which error type for a failed toggle?",
 "body":"Spec names TodoError but the repo throws IOException. Which wins?","status":"open"}
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
