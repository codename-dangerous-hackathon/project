#!/usr/bin/env bash
# Belong privacy guard (PreToolUse on Bash).
# Blocks git from staging/committing on-device secrets or patient data — the app's
# whole thesis is "nothing leaves the box," and these files have leaked before.
# Exit 2 = block the tool call and show the message to Claude. Exit 0 = allow.
set -uo pipefail

input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null || true)

# Only police git add / git commit; let everything else through fast.
case "$cmd" in
  *"git add"*|*"git commit"*) ;;
  *) exit 0 ;;
esac

FORBIDDEN='vapid_private|\.pem($|[^a-zA-Z])|chroma\.sqlite3|src/backend/keys/|src/backend/database/data/|src/backend/data/'

staged=$(git diff --cached --name-only 2>/dev/null | grep -E "$FORBIDDEN" || true)
incmd=$(printf '%s' "$cmd" | grep -oE 'vapid_private[^ ]*|[^ ]*\.pem|[^ ]*chroma\.sqlite3|src/backend/keys/[^ ]*|src/backend/database/data/[^ ]*|src/backend/data/[^ ]*' || true)

if [ -n "$staged" ] || [ -n "$incmd" ]; then
  {
    echo "🛑 BLOCKED by Belong privacy guard (.claude/hooks/guard-no-secrets.sh)."
    echo "These are on-device secrets / patient data and must never be tracked:"
    [ -n "$staged" ] && { echo "  staged & forbidden:"; printf '%s\n' "$staged" | sed 's/^/    - /'; }
    [ -n "$incmd" ]  && { echo "  named in command:";   printf '%s\n' "$incmd"  | sed 's/^/    - /'; }
    echo "If this is truly intentional, run the git command in a real terminal outside Claude."
  } >&2
  exit 2
fi
exit 0
