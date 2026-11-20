#!/bin/sh
# guard-gate-writes — PreToolUse on Bash, the file-writing tools and Read|Grep|Glob. Refuses a
# SUBAGENT minting actor tokens, composing a spawn prompt (which mints) or re-sealing the audit
# anchor; running a command, script or plugin subcommand whose name is built at runtime; feeding a
# shell text it did not spell out; loading this plugin's actor/evidence/events libraries; writing —
# or sweeping, restoring, patching or extracting over — the token registry, board anchor, gate
# evidence, board log, gate results or a main-tree control file; starting a nested `claude`; or
# reading ~/.claude/projects transcripts (directly or by a recursive search above them). A backstop
# that reads the shell command, not a sandbox: logic and its stated bound in contract-hooks.mjs.
# PR46-9: only a SUBAGENT (a payload with "agent_id") is restricted — the main session's every tool
# call exits here, before node. G7-12: a call that spells an absolute path (or ~) is NOT pre-filtered by
# its cwd — `rm -rf /abs/proj/docs/team/evidence` from /tmp targets a studio too, and node derives the
# root from each path. Any other call still skips node outside a studio project (in-studio.sh, C2-27).
_P=$(cat 2>/dev/null || true)
case $_P in *'"agent_id"'*) ;; *) exit 0 ;; esac
command -v node >/dev/null 2>&1 || exit 0
_rest=$(printf '%s' "$_P" | tr '\n' ' ' | sed -e 's/"cwd"[[:space:]]*:[[:space:]]*"[^"]*"//g' -e 's/"[a-z_]*transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"//g')
case $_rest in
  *[/~]*) printf '%s' "$_P" | node "$(dirname "$0")/contract-hooks.mjs" guard-gate-writes ;;
  *) printf '%s' "$_P" | {
       . "$(dirname "$0")/in-studio.sh"
       printf '%s' "$PAYLOAD" | node "$(dirname "$0")/contract-hooks.mjs" guard-gate-writes
     } ;;
esac
