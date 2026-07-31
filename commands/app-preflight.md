---
description: Check repository, ticket, dependency, policy, and release context before work begins
argument-hint: [project path] [--ticket APP-NNN]
allowed-tools: Read, Bash, Glob, Grep
---

# /app-preflight — establish context before acting

Run `context-preflight.mjs` first. Then run `dependency-check.mjs` when dependency manifests exist,
`version-consistency-check.mjs` when a release record exists, and `policy-check.mjs` when the project
has `.studio-policy.json`. Exit `1` is a blocker; exit `2` is `CANNOT EVALUATE`, never a pass.

Read the reported branch, ticket, dependency ancestors, architecture, engineering principles, Git
strategy, latest decisions, and unresolved follow-ups before making changes. Return facts, assumptions,
unknowns, and the next safe action separately.
