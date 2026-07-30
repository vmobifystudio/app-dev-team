---
name: database-migration
description: Use before changing any persisted schema — by backend-developer on a server store, by web-developer on a client or server store, and by reliability-engineer when reviewing a change that migrates data. Triggers on the first column, field, index or model change, not on the deploy.
---

# Database migration

A migration is the one change that **cannot be rolled back by reverting the commit**. Code reverts;
data that has already moved does not. Treat every migration as one-way until you have proven
otherwise.

Where a platform skill exists, use it — `axiom-database-migration`, `axiom-swiftdata-migration`, or
the auditor for your store. **External and optional**; missing → follow this file.

## Before you write it

1. **Enumerate every writer and every reader of the affected data** (`defect-hunting` §1). The
   migration that stops one layer short is FC-001, and this is the surface where it costs most.
2. **Name the old and new shape explicitly**, including what happens to rows that violate the new
   constraint *today*. There are always some.
3. **Decide expand or contract.** Almost always expand first:
   - *Expand*: add the new column nullable, write both, backfill, read new with fallback to old.
   - *Contract*: only after every deployed client and server writes the new shape. On mobile that
     means **after the oldest supported app version is gone**, which is months, not the next sprint.
4. **Say how you roll back.** If the answer is "restore a backup", say that explicitly — it is a
   real answer, and it changes the deploy plan.

## Writing it

- **Forward-only, versioned, and ordered.** Never edit a migration that has run anywhere.
- **Idempotent**: safe to run twice, because it will be.
- **Transactional** where the engine allows it, and where it does not (many `ALTER TABLE` paths),
  say so and make each step independently safe.
- **Never `DROP` in the same release that stops using the column.** Two releases, minimum.
- **Backfill in batches** with a bound, not in one statement that locks the table.
- **A `NOT NULL` column gets a default or a backfill in the same migration** — this is the single
  most common way a migration fails in production and not in dev.

## Proving it

- Run it against **a copy of real-shaped data with the awkward rows in it** — nulls, duplicates,
  the pre-unicode row, the one from the first version. A migration tested only on a fresh database
  has been tested on the one case that never occurs.
- Run it **twice** and confirm the second run is a no-op.
- Run the **previous** application version against the migrated schema. During any rollout both
  exist at once, and this is the check that catches it.
- Count rows before and after, and state both. "It seemed to work" is not a result.

## Output

The migration file, plus in the ticket: old shape, new shape, expand-or-contract, rollback plan, row
counts before and after, and the awkward-data cases you ran it against.
