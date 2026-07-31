# /app-capabilities — enforce role boundaries

Check a role before granting an operation on a path:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/capability-check.mjs" \
  --manifest "$CAPABILITY_MANIFEST" --role <role> --operation <operation> --path <path>
```

Missing, denied, or out-of-scope capabilities block. The manifest is the allowlist; prose in a
role description cannot expand it.
