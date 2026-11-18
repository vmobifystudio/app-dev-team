---
description: Run the deterministic agent evaluation manifest — each case an executable command with expected exit and evidence
argument-hint: [manifest path, default eval/manifest.json]
allowed-tools: Read, Bash
---

# /app-eval — run deterministic agent evaluations

Arguments: $ARGUMENTS — they fill the `<...>` placeholders below; a path argument replaces the
default path shown.

Evaluation manifests define reproducible cases with an executable command, expected exit code, and
required evidence text:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/eval-lab.mjs" --manifest eval/manifest.json
```

Add role, policy, workflow, and long-horizon fixtures as the team grows. A missing manifest or
malformed case is `CANNOT EVALUATE`, never a passing empty suite.
