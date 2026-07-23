#!/usr/bin/env bash
# v2 — Bind-coverage demo, step 2a: APPROVE the proposed bind.
# Returns a client-executed custom_tool_result (policy bound) and writes a
# schema-true policy record to bind/outbox/. The agent then finalizes.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
set -a; source IDS.env 2>/dev/null; set +a
set -a; source bind/BIND_IDS.env; set +a
export PYTHONIOENCODING=utf-8
BASE=https://api.anthropic.com/v1
CURL="curl -sS --ssl-no-revoke --fail-with-body"
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

: "${BIND_SESSION_ID:?run bind.sh first}"
: "${BIND_TOOL_USE_ID:?no pending bind proposal — run bind.sh first}"

# Pull the proposed terms so the outbox record and the tool result carry real values.
$CURL "$BASE/sessions/$BIND_SESSION_ID/events?types[]=agent.custom_tool_use" "${H[@]}" -o _ev.json -w '' 2>/dev/null
POLICY_ID=$(python3 -c "import random; print('POL-'+format(abs(hash('$BIND_TOOL_USE_ID'))%0xffffff,'06x'))" 2>/dev/null || echo "POL-000001")

python3 - "$BIND_TOOL_USE_ID" "$POLICY_ID" <<'PY' > _approve.json
import json, sys
use_id, policy_id = sys.argv[1], sys.argv[2]
d = json.JSONDecoder(strict=False).decode(open('_ev.json', encoding='utf-8').read())
evs = d.get('data', d.get('events', []))
terms = {}
for e in evs:
    if e.get('id') == use_id:   # event is flat: {id, name, input, type}
        terms = e.get('input') or {}
        break
record = {"status": "BOUND", "policy_id": policy_id, "approved_by": "human underwriter (demo)",
          "certificate_id": terms.get('certificate_id'), "premium_30d_usdc": terms.get('premium_30d_usdc'),
          "coverage_limit_usdc": terms.get('coverage_limit_usdc'), "window_days": terms.get('window_days', 30),
          "note": "Demo bind — client-executed custom tool. A real bind would be an MCP connector gated always_ask (see NEXT-DIRECTIONS)."}
import os
os.makedirs('bind/outbox', exist_ok=True)
cert = terms.get('certificate_id', 'unknown')
open('bind/outbox/bind-%s.json' % cert, 'w', encoding='utf-8').write(json.dumps(record, indent=2))
result_text = "APPROVED. Coverage bound. policy_id=%s, premium_30d=%s USDC, limit=%s USDC. Recorded to the policy ledger." % (
    policy_id, terms.get('premium_30d_usdc'), terms.get('coverage_limit_usdc'))
print(json.dumps({"events": [{"type": "user.custom_tool_result", "custom_tool_use_id": use_id,
                              "content": [{"type": "text", "text": result_text}]}]}))
print("WROTE bind/outbox/bind-%s.json (policy %s)" % (cert, policy_id), file=sys.stderr)
PY

$CURL "$BASE/sessions/$BIND_SESSION_ID/events" "${H[@]}" -d @_approve.json -o /dev/null -w 'approve http=%{http_code}\n'
echo "✅ bind approved — policy $POLICY_ID. Outbox record written; agent is finalizing."
rm -f _ev.json _approve.json
