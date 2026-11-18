#!/bin/sh
# require-spawn-contract — PreToolUse on the subagent tool (`Task`, renamed `Agent` in newer Claude
# Code; hooks.json matches both). Refuses an app-dev-team IC or code-reviewer spawn on a board ticket
# whose prompt does not inline the output contract of its MODE (spawn-prompt verify), while
# `.studio-stop` is set, or (code roles) whose files overlap in-flight work. Logic and rationale:
# hooks/contract-hooks.mjs (C10).
#
# stdin: the PreToolUse payload · exit 0 allow · exit 2 block (reason on stderr)
# No node, or not a studio project → allow: nothing this hook calls could run or apply.
. "$(dirname "$0")/in-studio.sh"
printf '%s' "$PAYLOAD" | node "$(dirname "$0")/contract-hooks.mjs" pre-spawn
