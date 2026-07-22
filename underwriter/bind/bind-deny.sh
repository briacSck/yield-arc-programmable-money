#!/usr/bin/env bash
# v2 — Bind-coverage demo, step 2b: DECLINE the proposed bind.
# Returns a custom_tool_result denying the bind; the agent stands down and explains.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
set -a; source bind/BIND_IDS.env; set +a
export PYTHONIOENCODING=utf-8
BASE=https://api.anthropic.com/v1
CURL="curl -sS --ssl-no-revoke --fail-with-body"
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

: "${BIND_SESSION_ID:?run bind.sh first}"
: "${BIND_TOOL_USE_ID:?no pending bind proposal — run bind.sh first}"
REASON="${1:-Declined by human underwriter: terms not approved at this time. Certificate is preliminary (pending machine verification); revisit once machine-verified mode is live.}"

python3 - "$BIND_TOOL_USE_ID" "$REASON" <<'PY' > _deny.json
import json, sys
use_id, reason = sys.argv[1], sys.argv[2]
print(json.dumps({"events": [{"type": "user.custom_tool_result", "custom_tool_use_id": use_id,
                              "content": [{"type": "text", "text": "DECLINED. " + reason}]}]}))
PY
$CURL "$BASE/sessions/$BIND_SESSION_ID/events" "${H[@]}" -d @_deny.json -o /dev/null -w 'deny http=%{http_code}\n'
echo "✅ bind declined — agent will stand down and explain."
rm -f _deny.json
