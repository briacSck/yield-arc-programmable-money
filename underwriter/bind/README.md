# v2 — Bind-coverage behind a human gate

A separate, **on-demand** flow that demonstrates human-in-the-loop approval of an insurance bind. It never touches the daily assessor.

```
bind.sh
  ├─ create a fresh session on the SAME agent + env   (no new agent version)
  ├─ add the bind_coverage custom tool SESSION-LOCALLY (POST /sessions/:id {agent:{tools:[...]}})
  ├─ send the certificate + "propose a bind if it qualifies"
  └─ agent calls bind_coverage → session idles requires_action  ← the gate
                                   │
        ┌──────────────────────────┴──────────────────────────┐
   bind-approve.sh                                        bind-deny.sh
   custom_tool_result "APPROVED, policy_id=…"             custom_tool_result "DECLINED, …"
   → writes bind/outbox/bind-<cert>.json                  → agent stands down, explains
```

Run it:

```bash
bash bind/bind.sh            # proposes a bind, prints the terms, stops at the gate
bash bind/bind-approve.sh    # …or bind-deny.sh — the live allow/deny moment
```

## Why it's built this way (two deliberate safety choices)

1. **Session-local tool, not an agent update.** The daily deployment references the agent as `latest`, so a new agent version would flow straight into the unattended 7 AM run — where an approval gate would hang the session in `requires_action` with nobody to answer. Adding the tool *session-locally* (`POST /sessions/:id` with `{"agent":{"tools":[…]}}`) means it exists only inside this on-demand bind session; the scheduled assessor's config, version, and read-only nature are unchanged.
2. **Client-executed custom tool = the honest gate today.** CMA's true `always_ask` permission gate (→ `user.tool_confirmation` allow/deny) governs server-executed **MCP/built-in** tools, which need a real connector. There's no real bind counterparty yet, so we use the client-executed **custom tool** equivalent: the agent proposes, the session pauses, and a human returns `user.custom_tool_result` (approve → outbox record; deny → stand down). Same human-in-the-loop shape. When a real binding target exists, this becomes an MCP connector gated `always_ask` — see `../NEXT-DIRECTIONS.md`.

`tools[]` is full-replacement, so `bind.sh` resends the entire live toolset block (with the `web_fetch`/`web_search` disables) plus the custom tool — otherwise the agent would lose its tools.
