# in-studio — sourced by the node-backed hook wrappers. Reads the hook payload into $PAYLOAD and
# exits 0 (allow) unless the payload's cwd, $CLAUDE_PROJECT_DIR or $PWD is an app-dev-team project:
# a docs/31-board-events.jsonl there or in the main tree of its git repo. Starting node costs ~50ms
# per tool call; outside a studio project every Bash/Read/Write paid it for nothing (C2-27).
# ponytail: cwd is pulled from the JSON with sed (last "cwd":"..." pair, unescaped paths only) — a
# miss just means node runs and decides, never a wrong allow for a studio cwd that $PWD also names.
command -v node >/dev/null 2>&1 || exit 0
PAYLOAD=$(cat 2>/dev/null || true)
[ -n "$PAYLOAD" ] || exit 0
_cwd=$(printf '%s' "$PAYLOAD" | tr '\n' ' ' | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
_studio=0
for _d in "$_cwd" "${CLAUDE_PROJECT_DIR:-}" "$PWD"; do
  [ -n "$_d" ] && [ -d "$_d" ] || continue
  [ -f "$_d/docs/31-board-events.jsonl" ] && { _studio=1; break; }
  _c=$(git -C "$_d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
    && [ -f "$(dirname "$_c")/docs/31-board-events.jsonl" ] && { _studio=1; break; }
done
# An unparsed cwd is not proof of "outside": let node decide rather than fail open on a sed miss.
[ "$_studio" = 1 ] || [ -z "$_cwd" ] || exit 0
