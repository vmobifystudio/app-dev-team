# /app-eval — run deterministic agent evaluations

Evaluation manifests define reproducible cases with an executable command, expected exit code, and
required evidence text:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/eval-lab.mjs" --manifest eval/manifest.json
```

Add role, policy, workflow, and long-horizon fixtures as the team grows. A missing manifest or
malformed case is `CANNOT EVALUATE`, never a passing empty suite.
