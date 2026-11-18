---
description: Create or verify the hashed context manifest an agent is given — git revision, source hashes, omissions
argument-hint: [create | verify] [--ticket APP-NNN] [--role <role>]
allowed-tools: Read, Bash
---

# /app-context — compile and verify execution context

Create a deterministic provenance manifest before an agent starts work:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/context-manifest.mjs" create \
  --root <project> --out "$CONTEXT_MANIFEST" \
  --ticket APP-NNN --role <role> --source constitutional:docs/21-engineering-principles.md \
  --source project:docs/10-prd.md --source ticket:docs/50-test-plan.md
```

The manifest records the git revision, source hashes, explicit omissions, and a rough token
estimate. It is a provenance boundary, not an LLM summary and not permission to read undeclared
secrets. Verify it immediately before an irreversible action:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/context-manifest.mjs" verify \
  --root <project> --manifest "$CONTEXT_MANIFEST"
```

A changed source is `STALE` and must trigger recompilation and renewed review; a moved git HEAD
alone is reported, not refused (`--strict-head` refuses it too). The
layers are ordered constitutional → role → project → ticket → retrieved; lower-precedence material
cannot silently override a higher-precedence rule.
