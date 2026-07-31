# /app-run-status — inspect durable execution state

Use the append-only run ledger and fail-closed orphan detector:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-doctor.mjs" --ledger "$RUN_LEDGER"
```

`CLEAR` means active attempts have valid, unexpired leases and there is at most one active attempt
per run. `ANOMALIES` means stop dispatching and recover or interrupt the named attempt. Missing or
malformed ledgers are `CANNOT EVALUATE`, not a green result.
