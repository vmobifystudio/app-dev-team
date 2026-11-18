---
description: Inspect a manager's durable lease before respawning or replacing it — HOLD, FAILOVER or BLOCK
argument-hint: <run id> [--manager tech-manager] [--backup tech-lead]
allowed-tools: Read, Bash
---

# /app-manager-failover — recover manager ownership

Before respawning or replacing a manager, inspect its durable lease:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/manager-failover.mjs" \
  --ledger "$RUN_LEDGER" --run <run-id> --manager tech-manager --backup tech-lead
```

`HOLD` means the primary lease is still active and a second manager must not start. `FAILOVER`
means the lease is absent or expired. `BLOCK` means duplicate active manager attempts require
operator review.
