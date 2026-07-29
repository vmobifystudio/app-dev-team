---
name: intent-trace
description: Use whenever an artifact derives from another one — writing the PRD from the founder brief, criteria from a requirement, tickets from criteria, tests from criteria, analytics from a feature, or a release from all of it. Defines the founder-intent record, the traceability IDs every node carries, the precedence order that resolves a conflict, and the three-state vocabulary that stops an artifact being silently "fine". Triggered before scope-lock, at every hand-off, and by anything that runs scripts/trace.mjs.
---

# Intent trace

This team writes the PRD, derives acceptance criteria from its own PRD, implements against its own
spec, and tests against its own criteria. **It can prove conformity to its interpretation and nothing
else.** If the interpretation drifted, everything downstream is consistently, verifiably, greenly
wrong.

Nothing in here fixes that by being read. It fixes it by making the derivation *nameable*: every
node says where it came from and who checks it, and two scripts fail when the chain does not hold.

## 1. The founder record — `docs/00-founder-intent/`

The original brief, transcripts, examples, competitor references and constraints **exactly as
received**. Derived documents evolve; this one does not.

```
docs/00-founder-intent/
  README.md            what this directory is, copied from the plugin
  brief.md             the founder's words, verbatim, dated
  transcript-<date>.md a conversation, pasted whole
  example-<name>.<ext> a screenshot, a competitor link, a spreadsheet they sent
  constraints.md       budget, deadline, platform, legal, "never do X"
  decisions.md         append-only founder decisions (see §5)
  MANIFEST.sha256      the tamper record — written by scripts/founder-intent.mjs
```

**Rules:**

- **Append-only.** Correcting the founder's words is not editing, it is losing the only external
  oracle the team has. A changed mind is a *new* dated entry in `decisions.md`, never an edit.
- **Verbatim.** Summarised intent is interpreted intent, which is the thing being guarded against.
- **Every material scope decision points here.** A goal with no source in this directory is a goal
  the team invented — `trace.mjs` reports it as `goal_no_founder_source`.
- **Thin is a finding, not a pass.** A one-line brief cannot support a PRD; `product-validator`
  returns `INTENT: CANNOT EVALUATE` and says what is missing.

**The tamper check:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs" --write   # record new files (refuses to re-record a changed one)
node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs"           # check: 0 clean · 1 tampered · 2 no record to check
```

`--write` is append-only itself: it adds a line for a new file and **refuses** when a recorded file's
hash has changed, so the record cannot be laundered by re-running the writer.

## 2. The traceability IDs

One convention, extending the existing `[F-NNN]`. Every node **declares** itself with its ID as the
first token on its line, and names its source and its verifier:

```markdown
| [F-004] | Offline export | src: brief.md#L22 · ver: product-validator · state: unverified · rev: 2026-07-29 |
- [AC-011] Given no rows, When export runs, Then it shows the empty state — src: F-004 · ver: T-011
[EV-003] export_completed — src: F-004 · ver: data-analyst · state: no-event-data
```

| Kind | ID | Declared in | `src:` | `ver:` |
|---|---|---|---|---|
| Goal | `G-NNN` | `docs/00-vision.md` | a file under `docs/00-founder-intent/` | founder |
| Outcome | `O-NNN` | `docs/00-vision.md` | `G-NNN` | data-analyst |
| Requirement | `F-NNN` | `docs/10-prd.md` | `O-NNN` | product-validator |
| Story | `S-NNN` | `docs/11-backlog.md` | `F-NNN` | cpo |
| Criterion | `AC-NNN` | `docs/10-prd.md` | `F-NNN` | `T-NNN` |
| Design | `D-NNN` | `docs/12-flows.md` | `F-NNN` | ux-designer |
| Ticket | `APP-NNN` | `docs/31-board.md`, Feature column | `F-NNN` | code-reviewer |
| Code | the branch and commit on the ticket | — | its ticket | code-reviewer |
| Test | `T-NNN` | `docs/50-test-plan.md` | `AC-NNN` | qa-engineer |
| Evidence | `E-NNN` | `docs/50-test-plan.md` | `T-NNN` | verification-engineer |
| Analytics | `EV-NNN` | `docs/52-analytics.md` | `F-NNN` | data-analyst |
| Release | `R-NNN` | `docs/60-releases.md` | the `F-NNN`s it ships | release-manager |

**Declaration vs reference.** The ID is a *declaration* only when it is the first token on the line
or in its table cell. `- APP-001 [F-001] Export` declares `APP-001` and merely *references* `F-001`.
That is what stops the backlog's echo of a requirement counting as a second definition of it.

**Tokens.** `src:` · `ver:` · `state:` · `rev: YYYY-MM-DD`. Comma-separate multiple sources.
Terminate a token with `|` or `·`. `rev:` is the date the node last changed and is what makes stale
coverage visible: a requirement whose `rev:` is later than its tests' is a requirement whose tests
were written against a different requirement.

## 3. The three-state vocabulary, beyond gates

`PASS / FAIL / CANNOT EVALUATE` already governs gates. The same shape governs artifacts, because the
missing third state is exactly how an unexamined artifact reads as a fine one:

| Kind | States | Default when `state:` is absent |
|---|---|---|
| Requirement · Criterion | `satisfied` · `violated` · `unverified` | `unverified` |
| Design | `approved` · `revision-required` · `not-reviewed` | `not-reviewed` |
| Analytics | `observed` · `incorrect` · `no-event-data` | `no-event-data` |

**No artifact is silently fine.** The absent state is never the good one, and a word outside its
column is `state_invalid`, not a near-enough synonym.

## 4. Precedence — how a conflict is resolved, out loud

Two documents disagreeing is normal. A team silently picking one is the defect. Declare a contested
value as a claim, on one line, in each document that asserts it:

```markdown
claim: export-format = CSV
```

`trace.mjs` groups claims by key and resolves by **source precedence**, highest first:

1. **latest founder decision** — `docs/00-founder-intent/`
2. **approved decision record** — a `decision` row in `docs/team/messages.md`
3. **scope-locked PRD** — `docs/10-prd.md`
4. **SRS** — `docs/20-architecture.md`
5. **design** — `docs/12-flows.md`, `docs/13-design-tokens.md`, `docs/14-components.md`
6. **impl notes** — `docs/22-impl-spec-*.md`
7. **agent assumption** — anywhere else

Every conflict produces a **report naming both sides and the rule that resolved it**
(`conflict_resolved`), never a silent choice. Two sides at the same rank cannot be resolved by rule,
so the tool **refuses** (`conflict_unresolvable`) and the disagreement goes to the founder. A
resolved conflict is still a finding: the losing document is wrong and someone has to fix it.

## 5. Conditional founder gates

Scope-lock and ship are the two standing gates. These eight stop the loop as well, whenever they are
detected and no founder decision covers them:

| Trigger | Detected by |
|---|---|
| `pricing` | a price, term or subscription tier asserted in `docs/41-monetization.md` or `docs/10-prd.md` |
| `sensitive-data` | health, biometric, precise-location, contacts, payment-card, government-ID or under-13 collection named in any doc |
| `destructive-migration` | a drop/wipe/destructive-migration instruction in any doc |
| `account-deletion` | account-deletion or erase-all-data behaviour in any doc |
| `legal-disclosure` | a privacy policy, terms, EULA or export-compliance declaration |
| `visual-direction` | `claim: visual-direction = ...` in the design docs |
| `paid-infrastructure` | a paid plan, billing account or per-month cost in `docs/20-architecture.md` |
| `waiver` | any `WAIVED:` line — waiving a failed or unavailable gate is always a founder decision |

A trigger is cleared by an **append-only** line in `docs/00-founder-intent/decisions.md`:

```markdown
2026-07-29 FOUNDER DECISION: pricing — £3.99/month, annual at £29.99. Approved by <founder>.
```

The gate is silent afterwards. It is not cleared by an agent deciding it is fine.

## 6. Running it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --project-root .            # all three sections
node "${CLAUDE_PLUGIN_ROOT}/scripts/trace.mjs" --only trace|conflicts|gates
```

Exit `0` clean · `1` findings · `2` cannot evaluate. `2` is never rounded up to a pass, and the
board is read through `scripts/lib/board.mjs` — one parser, because a second reading of the board is
how the last four fail-open gates got written.
