#!/bin/sh
# require-spawn-contract — PreToolUse on the subagent tool (`Task`, renamed `Agent` in newer Claude
# Code; hooks.json matches both). Refuses an app-dev-team IC or code-reviewer spawn on a board ticket
# whose prompt does not inline its output contract, while `.studio-stop` is set, or (code roles) whose
# files overlap in-flight work. Logic and rationale: hooks/contract-hooks.mjs (C10).
#
# stdin: the PreToolUse payload · exit 0 allow · exit 2 block (reason on stderr)
# No node → allow: nothing this hook calls could run either.
command -v node >/dev/null 2>&1 || exit 0
exec node "$(dirname "$0")/contract-hooks.mjs" pre-spawn
