---
description: Validate the task plan and compute the ready dispatch queue within the scheduler's cap
argument-hint: [schedule plan path]
allowed-tools: Read, Bash
---

# /app-schedule — deterministic dispatch

Arguments: $ARGUMENTS — they fill the `<...>` placeholders below; a path argument replaces the
default path shown.

Validate the current task plan and compute a ready queue:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/scheduler.mjs" --plan docs/team/schedule.json
```

Dependencies, priority, wait-cycle fairness, and the scheduler's cap (`scheduler.mjs cap`) determine dispatch. A
full ready queue is not permission to exceed capacity; deferred work is reported as backpressure.
