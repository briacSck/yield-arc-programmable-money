#!/usr/bin/env bash
# Fires the held-back eval cases (once any exist beyond case-01) against a pinned agent version.
# Usage: ./run-evals.sh <AGENT_VERSION>
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
set -a; source IDS.env; set +a

VERSION="${1:?usage: run-evals.sh <AGENT_VERSION>}"
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

RESULTS="evals/results-v${VERSION}.json"
echo "[]" > "$RESULTS"

for case_dir in evals/case-*/; do
  case_name=$(basename "$case_dir")
  echo "== $case_name (agent v$VERSION) =="

  SESSION_RESP=$(curl -sS --fail-with-body "$BASE/sessions" "${H[@]}" -d '{
    "agent": {"type":"agent","id":"'"$AGENT_ID"'","version":'"$VERSION"'},
    "environment_id": "'"$ENV_ID"'",
    "title": "eval '"$case_name"'",
    "resources": [{"type":"memory_store","memory_store_id":"'"$MEMSTORE_ID"'","access":"read_write","instructions":"Prior underwriting certificates + trend.md."}]
  }')
  SESSION_ID=$(python3 -c "import json,sys; print(json.loads('''$SESSION_RESP''')['id'])")

  EVT=$(python3 -c "
import json
desc = open('first_prompt.txt').read()
rubric = open('outcome.md').read()
print(json.dumps({'events':[{'type':'user.define_outcome','description':desc,'rubric':{'type':'text','content':rubric},'max_iterations':3}]}))
")
  curl -sS --fail-with-body "$BASE/sessions/$SESSION_ID/events" "${H[@]}" -d "$EVT" > /dev/null

  echo "  session $SESSION_ID kicked off — poll it, then append its outcome_evaluations[] + usage to $RESULTS by hand or extend this script."
done
