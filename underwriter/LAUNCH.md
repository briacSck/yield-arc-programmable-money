# LAUNCH — the-underwriter

Resumable: every step reads `IDS.env` first and skips objects that already exist. Re-run safely after a partial failure.

```bash
cd my-agent
set -a; source .env; set +a
set -a; source IDS.env; set +a
BASE=https://api.anthropic.com/v1
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" \
   -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")
```

## 0. Pick a model (already decided: claude-opus-4-8)
```bash
curl -sS "$BASE/models" "${H[@]:0:4}" | jq -r '.data[].id' | grep opus-4-8
```

## 1. Environment
```bash
if [ -z "${ENV_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/environments" "${H[@]}" -d @environment.json -o /tmp/env.json
  ENV_ID=$(python3 -c "import json; print(json.load(open('/tmp/env.json'))['id'])")
  echo "ENV_ID=$ENV_ID" >> IDS.env
fi
```

## 2. Agent
```bash
if [ -z "${AGENT_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/agents" "${H[@]}" -d @agent.json -o /tmp/agent.json
  AGENT_ID=$(python3 -c "import json,sys; d=json.JSONDecoder(strict=False).decode(open('/tmp/agent.json').read()); print(d['id'])")
  AGENT_VERSION=$(python3 -c "import json,sys; d=json.JSONDecoder(strict=False).decode(open('/tmp/agent.json').read()); print(d['version'])")
  echo "AGENT_ID=$AGENT_ID" >> IDS.env
  echo "AGENT_VERSION=$AGENT_VERSION" >> IDS.env
fi
```
✅ `📦 environment env_…` · ✅ `🤖 agent agent_… (v1, claude-opus-4-8)`
Console: `https://platform.claude.com/workspaces/default/agents/$AGENT_ID`

## 3. Memory store — create + seed
```bash
if [ -z "${MEMSTORE_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/memory_stores" "${H[@]}" -d @memory_store.json -o /tmp/memstore.json
  MEMSTORE_ID=$(python3 -c "import json; print(json.load(open('/tmp/memstore.json'))['id'])")
  echo "MEMSTORE_ID=$MEMSTORE_ID" >> IDS.env

  # seed: one synthetic baseline record + the trend log, so run 1 already states a trend
  python3 -c "
import json
content = open('memory_seed/seed-assessment.json').read()
print(json.dumps({'path': '/seed-assessment.json', 'content': content}))
" > /tmp/seed1.json
  curl -sS --fail-with-body "$BASE/memory_stores/$MEMSTORE_ID/memories" "${H[@]}" -d @/tmp/seed1.json

  python3 -c "
import json
content = open('memory_seed/trend.md').read()
print(json.dumps({'path': '/trend.md', 'content': content}))
" > /tmp/seed2.json
  curl -sS --fail-with-body "$BASE/memory_stores/$MEMSTORE_ID/memories" "${H[@]}" -d @/tmp/seed2.json
fi
```
✅ `🧠 memory store memstore_…` (seeded with 1 synthetic baseline record)

## 4. Session
```bash
if [ -z "${SESSION_ID:-}" ]; then
  curl -sS --fail-with-body "$BASE/sessions" "${H[@]}" -d '{
    "agent": "'"$AGENT_ID"'",
    "environment_id": "'"$ENV_ID"'",
    "title": "the-underwriter — first run",
    "resources": [{"type":"memory_store","memory_store_id":"'"$MEMSTORE_ID"'","access":"read_write","instructions":"Prior underwriting certificates + trend.md — read before pricing, append after."}]
  }' -o /tmp/session.json
  SESSION_ID=$(python3 -c "import json,sys; d=json.JSONDecoder(strict=False).decode(open('/tmp/session.json').read()); print(d['id'])")
  echo "SESSION_ID=$SESSION_ID" >> IDS.env
fi
```
✅ `▶️ session sesn_…`
Console: `https://platform.claude.com/workspaces/default/sessions/$SESSION_ID`

## 5. Kickoff (outcome event)
```bash
curl -sS --fail-with-body "$BASE/sessions/$SESSION_ID/events" "${H[@]}" -d @kickoff.json
```

## 6. Watch the run
```bash
# foreground first iteration — confirm it parses before backgrounding
curl -sS "$BASE/sessions/$SESSION_ID" "${H[@]}" -o /tmp/sess.json
python3 -c "
import json
d = json.JSONDecoder(strict=False).decode(open('/tmp/sess.json').read())
print(d['status'], [e.get('result') for e in d.get('outcome_evaluations', [])])
"
# then either stream:
curl -sS -N --fail-with-body "$BASE/sessions/$SESSION_ID/events/stream" "${H[@]}" -H "accept: text/event-stream"
# or poll the same python one-liner in a loop every ~15s
```

## 7. Outputs (once status is idle)
```bash
curl -sS "$BASE/files?scope_id=$SESSION_ID" "${H[@]}" | jq -r '.data[] | "\(.id) \(.filename)"'
curl -sS "$BASE/files/$FILE_ID/content" "${H[@]}" -o certificate.json   # repeat for memo.md
```

## 8. Scheduled deployment (once a run has passed the rubric)
```bash
if [ -z "${DEPLOYMENT_ID:-}" ]; then
  # substitute real IDs into deployment.json's $AGENT_ID / $ENV_ID / $MEMSTORE_ID placeholders first
  curl -sS --fail-with-body "$BASE/deployments?beta=true" "${H[@]}" -d @deployment.json -o /tmp/depl.json
  DEPLOYMENT_ID=$(python3 -c "import json; print(json.load(open('/tmp/depl.json'))['id'])")
  echo "DEPLOYMENT_ID=$DEPLOYMENT_ID" >> IDS.env
  python3 -c "import json; print(json.load(open('/tmp/depl.json'))['schedule']['upcoming_runs_at'])"
fi
# manual test run before trusting the cron:
curl -sS -X POST --fail-with-body "$BASE/deployments/$DEPLOYMENT_ID/run?beta=true" "${H[@]}" -d '{}'
```
✅ `🗓️ deployment depl_…` — daily 7:00 AM America/Los_Angeles
Console: `https://platform.claude.com/workspaces/default/deployments/$DEPLOYMENT_ID`
