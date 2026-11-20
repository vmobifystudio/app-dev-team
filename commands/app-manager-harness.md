---
description: Prove a warm (persistent) and a cold (respawned) manager reach the same state digest on one scenario
argument-hint: [scenario path, default ${CLAUDE_PLUGIN_ROOT}/eval/manager-scenario.json]
allowed-tools: Read, Bash
---

# /app-manager-harness — prove warm/cold manager interchangeability

Arguments: $ARGUMENTS — they fill the `<...>` placeholders below; a path argument replaces the
default path shown.

Run the same persisted-state scenario in both modes:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/manager-harness.mjs" \
  --scenario "${CLAUDE_PLUGIN_ROOT}/eval/manager-scenario.json" --mode compare
```

`PASS` means a persistent warm manager and a respawned cold manager produce the same state digest.
This validates the portable state contract; it does not claim that a local process is equivalent to
a particular named-agent/SendMessage harness. When such a harness is available, replay this same
scenario through its adapter and retain the result as evidence.
