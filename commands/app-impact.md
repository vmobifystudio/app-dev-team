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

**The map is the project's own, and nothing writes it for you.** No bootstrap creates
the default map (`impact-map.json` in the project's `docs/team/`); without it the script exits `2`
(`no impact map`). Write it once,
commit it, and extend it whenever a finding names an unmapped surface — each rule is a path regex
and the files or roles that consume that surface:

```json
{
  "schema": "impact-map/v1",
  "rules": [
    { "pattern": "^Sources/Models/", "consumers": ["Sources/Persistence/", "Sources/Sync/"] },
    { "pattern": "^Sources/API/", "consumers": ["backend-developer", "Sources/Networking/"] }
  ]
}
```
