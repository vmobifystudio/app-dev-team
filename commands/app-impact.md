---
description: Map changed files to their declared downstream consumers before merge; unmapped surfaces are findings
argument-hint: <changed files, comma-separated>
allowed-tools: Read, Bash
---

# /app-impact — propagate changed-surface review

Arguments: $ARGUMENTS — they fill the `<...>` placeholders below; a path argument replaces the
default path shown.

Before merge, map every changed file to declared downstream consumers:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/impact-map.mjs" \
  --file "Sources/A.swift,docs/10-prd.md"     # --map <path> overrides the project's default map
```

An unmapped or consumer-less surface is a finding requiring an explicit map update and reviewer
decision.
