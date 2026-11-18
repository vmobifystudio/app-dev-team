---
description: Inspect durable execution state — run-ledger leases and orphaned or duplicate attempts
argument-hint: [run ledger path]
allowed-tools: Read, Bash
---

# /app-run-status — inspect durable execution state

Arguments: $ARGUMENTS — they fill the `<...>` placeholders below; a path argument replaces the
default path shown.

Use the append-only run ledger and fail-closed orphan detector:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/run-doctor.mjs" --ledger docs/team/runs.jsonl
```

`CLEAR` means active attempts have valid, unexpired leases and there is at most one active attempt
per run. `ANOMALIES` means stop dispatching and recover or interrupt the named attempt. Missing or
malformed ledgers are `CANNOT EVALUATE`, not a green result.
