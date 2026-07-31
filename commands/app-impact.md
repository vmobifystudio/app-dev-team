# /app-impact — propagate changed-surface review

Before merge, map every changed file to declared downstream consumers:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/impact-map.mjs" \
  --map "$IMPACT_MAP" --file "Sources/A.swift,docs/10-prd.md"
```

An unmapped or consumer-less surface is a finding requiring an explicit map update and reviewer
decision.
