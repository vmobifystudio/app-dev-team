# PRD — SplitEven

## §4 Money

- **F-001 (P0)** Split a bill evenly. The platform fee is **2.9% + $0.30**.
- Every displayed amount is rounded to the cent **half-up**: a value of exactly `x.xx5` rounds
  **away from zero**. This is stated because rounding is the only place this app can be wrong,
  and it is wrong silently.
- **F-002 (P0)** Upgrade to Pro removes the platform fee.
