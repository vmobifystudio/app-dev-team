# team-protocol §Mid-sprint Q&A — the mechanism that actually answers

Loaded by the `/app-build` orchestrator (step 1b) and by `tech-lead` when spawned with the batch. ICs do not need it. Also here: the orchestrator's routing duty for declared assumptions.

**The orchestrator and `tech-manager` route what was declared.** Every `ASSUMED, NOT RAISED` becomes a real ledger row filed on the agent's behalf, and an item for the role that owns the answer. Nothing is lost because an IC was mid-flow.

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
