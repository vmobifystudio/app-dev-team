#!/bin/sh
# runtime-gate — build the app and launch it. The only gate in this plugin that runs the artifact.
#
# Every other gate here verifies that the PROCESS was followed. verify-done.sh checks the branch
# exists and the test command exited zero. board-doctor checks the board is coherent. ship-gate
# checks nothing is in flight and no S1/S2 is open. code-reviewer checks the diff reads correctly.
# A sprint can run green through all four on an app that does not compile in Xcode, does not launch,
# or launches to a blank screen — because nothing ever ran it.
#
# This is `defect-hunting` §2 ("never certify by reading — execute it") pointed at the app itself.
# The team already knows reading is not verifying; it had just never aimed that instinct here.
#
# Usage:  sh scripts/runtime-gate.sh [--platform ios|android|auto] [--project-root <path>]
#
# Exit:   0 PASS            — the app built, launched, AND was still running afterwards
#         1 FAIL            — it did not build, or did not launch
#         2 CANNOT EVALUATE — the toolchain needed is not on this machine, so it was never run
#
# EXIT 2 IS THE WHOLE DESIGN. A box without Xcode is a normal, expected state — a CI runner, a Linux
# dev machine, an Android-only project. It is not an error. It is emphatically not a pass, and there
# is no path from a check that did not run to exit 0. Every exit-2 path prints what was missing and
# what would make it evaluable, on STDOUT, because /app-build and /app-ship surface that text
# verbatim; a bare exit 2 with the reason on stderr gives them nothing to show.
#
# Timeouts are stated, not implicit. A hung simulator produces CANNOT EVALUATE, never an infinite
# wait — a gate that hangs is a gate that gets removed.

set -u

PLATFORM=auto
ROOT=.
# Overridable by env so the timeout branch is testable in seconds instead of in a quarter of an
# hour. An untestable branch is an unverified branch, and this one's whole job is to turn a hang
# into a stated CANNOT EVALUATE.
BUILD_TIMEOUT=${RUNTIME_GATE_BUILD_TIMEOUT:-900}    # 15 min — cold SPM resolve plus a clean build
BOOT_TIMEOUT=${RUNTIME_GATE_BOOT_TIMEOUT:-180}      # 3 min  — first boot of a cold simulator runtime
LAUNCH_TIMEOUT=${RUNTIME_GATE_LAUNCH_TIMEOUT:-60}   # 1 min  — install + launch on a booted device

# `shift 2` with only one argument left is a FAILURE in POSIX sh — it does not shift, so `$1` is
# still the flag and this loop spins forever writing nothing. `sh runtime-gate.sh --project-root`
# hung indefinitely. A gate that hangs is a gate that gets removed, which is the same header comment
# the timeout logic below was written under; the argument parser had never been held to it.
need_value() {
  [ "$1" -ge 2 ] || { echo "runtime-gate: $2 needs a value" >&2; exit 2; }
}

# Which Xcode scheme ships. Empty means "infer", which only succeeds when the project has exactly
# one shared scheme; anything ambiguous is CANNOT EVALUATE rather than a guess.
SCHEME_OPT=${SCHEME_OPT:-}

while [ $# -gt 0 ]; do
  case "$1" in
    --platform)     need_value $# "--platform";     PLATFORM=${2:-}; shift 2 ;;
    --project-root) need_value $# "--project-root"; ROOT=${2:-}; shift 2 ;;
    --scheme)       need_value $# "--scheme";       SCHEME_OPT=${2:-}; shift 2 ;;
    -h|--help)      sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "runtime-gate: unknown argument '$1'" >&2
       echo "usage: runtime-gate.sh [--platform ios|android|auto] [--project-root <path>] [--scheme <name>]" >&2
       exit 2 ;;
  esac
done

case "$PLATFORM" in
  ios|android|auto) ;;
  *) echo "runtime-gate: --platform must be ios, android or auto (got '$PLATFORM')" >&2; exit 2 ;;
esac

[ -d "$ROOT" ] || { echo "runtime-gate: no such directory: $ROOT" >&2; exit 2; }
ROOT=$(cd "$ROOT" && pwd)

DATE=$(date +%F)
EVIDENCE="$ROOT/docs/evidence"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT INT TERM

LINES=""
WORST=0   # 0 pass · 1 fail · 2 cannot evaluate
pass()    { LINES="${LINES}  $1  PASS     $2
"; }
fail()    { LINES="${LINES}  $1  FAIL     $2
"; WORST=1; }                                       # FAIL always wins — see the verdict block
unknown() { LINES="${LINES}  $1  UNKNOWN  $2
"; [ "$WORST" -eq 0 ] && WORST=2; return 0; }       # UNKNOWN only upgrades a PASS
#
# These two guards were first written as `[ "$WORST" -le 1 ] && WORST=1` / `[ "$WORST" -eq 0 ] &&
# WORST=2`, which made the ranking depend on the order the platforms happened to run in: iOS
# UNKNOWN then Android FAIL came out as CANNOT EVALUATE, because 2 is not `-le 1`. The comment in
# the verdict block asserted the opposite and read perfectly. Caught only by running a tree with a
# broken Android build and no Xcode and looking at the exit code — `defect-hunting` §2, on a gate
# written to enforce §2.

# Print the tail of a build log under a FAIL. verify-done.sh shipped a bug where it discarded test
# output while instructing the loop to "re-spawn the developer with these failures verbatim" — an
# instruction that cannot be followed is the same defect class as a gate that cannot fail. The
# compiler already said exactly what is wrong; the only job here is not to throw it away.
LOGTAIL=""
keep_log() {
  [ -s "$1" ] || return 0
  LOGTAIL="${LOGTAIL}
Last 40 lines of $2:
$(tail -n 40 "$1" | sed 's/^/  | /')
"
}

# run_capped <seconds> <logfile> <command...> — returns the command's status, or 124 on timeout.
#
# ponytail: crude 1-second poll and `kill -TERM` on the direct child only. A build tool that forks
# (xcodebuild spawning swift-frontend, gradle spawning a daemon) can outlive the kill and keep a
# core busy until it finishes on its own. The gate itself still returns in bounded time, which is
# the property that matters here. Upgrade to a process group (`set -m` + `kill -- -$pid`) if an
# orphaned toolchain process is ever observed in CI.
run_capped() {
  secs=$1; log=$2; shift 2
  "$@" >"$log" 2>&1 &
  pid=$!
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$secs" ]; then
      kill -TERM "$pid" 2>/dev/null
      sleep 2
      kill -KILL "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
}

# --- is it STILL running? --------------------------------------------------------------------
# `xcrun simctl launch` returns 0 as soon as the process has been forked, and `adb shell monkey`
# returns 0 once it has injected the events. An app that crashes 200ms later exits both with status
# 0 — so this gate slept 3s, took a screenshot of a dead simulator, and printed RESULT: PASS on
# exactly the crash-on-launch its own header claims to catch. /app-ship then quotes that screenshot
# as evidence. Spawning is not running: after the settle, go and look for the process.
#
# Two one-liners on purpose. Each is a single command whose exit status is the entire contract, so
# it can be exercised against a stub `xcrun`/`adb` on PATH without a toolchain (scripts/test.sh
# extracts and runs them that way).
ios_running()     { xcrun simctl spawn "$1" launchctl list 2>/dev/null | grep -q "$2"; }
android_running() { [ -n "$(adb -s "$1" shell pidof "$2" 2>/dev/null | tr -d '\r\n ')" ]; }

# --- what kind of project is this? ---------------------------------------------------------------
# Depth-limited so a vendored sample project six levels down inside a dependency does not decide
# what this repo is. Both found is normal (a cross-platform repo) — run both and combine.
found() { find "$ROOT" -maxdepth 3 -name "$1" -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -n 1; }

XCPROJ=$(found '*.xcworkspace'); [ -n "$XCPROJ" ] || XCPROJ=$(found '*.xcodeproj')
SWIFTPKG=$(found 'Package.swift')
GRADLE=$(found 'build.gradle'); [ -n "$GRADLE" ] || GRADLE=$(found 'build.gradle.kts')
[ -n "$GRADLE" ] || GRADLE=$(found 'settings.gradle'); [ -n "$GRADLE" ] || GRADLE=$(found 'settings.gradle.kts')

HAS_IOS=0; { [ -n "$XCPROJ" ] || [ -n "$SWIFTPKG" ]; } && HAS_IOS=1
HAS_ANDROID=0; [ -n "$GRADLE" ] && HAS_ANDROID=1

[ "$PLATFORM" = "android" ] && HAS_IOS=0
[ "$PLATFORM" = "ios" ] && HAS_ANDROID=0

if [ "$HAS_IOS" -eq 0 ] && [ "$HAS_ANDROID" -eq 0 ]; then
  echo "RUNTIME GATE"
  echo "  -        UNKNOWN  no iOS or Android project found under $ROOT (searched 3 levels for"
  echo "                    *.xcworkspace, *.xcodeproj, Package.swift, build.gradle[.kts],"
  echo "                    settings.gradle[.kts])."
  [ "$PLATFORM" != "auto" ] && echo "                    --platform $PLATFORM was requested, which excluded the other platform."
  echo "                    Point --project-root at the app repository, or drop --platform."
  echo
  echo "RESULT: CANNOT EVALUATE — this is NOT a pass. The app was never built or launched."
  exit 2
fi

# --- iOS -----------------------------------------------------------------------------------------
ios_gate() {
  # `command -v xcodebuild` is NOT the check. On a machine with only the Command Line Tools the
  # binary is present at /usr/bin/xcodebuild and every invocation fails with "requires Xcode, but
  # active developer directory is a command line tools instance". Observed on the machine this was
  # written on. Gate on the exit status of the thing you are about to use, never on its existence.
  if ! xcodebuild -version >"$WORK/xcv" 2>&1; then
    unknown "ios    " "xcodebuild is unusable here: $(head -n 1 "$WORK/xcv" | cut -c1-100)
                    Install Xcode and run: sudo xcode-select -s /Applications/Xcode.app"
    return
  fi

  APPDIR="$WORK/dd"
  if [ -n "$XCPROJ" ]; then
    case "$XCPROJ" in *.xcworkspace) CONTAINER="-workspace" ;; *) CONTAINER="-project" ;; esac

    # Scheme selection must never be a guess. Taking the first scheme `xcodebuild -list` prints is
    # alphabetical, not meaningful: a project with Demo/Extension/Framework/MyApp schemes silently
    # builds "Demo", and if Demo happens to launch, the gate returns PASS with a screenshot of an
    # app that is not the one being released. That is a false PASS on the wrong artifact — the
    # worst outcome this gate can produce, worse than any FAIL.
    SCHEMES=$(xcodebuild "$CONTAINER" "$XCPROJ" -list 2>/dev/null \
              | awk '/Schemes:/{f=1;next} f && NF {gsub(/^ +| +$/,""); print} f && !NF {exit}')
    SCHEME_COUNT=$(printf '%s\n' "$SCHEMES" | grep -c . || true)

    if [ "${SCHEME_COUNT:-0}" -eq 0 ]; then
      unknown "ios    " "no shared scheme in $(basename "$XCPROJ") — xcodebuild cannot pick a target.
                    Mark a scheme Shared in Xcode (Product > Scheme > Manage Schemes) and commit it."
      return
    fi

    if [ -n "$SCHEME_OPT" ]; then
      # Explicitly requested: honour it, but only if it exists.
      # -F, not just -x: without it the scheme name is a REGEX, so `--scheme '.*'` matched every
      # line and the gate accepted a scheme that does not exist — then built whatever xcodebuild
      # picked. A false PASS on the wrong artifact is the worst outcome this gate can produce, and
      # this is the check written to prevent exactly that.
      if ! printf '%s\n' "$SCHEMES" | grep -qxF -- "$SCHEME_OPT"; then
        unknown "ios    " "--scheme '$SCHEME_OPT' is not a shared scheme of $(basename "$XCPROJ").
                    Available: $(printf '%s' "$SCHEMES" | tr '\n' ' ')"
        return
      fi
      SCHEME="$SCHEME_OPT"
    elif [ "$SCHEME_COUNT" -eq 1 ]; then
      SCHEME=$SCHEMES
    else
      unknown "ios    " "$(basename "$XCPROJ") has $SCHEME_COUNT shared schemes and none was named, so
                    which one ships is ambiguous. Picking the first would risk PASSing on a demo
                    target or an extension instead of the app. Re-run with --scheme <name>, or
                    record the release scheme in docs/20-architecture.md.
                    Available: $(printf '%s' "$SCHEMES" | tr '\n' ' ')"
      return
    fi

    # `generic/platform=iOS Simulator` compiles without booting anything, so a broken simulator
    # runtime cannot masquerade as a compile failure. Booting is the next step's problem.
    run_capped "$BUILD_TIMEOUT" "$WORK/ios.log" \
      xcodebuild "$CONTAINER" "$XCPROJ" -scheme "$SCHEME" -configuration Debug \
        -destination 'generic/platform=iOS Simulator' -derivedDataPath "$APPDIR" build
    RC=$?
  elif [ -n "$SWIFTPKG" ]; then
    # Path as a positional argument, never interpolated into the script text — same fix, same
    # reason as the gradle branch below. A directory name containing a quote closed the quoting and
    # ran the remainder as shell, and --project-root is agent-supplied.
    run_capped "$BUILD_TIMEOUT" "$WORK/ios.log" \
      sh -c 'cd "$1" || exit 2; swift build' sh "$(dirname "$SWIFTPKG")"
    RC=$?
    if [ "$RC" -eq 0 ]; then
      # Was `pass`, whose own text said the launch half was never exercised — while exit 0 is
      # defined at the top of this file as "built AND launched". A verdict that contradicts itself
      # in its own sentence is still read by /app-ship as a green runtime gate.
      unknown "ios    " "Package.swift builds, but a SwiftPM package has no app to launch, so the
                    launch half of this gate was NOT exercised. Building is the floor, not the gate.
                    Point --project-root at the .xcodeproj/.xcworkspace that produces the app."
    elif [ "$RC" -eq 124 ]; then
      unknown "ios    " "swift build exceeded ${BUILD_TIMEOUT}s and was killed."
    else
      fail "ios    " "swift build failed (exit $RC)."
      keep_log "$WORK/ios.log" "swift build"
    fi
    return
  fi

  if [ "$RC" -eq 124 ]; then
    unknown "ios    " "xcodebuild exceeded ${BUILD_TIMEOUT}s and was killed — the build never
                    completed, so whether it compiles is UNKNOWN, not failing."
    return
  fi
  if [ "$RC" -ne 0 ]; then
    fail "ios    " "the app does not compile (scheme $SCHEME, xcodebuild exit $RC)."
    keep_log "$WORK/ios.log" "xcodebuild"
    return
  fi

  APP=$(find "$APPDIR/Build/Products" -maxdepth 2 -name '*.app' 2>/dev/null | head -n 1)

  if ! xcrun simctl list devices >"$WORK/sim" 2>&1; then
    unknown "ios    " "COMPILES, but launch UNKNOWN: xcrun simctl is unavailable ($(head -n 1 "$WORK/sim" | cut -c1-80)).
                    Building is the floor, not the gate. Install a simulator runtime and re-run."
    return
  fi
  if [ -z "$APP" ]; then
    unknown "ios    " "COMPILES, but no .app was produced under $APPDIR/Build/Products, so there
                    was nothing to install. Check the scheme builds an app target, not a framework."
    return
  fi

  # Reuse a booted simulator if one is up; otherwise boot the first available iPhone.
  # Filter the reuse path to iPhones for the same reason the cold-boot path below does: a booted
  # Apple Watch or Apple TV simulator is a perfectly normal thing to have running, and installing an
  # iOS app onto it fails — which this gate would report as "the app does not install", a FAIL
  # blamed on the app for an environment fact. Match the platform before trusting the device.
  UDID=$(xcrun simctl list devices booted 2>/dev/null | grep 'iPhone' | grep -oE '[0-9A-F-]{36}' | head -n 1)
  BOOTED_BY_US=0
  if [ -z "$UDID" ]; then
    UDID=$(xcrun simctl list devices available 2>/dev/null | grep 'iPhone' | grep -oE '[0-9A-F-]{36}' | head -n 1)
    [ -z "$UDID" ] && { unknown "ios    " "COMPILES, but no iPhone simulator is available to launch on.
                    Install an iOS runtime: Xcode > Settings > Components."; return; }
    run_capped "$BOOT_TIMEOUT" "$WORK/boot.log" xcrun simctl bootstatus "$UDID" -b
    if [ $? -ne 0 ]; then
      unknown "ios    " "COMPILES, but simulator $UDID did not finish booting within ${BOOT_TIMEOUT}s.
                    Whether the app launches is UNKNOWN. Try: xcrun simctl shutdown all && re-run."
      return
    fi
    BOOTED_BY_US=1
  fi

  BUNDLE=$(plutil -extract CFBundleIdentifier raw "$APP/Info.plist" 2>/dev/null)
  if [ -z "$BUNDLE" ]; then
    unknown "ios    " "COMPILES, but could not read CFBundleIdentifier from $APP/Info.plist, so the
                    app could not be launched by id."
    [ "$BOOTED_BY_US" -eq 1 ] && xcrun simctl shutdown "$UDID" >/dev/null 2>&1
    return
  fi

  if ! run_capped "$LAUNCH_TIMEOUT" "$WORK/install.log" xcrun simctl install "$UDID" "$APP"; then
    fail "ios    " "compiles, but the build will not install on the simulator."
    keep_log "$WORK/install.log" "simctl install"
    [ "$BOOTED_BY_US" -eq 1 ] && xcrun simctl shutdown "$UDID" >/dev/null 2>&1
    return
  fi

  if run_capped "$LAUNCH_TIMEOUT" "$WORK/launch.log" xcrun simctl launch "$UDID" "$BUNDLE"; then
    sleep 3   # let the first frame render; a screenshot of the launch screen proves nothing
    if ! ios_running "$UDID" "$BUNDLE"; then
      fail "ios    " "$BUNDLE launched and then EXITED within 3s — it crashed on launch. simctl
                    launch returns 0 for a process that has been forked, so this used to come out
                    as PASS with a screenshot of a dead simulator attached as evidence."
      keep_log "$WORK/launch.log" "simctl launch"
    else
      SHOT="$EVIDENCE/runtime-$DATE-ios.png"
      mkdir -p "$EVIDENCE"
      if xcrun simctl io "$UDID" screenshot "$SHOT" >/dev/null 2>&1; then
        pass "ios    " "built, installed, launched and still running after 3s ($BUNDLE). Evidence: docs/evidence/runtime-$DATE-ios.png"
      else
        pass "ios    " "built, installed, launched and still running after 3s ($BUNDLE). Screenshot capture failed — no evidence artifact."
      fi
    fi
  else
    fail "ios    " "compiles and installs, but $BUNDLE does not launch. This is the exact failure
                    every other gate in this plugin passes straight through."
    keep_log "$WORK/launch.log" "simctl launch"
  fi
  [ "$BOOTED_BY_US" -eq 1 ] && xcrun simctl shutdown "$UDID" >/dev/null 2>&1
}

# --- Android ---------------------------------------------------------------------------------------
android_gate() {
  GDIR=$(dirname "$GRADLE")
  # Walk up to the repo root looking for the wrapper — the wrapper lives at the root while
  # build.gradle is commonly found first in app/.
  WRAPPER=""
  d=$GDIR
  while [ "$d" != "/" ]; do
    [ -f "$d/gradlew" ] && { WRAPPER="$d/gradlew"; break; }
    case "$d" in "$ROOT") break ;; esac
    d=$(dirname "$d")
  done
  [ -z "$WRAPPER" ] && [ -f "$ROOT/gradlew" ] && WRAPPER="$ROOT/gradlew"

  if [ -z "$WRAPPER" ]; then
    unknown "android" "gradle project at $(basename "$GDIR") but no gradle wrapper (./gradlew) under $ROOT.
                    A bare \`gradle\` on PATH is a different version than the project pins, so the
                    build was NOT attempted. Run: gradle wrapper — and commit gradlew + the jar."
    return
  fi
  [ -x "$WRAPPER" ] || chmod +x "$WRAPPER" 2>/dev/null

  WDIR=$(dirname "$WRAPPER")
  # This was `sh -c "cd '$WDIR' && ./gradlew ..."`. WDIR derives from --project-root, which is
  # agent-supplied, so a directory name containing a single quote closed the quoting and ran the
  # rest as shell — argument injection with a *filesystem path* as the vector, in the one script in
  # this repo that shells out with an interpolated string. No shell, no interpolation: run the
  # wrapper directly with an explicit working directory.
  #
  # Also fixes the mundane version of the same bug: a project path containing a space.
  #
  # The path is passed as a POSITIONAL ARGUMENT to sh and read as "$1" — it never becomes part of
  # the script text, so there is nothing for a quote to escape. `env -C` would be shorter and is not
  # portable to the BSD env on macOS, which is where this gate mostly runs.
  run_capped "$BUILD_TIMEOUT" "$WORK/android.log" \
    sh -c 'cd "$1" || exit 2; ./gradlew assembleDebug --console=plain' sh "$WDIR"
  RC=$?
  if [ "$RC" -eq 124 ]; then
    unknown "android" "./gradlew assembleDebug exceeded ${BUILD_TIMEOUT}s and was killed."
    return
  fi
  if [ "$RC" -ne 0 ]; then
    fail "android" "./gradlew assembleDebug failed (exit $RC)."
    keep_log "$WORK/android.log" "./gradlew assembleDebug"
    return
  fi

  APK=$(find "$WDIR" -name '*-debug.apk' -path '*outputs*' 2>/dev/null | head -n 1)
  [ -z "$APK" ] && APK=$(find "$WDIR" -name '*.apk' -path '*outputs*' 2>/dev/null | head -n 1)

  if ! command -v adb >/dev/null 2>&1; then
    unknown "android" "BUILDS, but launch UNKNOWN: adb is not on PATH, so nothing was installed or
                    launched. Install platform-tools and put adb on PATH, then re-run."
    return
  fi
  DEV=$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1; exit}')
  if [ -z "$DEV" ]; then
    unknown "android" "BUILDS, but launch UNKNOWN: no emulator or device is attached (adb devices is
                    empty). Start an AVD or plug in a device, then re-run."
    return
  fi
  if [ -z "$APK" ]; then
    unknown "android" "BUILDS, but no APK was found under $WDIR/**/outputs, so there was nothing to
                    install."
    return
  fi

  if ! run_capped "$LAUNCH_TIMEOUT" "$WORK/adbinstall.log" adb -s "$DEV" install -r "$APK"; then
    fail "android" "assembles, but the APK will not install on $DEV."
    keep_log "$WORK/adbinstall.log" "adb install"
    return
  fi

  # The applicationId is not derivable from the gradle files without evaluating them; aapt reads it
  # off the built APK, which is the artifact we actually care about anyway.
  AAPT=$(command -v aapt2 || command -v aapt || find "${ANDROID_HOME:-$HOME/Library/Android/sdk}/build-tools" -name 'aapt2' 2>/dev/null | sort -r | head -n 1)
  PKG=""
  [ -n "$AAPT" ] && PKG=$("$AAPT" dump badging "$APK" 2>/dev/null | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  if [ -z "$PKG" ]; then
    unknown "android" "BUILDS and INSTALLS, but the launch was NOT exercised: no aapt/aapt2 to read
                    the applicationId off the APK. Install Android build-tools, then re-run.
                    Installing is not launching — this is not a pass."
    return
  fi

  if run_capped "$LAUNCH_TIMEOUT" "$WORK/adblaunch.log" \
       adb -s "$DEV" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1; then
    sleep 3
    if ! android_running "$DEV" "$PKG"; then
      fail "android" "$PKG launched and then EXITED within 3s — it crashed on launch. \`adb shell
                    monkey\` reports the events it injected, not a living process, so this used to
                    come out as PASS with a screenshot of a dead emulator attached as evidence."
      keep_log "$WORK/adblaunch.log" "adb shell monkey"
    else
      SHOT="$EVIDENCE/runtime-$DATE-android.png"
      mkdir -p "$EVIDENCE"
      if adb -s "$DEV" exec-out screencap -p > "$SHOT" 2>/dev/null && [ -s "$SHOT" ]; then
        pass "android" "built, installed, launched and still running after 3s ($PKG). Evidence: docs/evidence/runtime-$DATE-android.png"
      else
        rm -f "$SHOT"
        pass "android" "built, installed, launched and still running after 3s ($PKG). Screenshot capture failed — no evidence artifact."
      fi
    fi
  else
    fail "android" "assembles and installs, but $PKG does not launch."
    keep_log "$WORK/adblaunch.log" "adb shell monkey"
  fi
}

[ "$HAS_IOS" -eq 1 ] && ios_gate
[ "$HAS_ANDROID" -eq 1 ] && android_gate

# --- verdict ---------------------------------------------------------------------------------------
echo "RUNTIME GATE"
printf '%s' "$LINES"
[ -n "$LOGTAIL" ] && printf '%s' "$LOGTAIL"
echo

# FAIL outranks UNKNOWN here, which is the opposite of ship-gate.sh — deliberately. There, UNKNOWN
# outranks BLOCKED because a missing input invites "it's only blocked because the file isn't there
# yet" as an override. Here every per-platform verdict is printed above regardless, so nothing is
# hidden by the headline, and "iOS does not compile" is the more actionable and more certain
# statement than "Android had no emulator". Both are non-zero: the invariant that a check which did
# not run can never produce exit 0 holds either way.
case "$WORST" in
  1) echo "RESULT: FAIL — the app does not build or does not launch. Do not advance this ticket."
     echo "        Re-spawn the developer with the compiler output above verbatim."
     exit 1 ;;
  2) echo "RESULT: CANNOT EVALUATE — this is NOT a pass. Something above was never actually run."
     echo "        Report it as CANNOT EVALUATE in the standup; do not record it as verified."
     exit 2 ;;
  *) echo "RESULT: PASS — the app built and launched. Evidence paths are listed above."
     exit 0 ;;
esac
