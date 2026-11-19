# team-protocol — anti-ping-pong guard

Loaded from `team-protocol` SKILL.md when a send is refused, or when you audit a ledger.

Two agents can burn a whole budget agreeing with each other. Hard limits, with **one implementation**
in `${CLAUDE_PLUGIN_ROOT}/scripts/lib/messages.mjs`: `team-message.sh` calls it to refuse the send, `board-doctor` calls it
to audit a log written by hand or migrated around it. Never restate the numbers elsewhere — two
copies disagree.

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
