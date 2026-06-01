# Git Workflow, Versioning & CI

The studio's source-control and release discipline, mined from all 7 apps. The flagship apps
converged on this model (GPS Map Camera locked it 2026-05-23).

## Branch model

- `main` — protected, production SHAs only, tagged releases. **Never commit directly.**
- `develop` — integration branch (flagship apps). **Never commit directly; never force-push.**
- Short-lived working branches off `develop`, lifetime < 1 week, one logical change each:
  - `feature/<slug>`, `fix/<slug>`, `refactor/<slug>`, `chore/<slug>`
  - `audit/<topic>-<YYYY-MM-DD>` for review/audit passes
  - `sprint/<N>-<name>` or `phase-<N>-<area>` where the team works in numbered sprints/phases
- `release/<version>` → merges into `main` as a merge commit.
- `hotfix/<version>` → from `main`, back into `main` and merged down to `develop`.
- Squash-merge features/fixes; merge-commit releases. Require PR + review + green checks;
  linear history; no force-push to protected branches; signed commits where possible.

## Commit conventions

Two accepted styles (pick one per project, record it in the project `CLAUDE.md`):

- **Conventional Commits:** `type(scope): description` — types `feat|fix|refactor|chore|docs|test|style|perf`,
  scope = module name. (ZipMaker, GPS Camera, both AI Baby apps.)
- **`[Module] Imperative description`** — e.g. `[GrowthEngine] Implement WHO percentile calc`,
  optional sprint prefix `[S3][Growth] …`. (AI Baby iOS.)

Reference the ticket/issue ID. One logical change per commit; no unrelated cleanup mixed in.
Use a co-author trailer. This plugin's own merge gate is owned by the `tech-manager` — only it
runs `git merge` on the integration branch.

## Versioning

- **Android:** `version.properties` with `versionCode = MAJOR*10000 + MINOR*100 + PATCH`
  (monotonic, decodable, CI-overridable). Always bump before a release build. Tag
  `v<X>.<Y>.<Z>+<versionCode>` on the AAB SHA.
- **iOS:** `CFBundleShortVersionString` / `CFBundleVersion` (kept in `project.yml` for XcodeGen
  apps). Tag `vX.Y.Z` on `main` after the release branch is cut.
- Default bump: minor for a feature sprint, patch for a fix-only release, major only on instruction.

## CI

- GitHub Actions. iOS on `macos-15` (XcodeGen generate → resolve packages → unsigned simulator
  build with per-file diagnostics → tests → `swiftlint --strict`); pure-Swift engine
  `swift build && swift test`.
- Android on JDK 17/21 (`./gradlew test assemble<Flavor>Debug`, detekt, ktlint, coverage report).
  Firebase config restored from base64 secrets in CI. Prod-release tasks fail fast on missing secrets.
- A clean build + green tests is a hard merge gate. Flagship apps also require a CTO/code-review
  agent pass (zero Critical + zero Important) before merge.

## Secrets — never in the repo

Never commit: `google-services.json` / `GoogleService-Info.plist`, keystores,
`keystore.properties`, API keys, signing passwords. Inject via env vars or gitignored local files;
fall through to unsigned so CI can still compile. Record signing identities, distribution
channels, and store-account names in the architecture release section (not in code).

## What `/app-init` generates per project

- `CLAUDE.md` (conventions + the chosen commit style + canonical names),
- `.gitignore` for the platform(s),
- `docs/23-git-strategy.md` capturing the branch model and release process above,
- a PR/commit convention note the dev pod is held to.
