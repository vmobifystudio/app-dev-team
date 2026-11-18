# defect-hunting §4 — findings discipline

Loaded from `defect-hunting` SKILL.md when you own a findings register, an audit, or a sweep. A finding scheduled to nobody is silently skipped: reviewers check what was done, not what was left out.

- Every finding gets a **stable ID** and a row in one register, with a status that is never blank:
  `OPEN` / `IN-PROGRESS` / `FIXED` / `DEFERRED(reason)` / `WRONG-FINDING(evidence)`.
  "Not mentioned" is not a status.
- **A sweep is not done until a rule prevents recurrence.** If an item says *sweep*, *every*, *all*,
  or *class*, fixing the named instance does not close it. It closes when a test would fail if the
  pattern reappeared — and that rule must be proven able to fail (§3).
- **A "not found" claim needs two independent searches** — different tool *and* different pattern
  shape. A stale `© 2025` was recorded as a non-issue because the search looked for the literal
  glyph while the source contained `&copy;`. A live defect was documented as imaginary.
- **`FIXED` is a claim about the integration branch**, not about a branch or a working tree. Verify
  it merged before writing a terminal status.
- Diff the register against the source documents **per cluster**, not once at the end.
