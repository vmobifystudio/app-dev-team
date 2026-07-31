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

A changed source or git revision is `STALE` and must trigger recompilation and renewed review. The
layers are ordered constitutional → role → project → ticket → retrieved; lower-precedence material
cannot silently override a higher-precedence rule.
