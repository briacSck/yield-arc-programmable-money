#!/usr/bin/env bash
# v2 — Bind-coverage demo, step 1 of 2.
# On-demand, human-gated. Adds the bind_coverage custom tool SESSION-LOCALLY
# (no new agent version, daily assessor untouched), asks the agent to evaluate
# today's certificate and — if it passes bind criteria — propose terms via the tool.
# The agent then idles in requires_action, waiting for a human to approve or deny
# (run bind-approve.sh or bind-deny.sh next).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
set -a; source IDS.env 2>/dev/null; set +a
export PYTHONIOENCODING=utf-8
BASE=https://api.anthropic.com/v1
CURL="curl -sS --ssl-no-revoke --fail-with-body"
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

CERT="${1:-certificate.json}"
[ -f "$CERT" ] || { echo "No $CERT — run an assessment first."; exit 1; }

# 1. Fresh session on the SAME agent + env (no version change).
$CURL "$BASE/sessions" "${H[@]}" -d '{
  "agent": "'"$AGENT_ID"'",
  "environment_id": "'"$ENV_ID"'",
  "title": "the-underwriter — bind-coverage (on-demand, gated)"
}' -o _bind_resp.json -w 'session http=%{http_code}\n'
BIND_SESSION_ID=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('_bind_resp.json',encoding='utf-8').read()); print(d['id'])")
echo "BIND_SESSION_ID=$BIND_SESSION_ID" > bind/BIND_IDS.env
echo "✅ ▶️ bind session $BIND_SESSION_ID"

# 2. Add the bind_coverage tool SESSION-LOCALLY. tools[] is full-replacement,
#    so resend the exact live toolset block (with web disables) + the custom tool.
python3 - "$BIND_SESSION_ID" "bind/bind_tool.json" <<'PY' > _bind_tools.json
import json, sys
sid, tool_path = sys.argv[1], sys.argv[2]
toolset = {"type": "agent_toolset_20260401",
           "configs": [{"name": "web_fetch", "enabled": False},
                       {"name": "web_search", "enabled": False}]}
bind_tool = json.load(open(tool_path, encoding='utf-8'))
print(json.dumps({"agent": {"tools": [toolset, bind_tool]}}))
PY
$CURL "$BASE/sessions/$BIND_SESSION_ID" "${H[@]}" -d @_bind_tools.json -o _bind_resp.json -w 'session-local tools http=%{http_code}\n'
echo "   bind_coverage added session-locally (agent config unchanged; AGENT_VERSION still $AGENT_VERSION)"

# 3. Kick off with the certificate embedded (on-demand, not scheduled — literal data is fine).
python3 - "$CERT" <<'PY' > _bind_kick.json
import json, sys
cert = open(sys.argv[1], encoding='utf-8').read()
msg = ("You are now acting as the binding underwriter for a SINGLE on-demand decision. "
       "Below is today's underwriting certificate for the YIELD CFO agent. "
       "Evaluate it against sound bind criteria (verification not failed; no floor breach; not revoked; "
       "no core check UNVERIFIED that would materially change the risk). "
       "If it is bindable, call the `bind_coverage` tool with well-reasoned terms "
       "(coverage_limit_usdc should not exceed the certificate's max_loss_per_window unless you justify it). "
       "If it is NOT bindable, do not call the tool — explain why and stand down. "
       "A human underwriter will approve or decline your proposal.\n\n"
       "=== CERTIFICATE ===\n" + cert)
print(json.dumps({"events": [{"type": "user.message", "content": [{"type": "text", "text": msg}]}]}))
PY
$CURL "$BASE/sessions/$BIND_SESSION_ID/events" "${H[@]}" -d @_bind_kick.json -o _bind_resp.json -w 'kickoff http=%{http_code}\n'

# 4. Poll until the agent idles requesting the bind tool (requires_action), or ends its turn.
echo "waiting for the agent to propose a bind (requires_action)..."
for i in $(seq 1 40); do
  $CURL "$BASE/sessions/$BIND_SESSION_ID" "${H[@]}" -o _bind_sess.json -w '' 2>/dev/null || true
  ST=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('_bind_sess.json',encoding='utf-8').read()); print(d['status'])" 2>/dev/null || echo '?')
  SR=$(python3 -c "import json; d=json.JSONDecoder(strict=False).decode(open('_bind_sess.json',encoding='utf-8').read()); sr=d.get('stop_reason') or {}; print(sr.get('type','') if isinstance(sr,dict) else '')" 2>/dev/null || echo '')
  echo "  [$i] status=$ST stop_reason=$SR"
  if [ "$ST" = "idle" ]; then break; fi
  sleep 12
done

# 5. Surface the proposed bind_coverage payload (if any) and the pending custom_tool_use id.
$CURL "$BASE/sessions/$BIND_SESSION_ID/events?types[]=agent.custom_tool_use&types[]=agent.message" "${H[@]}" -o _bind_ev.json -w '' 2>/dev/null || true
python3 - <<'PY'
import json
d = json.JSONDecoder(strict=False).decode(open('_bind_ev.json', encoding='utf-8').read())
evs = d.get('data', d.get('events', []))
use_id = None; payload = None; last_msg = None
for e in evs:
    if e.get('type') == 'agent.custom_tool_use':
        # event is flat: {id, name, input, type}
        use_id = e.get('id')
        payload = e.get('input')
    elif e.get('type') == 'agent.message':
        cc = e.get('content')
        if isinstance(cc, list):
            last_msg = ' '.join(x.get('text','') for x in cc if isinstance(x, dict))
if use_id and payload is not None:
    print("\n=== PROPOSED BIND (awaiting human approval) ===")
    print("custom_tool_use_id:", use_id)
    print(json.dumps(payload, indent=2))
    open('bind/BIND_IDS.env','a',encoding='utf-8').write("BIND_TOOL_USE_ID=%s\n" % use_id)
    print("\nApprove:  bash bind/bind-approve.sh")
    print("Decline:  bash bind/bind-deny.sh")
else:
    print("\nNo bind proposed. Agent's message:")
    print((last_msg or '(none)')[:800])
PY
rm -f _bind_resp.json _bind_tools.json _bind_kick.json _bind_sess.json _bind_ev.json
