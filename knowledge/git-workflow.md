# Git Workflow, Versioning & CI

The studio's source-control and release discipline, mined from our internal apps. The flagship
apps converged on this model.

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
  scope = module name. (Used by most internal apps.)
- **`[Module] Imperative description`** — e.g. `[GrowthEngine] Implement WHO percentile calc`,
  optional sprint prefix `[S3][Growth] …`. (Used by some internal flagship apps.)

Reference the ticket/issue ID. One logical change per commit; no unrelated cleanup mixed in.
Use a co-author trailer. This plugin's own merge gate is owned by the `tech-manager` — only it
runs `git merge` on the integration branch.

**Which branch is "the integration branch" is a per-project decision, and it must be recorded in
`docs/23-git-strategy.md` at `/app-init`.** The flagship internal apps integrate on `develop` and
promote to `main` via a release branch; a new single-app project usually integrates on `main`
directly. `tech-manager`'s merge gate reads that doc — it does not assume `main`. Leaving it
unrecorded is how a team ends up with feature branches merged to `main` on a project whose release
process expects `develop`.

## How the studio integrates: slots, waves, one push

The branch model above is unchanged. What changed is **where agents stand** and **when the merges
happen** — the two places the studio was paying per ticket for a signal that is only meaningful per
wave.

| Unit | What it is | Command |
|---|---|---|
| **slot** | one worktree per WRITING AGENT, keyed by owner, bounded by the parallelism cap | `worktree-slot.mjs lease --owner ios-developer --tickets APP-001,APP-002` |
| **branch** | one per ticket, cut inside the slot, unchanged | `git checkout -b feat/APP-001-slug` |
| **gate** | per ticket: a non-owner approval. Passes or refuses; runs no git command | `board.mjs move APP-001 merged --by tech-manager` |
| **wave** | every gated branch merged `--no-ff` into `integration/wave-N`, ONE build, ONE suite | `wave-integrate.mjs --wave 3` |
| **push** | one per wave, fast-forwarding the integration branch | `wave-integrate.mjs --wave 3 --push` |

**Per ticket the studio verifies statically** (`verify-done.sh --static`: branch, commits, changed
files, scope) and records `verified_static` — honest, because the suite genuinely has not run, and
`verified_static` already refuses `closed` and already blocks `ship-gate.sh`. **Per wave it runs the
suite once on the merged tree**, and a green wave earns the real `verified` for every ticket in it.
`verified` was always legal from `qa` for exactly this reason; nothing had ever walked that path.

Keep `fast` per-ticket testing where the scope is genuinely scoped (`:module:test`,
`swift test --filter`) — with warm caches that costs seconds and gives the developer earlier
feedback. Where `fast` is really the whole matrix, it is not a fast scope.

**Toolchain caches live outside every worktree** (`scripts/build-env.sh` → `.studio-cache/`:
`GRADLE_USER_HOME`, `SWIFTPM_CACHE_PATH`, `STUDIO_DERIVED_DATA`). Otherwise each slot, and each
throwaway verification worktree, compiles from cold — and the throwaway ones are deleted, so they
are cold forever. Xcode has no environment variable for DerivedData, so the project's own test
command must pass `-derivedDataPath "$STUDIO_DERIVED_DATA"`; `build-env.sh --check` says per project
whether it does, rather than letting an exported variable stand in for a saving nobody made.

**Conflicts have an owner.** `wave-integrate.mjs` aborts the one merge that conflicted, keeps the
rest of the wave, and names the files. A textual conflict is `tech-manager`'s to resolve in the
integration tree; a conflict that changes behaviour or a contract goes back as a ticket to the owner
of that contract. Re-spawning a developer cold to perform a mechanical rebase buys a full context
rebuild for hunks the manager is already holding.

**Squash-merge remains incompatible with `requireApprovalBinding`**, and the wave branch adds a
second place to get it wrong: `--no-ff` into the wave branch then `--ff-only` onto the integration
branch keeps the approved SHA an ancestor, and a squash anywhere in that chain does not. Record the
choice in `docs/23-git-strategy.md`.

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

**How that sentence is enforced.** `scripts/ci-status.mjs` reads the last completed workflow
conclusion for the integration branch (read-only) at the top of every round; `wave-integrate.mjs
--push` is the only thing that pushes it, so there is one CI run per wave and one reader. Opt-in per
project (`"requireCiGreen": true` in `.studio-policy.json`), waivers pinned to a commit SHA. **No
agent may trigger, re-run or cancel a workflow.** Full argument — why round-start rather than
merge-time, why opt-in, the waiver design — is in `ci-status.mjs`'s own header.

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
