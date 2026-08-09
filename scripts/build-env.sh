#!/bin/sh
# build-env — put the toolchain's caches OUTSIDE the worktree, so a build is never cold twice.
#
# THE MEASURED PROBLEM (OPS-003, docs/reviews/2026-08-07-adversarial-operations-review.md).
# `verify-done.sh` runs the ticket's test command in one of two places, and both are cold:
#
#   - `.agent-wt/<slot>` — created for this round, never built in before;
#   - a `mktemp -d` detached worktree, which it DELETES in its EXIT trap, so whatever warmed up
#     inside it is thrown away the moment the tests finish.
#
# Nothing pinned DerivedData, the Gradle home or the SwiftPM clone cache anywhere durable, so every
# ticket, every DONE and every retry paid a full cold compile. At the spawn budget's ceiling that is
# SEVEN cold builds for one ticket. The `fast`/`full` scope split (F6) reduces which TESTS run; it
# has never reduced how many times the toolchain warms up, and on a real app the compile dominates.
#
# WHAT THIS DOES AND WHAT IT HONESTLY CANNOT DO — the distinction matters, because a cache that is
# believed to apply and does not is worse than no cache.
#
#   GRADLE_USER_HOME       REAL EFFECT, no cooperation needed. Gradle reads it from the environment;
#                          the dependency cache, the wrapper distribution and the build cache all
#                          move with it. This alone removes the largest repeated cost on Android.
#   SWIFTPM_CACHE_PATH     REAL EFFECT for `swift build` / `swift test`; SwiftPM reads it directly.
#   STUDIO_DERIVED_DATA    ADVISORY. `xcodebuild` has no environment variable for DerivedData — it
#                          takes `-derivedDataPath <path>` on the command line and nothing else. So
#                          this exports the path and the PROJECT'S OWN test command must consume it.
#                          `--check` below reports, per project, whether it does. An exported
#                          variable nobody reads is exactly the "rule that cannot fail" shape this
#                          repository keeps catching itself in, so it is named as advisory here
#                          rather than counted as a saving.
#
# Declare it once in docs/team/project-profile.json, e.g.
#     "test": { "fast": "xcodebuild test -scheme App -derivedDataPath \"$STUDIO_DERIVED_DATA\" ..." }
#
# Usage:
#   . scripts/build-env.sh              source it — exports into the current shell
#   sh scripts/build-env.sh --print     print the exports, for `eval "$(...)"`
#   sh scripts/build-env.sh --check <test-command>
#                                       does that command actually consume the Xcode cache path?
#
# Exit (only meaningful for --check):
#   0  the command consumes $STUDIO_DERIVED_DATA, or the project is not an Xcode project
#   2  it does not — reported as a NOTE, never as a failure. A project may legitimately not care,
#      and this must not be able to stop a round.
#
# The cache root is `.studio-cache/` at the repository top level: inside the repo so it is trivially
# discoverable and trivially deletable, gitignored so it can never be committed, and OUTSIDE every
# `.agent-wt/` worktree so no reaper (`worktree-reap.mjs`) can take it with them.

# NO `set -u` HERE. This file is SOURCED into other scripts, and turning on nounset in the caller's
# shell changes the caller's behaviour from a file it merely wanted an environment from. verify-done
# runs under `set -u` already; that is its choice to make, not this file's.

_studio_cache_root() {
  _r=$(git rev-parse --show-toplevel 2>/dev/null) || _r=$(pwd)
  # A linked worktree must resolve to the MAIN checkout's cache, not its own — otherwise every
  # agent slot gets a private cache and the whole point is lost. --git-common-dir is the signal:
  # in a linked worktree it points at the main repo's .git, in the main one it is that .git.
  _c=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
  if [ -n "$_c" ]; then _r=$(dirname "$_c"); fi
  printf '%s/.studio-cache' "$_r"
}

STUDIO_CACHE=${STUDIO_CACHE:-$(_studio_cache_root)}

# Every variable is set only if the caller has not already set it. An operator or a CI runner that
# has deliberately pointed GRADLE_USER_HOME somewhere must win over a default from a helper.
GRADLE_USER_HOME=${GRADLE_USER_HOME:-$STUDIO_CACHE/gradle}
SWIFTPM_CACHE_PATH=${SWIFTPM_CACHE_PATH:-$STUDIO_CACHE/swiftpm}
STUDIO_DERIVED_DATA=${STUDIO_DERIVED_DATA:-$STUDIO_CACHE/DerivedData}

export STUDIO_CACHE GRADLE_USER_HOME SWIFTPM_CACHE_PATH STUDIO_DERIVED_DATA

# DELIBERATELY NO `mkdir -p`. Gradle, SwiftPM and xcodebuild each create their own cache directory
# on first use, and creating them here would leave an untracked `.studio-cache/` in every project
# this file is merely SOURCED in — including a fixture repo whose whole assertion is that its tree
# is clean. A helper that dirties a tree it was only asked for an environment from is the same
# class of surprise as an agent running `git add -A`.

case "${1:-}" in
  --print)
    echo "export STUDIO_CACHE=\"$STUDIO_CACHE\""
    echo "export GRADLE_USER_HOME=\"$GRADLE_USER_HOME\""
    echo "export SWIFTPM_CACHE_PATH=\"$SWIFTPM_CACHE_PATH\""
    echo "export STUDIO_DERIVED_DATA=\"$STUDIO_DERIVED_DATA\""
    ;;
  --check)
    _cmd=${2:-}
    case "$_cmd" in
      *xcodebuild*)
        case "$_cmd" in
          *STUDIO_DERIVED_DATA*|*-derivedDataPath*)
            echo "build-env: the test command pins DerivedData — Xcode builds are warm across tickets."
            exit 0 ;;
          *)
            echo "build-env: NOTE — this project's test command runs xcodebuild without -derivedDataPath,"
            echo "  so every ticket pays a cold Xcode build even though \$STUDIO_DERIVED_DATA is exported."
            echo "  Add it in docs/team/project-profile.json:"
            echo "    -derivedDataPath \"\$STUDIO_DERIVED_DATA\""
            echo "  This is a NOTE, not a failure: a project may have its own reason."
            exit 2 ;;
        esac ;;
      *) echo "build-env: not an xcodebuild command — GRADLE_USER_HOME/SWIFTPM_CACHE_PATH apply automatically."
         exit 0 ;;
    esac ;;
esac
