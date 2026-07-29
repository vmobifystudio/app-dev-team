# Architecture

## Quota enforcement

The export quota is enforced server-side in `POST /exports`:

```
FREE_TIER_MONTHLY_EXPORTS = 5
```

Client-side counting is advisory only; the server is the authority.
