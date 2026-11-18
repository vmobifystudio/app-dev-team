#!/bin/sh
# guard-gate-writes — PreToolUse on Bash|Write|Edit|MultiEdit. Refuses a SUBAGENT minting actor
# tokens or hand-writing the token registry / gate evidence. Logic: contract-hooks.mjs guard-gate-writes.
command -v node >/dev/null 2>&1 || exit 0
exec node "$(dirname "$0")/contract-hooks.mjs" guard-gate-writes
