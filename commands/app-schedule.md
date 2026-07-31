# /app-schedule — deterministic dispatch

Validate the current task plan and compute a ready queue:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/scheduler.mjs" --plan "$SCHEDULE_PLAN"
```

Dependencies, priority, wait-cycle fairness, and `max_parallel` capacity determine dispatch. A
full ready queue is not permission to exceed capacity; deferred work is reported as backpressure.
