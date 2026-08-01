# /app-incident — record operational incidents

Use the incident ledger for production or release-health events, not a normal ticket completion:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/incident-ledger.mjs" open \
  --severity sev2 --title "..." --owner <role> --by <role>
```

Mitigation and resolution require explicit detail and evidence. The append-only chain preserves
the failure, response, and post-incident record.

**A `sev1`/`sev2` record activates `incident-commander`** (`role-activation`'s conditional trigger)
— spawn it to own coordination, containment, and the resolution decision for the duration of the
incident. It stands down the moment the record is `resolved`; it is not a standing role.
