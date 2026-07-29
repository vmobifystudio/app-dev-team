---
name: performance-review
description: Use as a review dimension on any diff that could cost startup time, frames, memory, battery, bandwidth or bundle size — by code-reviewer during review and by web-developer and test-automation-engineer before claiming a UI or harness ticket done. The studio's position is that this is a dimension with existing auditors behind it, not a standing role.
---

# Performance review

Performance is a budget, and a budget only exists if something can exceed it. The budgets live in
`docs/20-architecture.md` §8; if that section is empty, that is the finding.

Spawn the platform auditor first and fold its findings in — `axiom:swiftui-performance-analyzer`,
`axiom:swift-performance-analyzer`, `axiom:memory-auditor`, `axiom:energy-auditor` on Apple
platforms. **All external and optional** (separate plugins) — missing → record
`N/A: <tool> — not installed`, walk the list below by hand, never file the absence as a defect.

## Measure, then read the diff

**A performance finding with no number is an opinion.** Every finding names: the metric, the value,
the budget it is measured against, the device or environment, and the build. Where you could not
measure, the verdict is `CANNOT EVALUATE` — not a guess dressed as a warning.

## The dimensions

| Dimension | Budget it spends | What to look for in a diff |
|---|---|---|
| Startup | cold launch to first interaction | work moved into app init, eager singletons, sync I/O on the launch path |
| Frames | 60/120fps, jank-free scroll | layout or allocation per frame, unbounded list without recycling, expensive work in a view body |
| Memory | peak and steady-state | full-size images held, unbounded caches, retain cycles, accumulating observers |
| Battery / energy | background and foreground drain | polling instead of push, wake locks, continuous location, timers that never stop |
| Network | bytes and round trips | N+1 requests, no pagination, no caching headers, retry without backoff |
| Storage | disk footprint and write amplification | writing on every keystroke, unbounded logs, no eviction policy |
| Bundle / binary | download size | a whole library imported for one function, unsplit routes, uncompressed assets |

## The rules

- **Measure before optimising, and measure the thing users feel.** A 40% faster function on a path
  that runs once at midnight is not a result.
- **Regressions are found by comparing to a baseline**, so record the baseline value in the ticket.
  No baseline, no regression detection — that is how these arrive silently.
- **A cache is a correctness decision**, not a performance one. Every cache added must state its
  invalidation rule; an unstated one is a stale-data defect waiting.
- **Never optimise by removing a bound.** Widening a page size, dropping a limit or removing a
  timeout trades a slow path for an unbounded one.

## Verdict

```
PERFORMANCE: PASS | PASS WITH NOTES | FAIL — <metric> <value> vs budget <value> on <device/build>
```

Exceeding a stated budget is a `FAIL` and a blocker to raise — not a number to quietly move.
