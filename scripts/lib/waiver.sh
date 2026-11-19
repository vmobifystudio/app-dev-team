#!/bin/sh
# waiver — the ONE parser for a `WAIVED:` line in docs/60-releases.md.
#
# Sourced by ship-gate.sh (which sets $RELEASES) and run standalone by lib/readiness.mjs:
#   sh lib/waiver.sh <releases-file> <artifact>   prints "<who> — <reason>", exit 0 when a valid waiver
#                                                 names exactly <artifact>; exit 1 otherwise.
# C5W-1: readiness used to have no waiver reading at all, so a web-app with no browser driver and a
# valid recorded journey waiver stayed CANNOT_EVALUATE forever. A second parser in JS would drift
# from this one; running this one cannot.
#
# canonical_version — the LAST `## vX.Y.Z` heading in docs/60-releases.md (mirrors
# version-consistency-check.mjs's own "last heading wins" rule), or nothing if this project has
# never declared one. Used below to scope a waiver to the release it was actually written for.
canonical_version() {
  [ -f "$RELEASES" ] || return 1
  awk '
    /^##[ \t]+v[0-9]+\.[0-9]+\.[0-9]+/ {
      line = $0
      sub(/^##[ \t]+v/, "", line)
      split(line, a, /[ \t]/)
      v = a[1]
    }
    END { if (v != "") print v; else exit 1 }
  ' "$RELEASES"
}

# waiver_for <artifact> — prints "<who> — <reason>" and returns 0 when a well-formed waiver names
# exactly this artifact; returns 1 otherwise. The separator is the em dash /app-ship writes, with
# `--` accepted as its ASCII spelling. All three fields must be present and non-empty: "WAIVED:
# docs/51-bugs.md" on its own is a record that someone skipped a gate, not a decision anyone can be
# held to, and a waiver nobody signed is indistinguishable from a check that was never there.
#
# SHIP-P0-005 (external audit, 2026-08-01): waivers used to be scanned with no version binding
# whatsoever — an old waiver written for v0.1.0 satisfied a check run against v9.0.0. Reproduced.
# Once a project has declared a canonical version (`## vX.Y.Z` in docs/60-releases.md), a waiver
# must name it as a fourth field to count: `WAIVED: <artifact> — <who> — <reason> — vX.Y.Z`. A
# project that has never declared a version (nothing to bind to yet) keeps the three-field form —
# this is additive, not a breaking change to every waiver ever written.
waiver_for() {
  [ -f "$RELEASES" ] || return 1
  CANON=$(canonical_version 2>/dev/null || true)
  awk -v want="$1" -v canon="$CANON" '
    function trim(s) { sub(/^[ \t]+/, "", s); sub(/[ \t]+$/, "", s); return s }
    /WAIVED:/ {
      line = $0
      sub(/^.*WAIVED:/, "", line)
      gsub(/--/, "—", line)
      n = split(line, f, "—")
      if (n < 3) next
      if (trim(f[1]) != want) next
      who = trim(f[2]); why = trim(f[3])
      if (who == "" || why == "") next
      if (canon != "") {
        if (n < 4) next
        ver = trim(f[4]); sub(/^v/, "", ver)
        if (ver != canon) next
      }
      print who " — " why
      found = 1
      exit
    }
    END { exit (found ? 0 : 1) }
  ' "$RELEASES"
}

case "$0" in
  *waiver.sh) RELEASES=$1; waiver_for "$2" ;;
esac
