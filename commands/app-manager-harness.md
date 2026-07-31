# /app-manager-harness — prove warm/cold manager interchangeability

Run the same persisted-state scenario in both modes:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/manager-harness.mjs" \
  --scenario eval/manager-scenario.json --mode compare
```

`PASS` means a persistent warm manager and a respawned cold manager produce the same state digest.
This validates the portable state contract; it does not claim that a local process is equivalent to
a particular named-agent/SendMessage harness. When such a harness is available, replay this same
scenario through its adapter and retain the result as evidence.
