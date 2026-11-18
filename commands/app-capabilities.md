---
description: Check whether a role may perform an operation on a path, against the capability manifest (the allowlist)
argument-hint: <role> <operation> <path>
allowed-tools: Read, Bash
---

# /app-capabilities — enforce role boundaries

Arguments: $ARGUMENTS — they fill the `<...>` placeholders below; a path argument replaces the
default path shown.

Check a role before granting an operation on a path:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/capability-check.mjs" \
  --manifest docs/team/capabilities.json --role <role> --operation <operation> --path <path>
```

Missing, denied, or out-of-scope capabilities block. The manifest is the allowlist; prose in a
role description cannot expand it.
