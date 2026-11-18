---
description: Route a change by blast radius — the risk tier, model tier, approvers and evidence it requires
argument-hint: <changed file> [short change description]
allowed-tools: Read, Bash
---

# /app-risk — route by blast radius

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/risk-router.mjs" \
  --policy "$RISK_POLICY" --file <changed-file> --change <short-description>
```

The highest matching risk wins. The result names model tier, approvers, and required evidence;
agents cannot lower the route by choosing a cheaper model themselves.
