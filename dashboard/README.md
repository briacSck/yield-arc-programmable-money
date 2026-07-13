# dashboard

Live decision log + explorer links for the YIELD Agentic CFO. Deployed on Railway (pattern-match
`yield-frontend`).

**Status:** the full Next.js UI is deferred (plan: dashboard v1 in W2). What's pinned now is the
**API-route contract** the UI is built against — see `src/api-contract.ts`:

- `GET /api/events` — the append-only decision/settlement log (identity badge, decision log with
  receipt links, explorer links all render from this single source).
- `GET /health` — liveness for the uptime monitor (§15.4).

Build the Next.js app around these two routes; read nothing else (invariant: one API route).
