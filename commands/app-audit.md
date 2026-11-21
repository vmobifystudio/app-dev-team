---
description: Grade an existing app against the Mobify Studio House KB and Axiom standards — fan out the specialist auditors, produce a severity-ranked gap report, build a remediation backlog, then fix (safe fixes automatically, risky changes only with your approval)
argument-hint: [dimension or "all" — e.g. security, monetization, ios, android; default = all] [--yolo]
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task, Agent, Skill
---

# /app-audit — Grade the app, then close the gaps

Dimension (optional, default = all): $ARGUMENTS

## Preconditions

- Requires the as-built baseline from `/app-onboard` (at least `docs/20-architecture.md`). If it's
  missing, run `/app-onboard` first, then continue.
- Invoke `house-conventions` and `brownfield-onboarding` before auditing.

## Steps

1. **Fan out the auditors in parallel** (single message), matched to the detected platform(s). Each
   checks ONE dimension against the House KB pack it owns and returns findings, read-only. Tell every
   code-reading auditor to run the `defect-hunting` skill (§1 data paths, §2 execute constants)
   first — a screen-by-screen read misses the second writer:
   - **iOS** — `code-reviewer` grading against `ios-conventions.md`, always. The `axiom:*` auditors
     are **external and optional** (separate plugin, not this one's `skills/`) and are listed in
     exactly one place: the canonical auditor list in `agents/code-reviewer.md`. Read the roster and
     the detect-else-degrade rule there — do not re-list them here, because the copy that drifts is
     always the one nobody is looking at.

     **State which auditors ran and which dimensions fell back, in the scorecard.** Never skip a
     dimension silently: an unaudited dimension that prints no findings is indistinguishable from a
     clean one, and it is the scorecard the user makes the ship decision on.
   - **Android** — `code-reviewer` against `android-conventions.md` (the five ViewModel patterns,
     Room/DataStore rules, no logic in composables), plus lint/detekt/ktlint results.
   - **Monetization** — `monetization-engineer` vs `monetization.md` (paywall gateway, entitlement
     source of truth, AdGate ordering, NO-AD zones, consent, test-IDs-by-default).
   - **Analytics** — `data-analyst` vs `analytics.md` (consent gate, PII, event coverage of P0 features).
   - **ASO / store** — `aso-specialist` vs `aso.md` (readiness, Data Safety / Privacy Manifest).
   - **DevOps** — `devops-engineer` vs `git-workflow.md` (branch model, CI, signing, secrets hygiene).
   - **Security** — `security-reviewer` (MASVS).
   If a single dimension was named in $ARGUMENTS, run only that one.

1a. **Verify the findings before you believe them.** Spawn `verification-engineer` over the
   returned findings. An audit finding is a claim produced by the same agent that went looking for
   it, and the two most expensive kinds of wrong finding are invisible to re-reading:
   - a **mis-calibrated constant** reported as fine because it reads fine (execute it across its
     range against outside reference data), and
   - a **rule reported as present and working** that cannot actually fail (`contains()` over prose
     finds its own comments — ten of nineteen real guard rules were bypassable this way).

   Findings it cannot reproduce are marked `WRONG-FINDING(evidence)`, not silently dropped.

2. **Consolidate into `docs/80-audit.md`.** Every finding gets:
   - a severity `S1`–`S4`,
   - the **exact House KB rule it violates** (e.g. "ios-conventions §Concurrency — uses `@Published`"),
   - a **Safe / Risky** tag per the `brownfield-onboarding` classification,
   - a one-line recommended fix.
   Lead with a scorecard: per-dimension pass/gap counts and the top risks.

2a. **Open the findings register — `docs/81-findings.md`.** The moment a finding is recorded it
   gets a **stable ID** and a row:

   ```
   | ID | Source | Severity | One-line description | Status | Closing commit |
   ```

   `Status` is one of `OPEN` / `IN-PROGRESS` / `FIXED` / `DEFERRED(reason)` /
   `WRONG-FINDING(evidence)`. **Never blank, and "not mentioned" is not a status.**

   This exists because prose findings scattered across documents cannot be diffed. In a real
   programme ~150 findings produced a plan that claimed to contain them all, and roughly **70 were
   never scheduled, deferred, or even contradicted** — four review rounds missed it, because
   reviewers check what was done, not what was left out.

   **Record every finding in the machine register too** — `ship-gate.sh` reads
   `docs/90-register.jsonl`, never this Markdown table, so a finding written only here was invisible
   to the one gate that blocks a release on an open S1/S2:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/register.mjs" add <ID> --kind finding --severity S1..S4 \
     --title "<one-line description>" --by <the role that found it>
   ```

   When step 3 files the ticket, `register.mjs link <ID> --ticket AUDIT-NNN --by tech-manager`.

3. **Build the remediation backlog.** Spawn `tech-manager` to turn findings into `AUDIT-NNN` tickets
   through the board CLI — one `board.mjs add` per ticket, appended to the event log
   `docs/31-board-events.jsonl`; never a hand-written row in the rendered board view (it is
   regenerated from the log) — prioritized by severity, each carrying its violated-rule +
   Safe/Risky tag in `--notes`.

   **First, the risk policy.** `board.mjs add` derives each ticket's risk from `--file` against
   `docs/team/risk-policy.json`; with no policy, or no `--file`, the ticket is stored `risk: null`
   and its high-risk invariant check never applies. On an existing app `/app-plan` 1b has not run
   yet, so bootstrap the manifests here (exit `1` "already exist" means they are there — continue):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/team-bootstrap.mjs" --root .
   ```

   Then add each ticket with the file(s) its fix touches (comma-separated):

   ```bash
   # Safe
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add AUDIT-NNN --title "..." --owner <role> \
     --file "<path/the/fix/touches>" --notes "rule: <violated rule> · Safe" --by tech-manager
   # Risky — born blocked, so nothing can claim it until the founder approves it
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" add AUDIT-NNN --title "..." --owner <role> \
     --file "<path/the/fix/touches>" \
     --notes "rule: <violated rule> · Risky · plan: <the short written plan>" \
     --status blocked --reason "needs-approval: Risky change, awaiting the founder at step 4" \
     --by tech-manager
   ```

   `needs-approval` is that `blocked` state, not a label: a `blocked` ticket cannot be `claimed`, so
   no developer starts a Risky change by accident.

   **Owner must be a role `/app-build` can spawn.** The roster is in `board-doctor`'s
   Manual-fallback check 4 — read it there, never from a copy. The copy that used to live in this
   step had already dropped the designers and `qa-engineer`, which are the natural owners of this
   command's own Safe-fix class (accessibility labels, Dynamic Type, touch targets, design tokens,
   test-plan gaps), so those remediation tickets were filed to nobody. Never `security-reviewer` or
   any other gating role: it *finds* the gap, it does not work the ticket, and the board doctor
   rejects it as `owner_not_spawnable`.

   A finding with no ticket stays `OPEN` in the register. A ticket with no finding is a scope leak.

4. **GATE — present the gap summary to the user.** Print the scorecard and the backlog grouped by
   severity and Safe/Risky. Ask which to fix (e.g. "all S1/S2", "safe-only", a specific set). Wait.

   For every Risky ticket the user approves, record it and release it:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" move AUDIT-NNN unblocked --by tech-manager \
     --detail "approved by the founder at the /app-audit gate, <date>" --token <tech-manager token>
   ```
   Releasing a `needs-approval:` block is a gate event (S7-2): only tech-manager or founder, and under
   `requireActorTokens` with that role's token — a worker's `unblocked` on it is refused.

   A Risky ticket the user did not approve stays `blocked` with its `needs-approval:` reason.

   **`--yolo` (passed through from `/app-run --yolo`) — the defer mechanism.** No question is asked,
   and the answer is fixed: **approve every Safe ticket and every Risky S1/S2 whose plan `tech-lead`
   (or `cto`) approves; only a migration that deletes user data and a pricing change stay
   `needs-approval:` / DEFERRED.** Concretely:
   - Safe tickets were born `todo` at step 3, so they are already claimable — step 5 fixes them.
   - Risky tickets were born `blocked` with `--reason "needs-approval: ..."`. A Risky S1/S2 whose
     written plan `tech-lead` approves gets `unblocked` by the orchestrator (inline tech-manager
     token). The rest get no `unblocked` event, so none can be `claimed` — deferral is the board
     refusing the claim, not an agent remembering not to.
   - List the deferred set from the log (never from memory) and print it in the summary as
     `DEFERRED (needs-approval): <ID> <title>`, one per line, plus the same in `docs/80-audit.md`:

     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs" show --json | node -e '
       const b = JSON.parse(require("fs").readFileSync(0, "utf8"));
       for (const t of Object.values(b.tickets))
         if (t.status === "blocked" && /· Risky/.test(t.notes || "")) console.log(`DEFERRED (needs-approval): ${t.id} ${t.title || ""}`);'
     ```
   - Their register rows become `DEFERRED(needs-approval)` — a terminal status for step 6, so the
     re-audit loop ends instead of waiting on an approval nobody was asked for. Releasing one later
     is the founder's `unblocked` event above, on a later run.

   This is `/app-run`'s Gate 1 for a brownfield project. **When `/app-audit` was invoked by
   `/app-run`, `/app-run` owns the gate — print the summary and return it rather than asking, so
   the user approves scope once.** Invoked directly, ask here.

5. **Remediate** via the normal `/app-build` loop on the approved tickets:
   - **Safe** tickets are fixed automatically, gated by `code-reviewer` (+ Axiom audits on iOS) and
     the 2-cycle cap.
   - **Risky** tickets execute only after the user approved them at the gate (the `unblocked` event
     above); the developer follows
     the ticket's plan, and migrations/data changes follow the House KB safe-migration rules.

6. **Close the register, then re-audit.** Diff `docs/81-findings.md` against `docs/80-audit.md`
   and assert **every finding appears exactly once with a terminal status**. Any row still `OPEN`
   or `IN-PROGRESS` is named in the summary — a cluster is not done because the reviewer found
   nothing new this round; it is done when the register is closed.

   A finding whose fix was a *sweep* ("every", "all", "class of") does **not** close by fixing the
   named instance. It closes when a test, lint rule, or CI check would fail if the pattern
   reappeared — and `verification-engineer` has watched that check fail once.

   Then re-run `/app-audit` to confirm the gaps closed and update `docs/80-audit.md` with the new
   scorecard — over the dimensions that had findings, and **at most twice.**

   Exit the re-audit loop on the first of these, and say which one ended it:
   - the register is closed (every row terminal), or
   - a re-audit pass adds no new `S1`/`S2` finding, or
   - the second re-audit completes.

   Then stop and report what is still open, with the finding counts per round. Three passes that
   keep turning up new S1s is a scope decision for the user, not a loop to keep running — and this
   was the only unbounded loop in the plugin, next to `/app-build`'s 2-cycle cap and 6-retry spawn
   budget.

## Safety

- Auditors are read-only; no code changes happen before the GATE.
- Never auto-perform a Risky change (migration, refactor, concurrency rewrite, billing logic) — it
  requires explicit approval at step 4.
- Surface, don't bury: if a finding is ambiguous, list it as a finding rather than guessing intent.
