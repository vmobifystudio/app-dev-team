#!/bin/sh
# guard-gate-writes — PreToolUse on Bash, the file-writing tools and Read|Grep|Glob. Refuses a
# SUBAGENT minting actor tokens or composing a spawn prompt (which mints), running board.mjs /
# spawn-prompt.mjs under a runtime-built name or argument, loading actor/evidence/events libraries
# into its own program, touching the token registry or the board anchor, hand-writing INTO gate
# evidence or a main-tree control file (project profile, risk policy, capabilities, .studio-policy),
# starting a nested `claude`, or reading ~/.claude/projects transcripts. A backstop that reads the
# shell command, not a sandbox: logic and its stated bound in contract-hooks.mjs guard-gate-writes.
. "$(dirname "$0")/in-studio.sh"
printf '%s' "$PAYLOAD" | node "$(dirname "$0")/contract-hooks.mjs" guard-gate-writes
