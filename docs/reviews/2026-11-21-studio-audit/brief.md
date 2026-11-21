# Studio audit brief — 2026-11-21 (main f62f5a1)

The plugin (`agents/`, `commands/`, `skills/`, `scripts/`, `hooks/`) is meant to be an autonomous app
studio. A founder gives requirements; the team takes them from intake → PRD → plan → tickets → build →
review → QA → land → ship-ready, the way a real human team works, with **no human intervention except
where a human is legally/physically required** (store submission/upload, signing credentials, money).
The final store submission is human and must NOT be gated or over-specified.

Previous audits fixed mechanics (gates, hooks, board events). This audit asks: **would a real team of
agents actually ship an app with this, efficiently, and get better each time?**

## Rules for every auditor
- READ-ONLY on this repo. Never edit, commit, or create files inside it. Scratch work goes under
  `$TMPDIR/studio-audit-<your-lens>/` (make it; `git init -b main` with a local identity if needed).
- Reproduce before you report: run the script / walk the command text. Cite `file:line`.
- Prior work: `docs/RESUME.md`, register `docs/reviews/2026-11-18-sprint-2.md`, previous audits in
  `docs/reviews/`. Do NOT re-report anything already listed as fixed or as a stated bound unless you
  show it still reproduces on current main.
- Treat over-engineering as a defect: process steps, roles, gates, docs or scripts that cost agent
  time/tokens without catching a real failure should be reported with a "delete/merge/simplify"
  recommendation. Equally report missing pieces a real team would need.
- Severity: High = a real run stalls, needs a human it shouldn't, ships wrong, or wastes most of a run;
  Medium = noticeable friction/waste/quality loss; Low = polish.

## Report format (your final message, nothing else)
`<LENS>-<n> [High|Medium|Low] <title>` then: **Where** (file:line), **What happens** (repro/evidence),
**Why it matters**, **Fix** (smallest concrete change; say "delete" when that is the fix).
End with: top 3 things that most block an autonomous end-to-end ship, and anything you checked and
found genuinely fine (one line each).
