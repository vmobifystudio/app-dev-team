#!/bin/sh
# guard-gate-writes — PreToolUse on Bash, the file-writing tools and Read|Grep|Glob. Refuses a
# SUBAGENT minting actor tokens, loading actor/evidence libraries into its own program, hand-writing
# the token registry or INTO gate evidence, starting a nested `claude`, or reading ~/.claude/projects
# transcripts. Logic and its stated bound: contract-hooks.mjs guard-gate-writes.
. "$(dirname "$0")/in-studio.sh"
printf '%s' "$PAYLOAD" | node "$(dirname "$0")/contract-hooks.mjs" guard-gate-writes
