# Founder intent — the immutable record

Copied into a new project by `/app-init`. Everything in this directory is **the founder's own
material, exactly as received**. Every other document under `docs/` is an interpretation of it.

## What goes here

| File | Contents |
|---|---|
| `brief.md` | the original ask, verbatim and dated. Their words, not a summary of them |
| `transcript-<date>.md` | a conversation, pasted whole |
| `example-<name>.<ext>` | a screenshot, a competitor link, a spreadsheet, a voice-note transcript |
| `constraints.md` | budget, deadline, platform, legal, and every "never do X" |
| `decisions.md` | append-only founder decisions, one dated line each |
| `MANIFEST.sha256` | the tamper record, written by `scripts/founder-intent.mjs` |

## The three rules

1. **Append-only.** A changed mind is a new dated entry in `decisions.md`. Editing the brief to
   match the plan destroys the only external reference this team has.
2. **Verbatim.** Summarised intent is interpreted intent, and interpretation is the thing being
   guarded against.
3. **Recorded.** After adding anything, run the writer. An unrecorded file cannot be shown to be
   unedited, which makes it indistinguishable from one the team wrote itself.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs" --project-root . --write
node "${CLAUDE_PLUGIN_ROOT}/scripts/founder-intent.mjs" --project-root .
```

Exit `0` intact · `1` tampered · `2` nothing recorded to check. `--write` refuses to re-record a
file whose hash changed — a writer that launders the record is not a record.

## Founder decisions

Conditional founder gates (pricing, sensitive data, destructive migration, account deletion, legal
disclosure, visual direction, paid infrastructure, any waiver) are cleared here and nowhere else:

```markdown
2026-07-29 FOUNDER DECISION: pricing — £3.99/month, annual £29.99. Approved by <founder>.
```

`scripts/trace.mjs --only gates` detects each trigger and stays loud until the line exists. An agent
deciding a trigger is fine is not a founder decision.
