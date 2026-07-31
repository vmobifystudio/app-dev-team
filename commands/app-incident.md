# /app-incident — record operational incidents

Use the incident ledger for production or release-health events, not a normal ticket completion:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/incident-ledger.mjs" open \
  --severity sev2 --title "..." --owner <role> --by <role>
```

Mitigation and resolution require explicit detail and evidence. The append-only chain preserves
the failure, response, and post-incident record.
