#!/bin/sh
# persist-ic-report — SubagentStop for the roles that owe a DONE report (lib/contract.mjs). Saves the
# subagent's final message to docs/team/reports/<ticket-or-role>-<UTC>.md (an operational path:
# docs/team is in scripts/lib/operational-paths.txt), runs report-check on it, and blocks ONCE per
# subagent with the exact missing lines when ticket work fails the contract. Never blocks twice.
# Logic and rationale: hooks/contract-hooks.mjs (C6, C10).
#
# stdin: the SubagentStop payload · exit 0 allow · exit 2 block (reason on stderr)
command -v node >/dev/null 2>&1 || exit 0
exec node "$(dirname "$0")/contract-hooks.mjs" subagent-stop
