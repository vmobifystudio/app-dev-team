# /app-recover — recover an interrupted run

1. Run `/app-run-status` and identify the run and attempt.
2. Inspect its last checkpoint and pending side effects in the configured run ledger (`$RUN_LEDGER`).
3. Do not start a new attempt while the old lease is active. If the work is abandoned, append an
   explicit terminal record with `run-ledger.mjs ... abandon --detail <reason>`.
4. Start a replacement attempt only after the old attempt is terminal, carrying forward the same
   ticket and a fresh context manifest.

The ledger is append-only. Never edit or re-anchor it by hand; a broken chain is evidence requiring
version-control recovery and operator review.
