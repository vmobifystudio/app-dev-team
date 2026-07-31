# /app-memory — govern durable memory

Agents may propose memory, but only a named reviewer can promote it:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/memory-curator.mjs" propose \
  --class project --content "..." --source docs/90-learnings.md \
  --scope project --confidence 0.8 --by <role>
node "${CLAUDE_PLUGIN_ROOT}/scripts/memory-curator.mjs" review \
  --id MEM-... --reason promote --content "why this is safe" --by <reviewer>
```

Every candidate carries provenance, scope, confidence, expiry, and supersession/contradiction
links. The ledger is append-only; rejected or contradicted memories remain visible for audit.
