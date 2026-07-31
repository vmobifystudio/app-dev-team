---
name: dependency-policy
description: Audit declared dependencies, lockfiles, tool versions, compatibility, licenses, and upgrade evidence before implementation or release.
---

# Dependency policy

Use when a project adds, removes, upgrades, or relies on a package, SDK, compiler, runtime, service,
model, or third-party API. Also use during onboarding, architecture review, and release preparation.

## Procedure

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/dependency-check.mjs" <project-root>`.
2. Read the architecture and stack-defaults documents before choosing a version.
3. Confirm the declaration and lockfile changed together where the ecosystem uses a lockfile.
4. Record direct dependency, purpose, version constraint, transitive risk, license, minimum platform,
   deprecation status, and rollback/removal plan in the ticket evidence.
5. Use the project-pinned toolchain (`gradlew`, `Package.resolved`, lockfile, or equivalent). Never
   silently install a global version to make a check pass.
6. If a dependency is unapproved, unpinned, unlocked, incompatible, or unknown, block or escalate;
   do not “resolve” it by picking the newest version from memory.

## Policy

- Prefer platform-native libraries and the smallest dependency surface.
- A new dependency needs a written reason and an owner.
- A version claim must name its source and date; “latest” is not evidence.
- A failed or unavailable vulnerability/license lookup is `CANNOT EVALUATE`, not a clean result.
- Never update a lockfile without reviewing the resulting transitive diff.
