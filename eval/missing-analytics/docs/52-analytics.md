# Analytics

Consent gate: no event fires before the ATT / consent prompt is answered.

| Event | Feature | Properties | Fires when |
|---|---|---|---|
| `split_completed` | F-001 | party_size, total_cents | the split result is shown |
| `export_started` | F-003 | row_count | the CSV share sheet opens |
