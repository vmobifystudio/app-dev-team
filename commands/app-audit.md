---
description: Grade an existing app against the Mobify Studio House KB and Axiom standards — fan out the specialist auditors, produce a severity-ranked gap report, build a remediation backlog, then fix (safe fixes automatically, risky changes only with your approval)
argument-hint: [dimension or "all" — e.g. security, monetization, ios, android; default = all]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent
---

# /app-audit — Grade the app, then close the gaps

Dimension (optional, default = all): $ARGUMENTS

## Preconditions

- Requires the as-built baseline from `/app-onboard` (at least `docs/20-architecture.md`). If it's
  missing, run `/app-onboard` first, then continue.
- Invoke `house-conventions` and `brownfield-onboarding` before auditing.

## Steps

1. **Fan out the auditors in parallel** (single message), matched to the detected platform(s). Each
   checks ONE dimension against the House KB pack it owns and returns findings, read-only:
   - **iOS** — spawn the Axiom auditor agents that fit the code: `axiom:concurrency-auditor`,
     `axiom:memory-auditor`, `axiom:security-privacy-scanner`, `axiom:swiftdata-auditor`,
     `axiom:accessibility-auditor`, `axiom:swiftui-performance-analyzer`; plus `code-reviewer`
     grading against `ios-conventions.md`.
   - **Android** — `code-reviewer` against `android-conventions.md` (the five ViewModel patterns,
     Room/DataStore rules, no logic in composables), plus lint/detekt/ktlint results.
   - **Monetization** — `monetization-engineer` vs `monetization.md` (paywall gateway, entitlement
     source of truth, AdGate ordering, NO-AD zones, consent, test-IDs-by-default).
   - **Analytics** — `data-analyst` vs `analytics.md` (consent gate, PII, event coverage of P0 features).
   - **ASO / store** — `aso-specialist` vs `aso.md` (readiness, Data Safety / Privacy Manifest).
   - **DevOps** — `devops-engineer` vs `git-workflow.md` (branch model, CI, signing, secrets hygiene).
   - **Security** — `security-reviewer` (MASVS).
   If a single dimension was named in $ARGUMENTS, run only that one.

2. **Consolidate into `docs/80-audit.md`.** Every finding gets:
   - a severity `S1`–`S4`,
   - the **exact House KB rule it violates** (e.g. "ios-conventions §Concurrency — uses `@Published`"),
   - a **Safe / Risky** tag per the `brownfield-onboarding` classification,
   - a one-line recommended fix.
   Lead with a scorecard: per-dimension pass/gap counts and the top risks.

3. **Build the remediation backlog.** Spawn `tech-manager` to turn findings into `AUDIT-NNN` tickets
   on `docs/31-board.md`, prioritized by severity, each carrying its violated-rule + Safe/Risky tag.
   Risky tickets also get a short written plan and are marked `needs-approval`.

4. **GATE — present the gap summary to the user.** Print the scorecard and the backlog grouped by
   severity and Safe/Risky. Ask which to fix (e.g. "all S1/S2", "safe-only", a specific set). Wait.

5. **Remediate** via the normal `/app-build` loop on the approved tickets:
   - **Safe** tickets are fixed automatically, gated by `code-reviewer` (+ Axiom audits on iOS) and
     the 2-cycle cap.
   - **Risky** tickets execute only after the user approved them at the gate; the developer follows
     the ticket's plan, and migrations/data changes follow the House KB safe-migration rules.

6. **Re-audit.** After the fix wave, offer to re-run `/app-audit` to confirm the gaps closed and
   update `docs/80-audit.md` with the new scorecard.

## Safety

- Auditors are read-only; no code changes happen before the GATE.
- Never auto-perform a Risky change (migration, refactor, concurrency rewrite, billing logic) — it
  requires explicit approval at step 4.
- Surface, don't bury: if a finding is ambiguous, list it as a finding rather than guessing intent.
