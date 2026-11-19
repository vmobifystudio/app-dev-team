# board-doctor — manual fallback (no Node) and legacy boards

Loaded from `board-doctor` SKILL.md only when `board-doctor.mjs` cannot be located or run. Say in your output that you checked by hand, so the verdict is never mistaken for a machine-checked one.

## Manual fallback

Read `docs/31-board.md` and check, in this order:

1. Every row has the same cell count as the header.
2. No ticket ID appears twice.
3. Every `Status` is one of the six valid values — optionally suffixed `(static only)`, which is a
   generated marker meaning the ticket's test suite never ran. Read it as the bare status for every
   check below, and as an OPEN item everywhere else: it may reach `qa`, it may not reach `done`.
4. Every `Owner` is non-empty, is a real role, **and is a role `/app-build` actually spawns to work
   a ticket** — `ios-developer`, `android-developer`, `backend-developer`, `monetization-engineer`,
   `ux-architect`, `product-designer`, `product-manager`, `product-researcher`, `qa-engineer`,
   `data-analyst`, `devops-engineer`, `aso-specialist`, `web-developer`, `test-automation-engineer`,
   `verification-engineer`. Never `security-reviewer`, `code-reviewer`, `release-manager`,
   `tech-lead` or `tech-manager`: those gate and coordinate, they do not work tickets, so a ticket
   owned by one is never picked up and never reported.
5. Every ID in `Depends on` has a row; no self-dependency; no cycle.
6. **For every `todo` row, walk its dependencies. If any is `blocked`, the row is `stranded`** —
   report it, because the loop will not.
7. Every `review` row names a Reviewer, and no Reviewer equals its own Owner.
8. Every `qa`/`done` row has an `approved` line in the review ledger.
9. Every `Cycles` is an integer; `>= 2` requires `Status = blocked`.
10. Every ledger row's action is exactly one of `requested` / `started` / `changes` / `approved` /
    `merged`. Anything else is a verdict the checks cannot see — unless a later valid row for the
    same ticket already corrects it.

Report findings in the same shape the script uses (`TICKET  code  detail -> action`) and apply the
same rule: **do not spawn while an anomaly is open.**

## Legacy boards

A board written before the Reviewer/Cycles columns and the review ledger existed cannot answer
review-integrity questions. The doctor detects this and **degrades those checks to warnings** —
structural checks still block. It never refuses to run a project purely for predating this feature.

To migrate, add the two columns and a `## Review ledger` section (see `sprint-planner`). Existing
rows can keep `—` in Reviewer and `0` in Cycles; the ledger starts empty and fills going forward.
