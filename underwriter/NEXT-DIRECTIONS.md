# Next directions

> **Status as of 2026-07-28 — the daily deployment is archived; nothing runs or bills.**
> `depl_01BJhJXeT2EKbqbd53yAaZnX` was archived 2026-07-28 06:51 UTC after 6 scheduled runs (last: 2026-07-27 07:05 PT). Verified live: `upcoming_runs_at` is empty, the deployment no longer appears in `GET /v1/deployments`, `POST .../pause` returns `400 "Cannot modify archived deployment"`, and all 8 sessions are `idle`. The agent, environment, and `underwriting-history` memory store still exist — they hold state but execute nothing on their own.

## ▶️ Restarting the clock (when there's budget again)

**What:** Put the daily assessor back on schedule.
**Why it's not just a toggle:** Archive is terminal — the API exposes `pause`/`unpause` but no `unarchive`, so the old deployment object can't be revived.
**How:** Re-`POST /v1/deployments?beta=true` with the body already saved in `deployment.json` (see `LAUNCH.md` §9), pointing at the **same** `AGENT_ID` / `ENV_ID` / `MEMSTORE_ID` from `IDS.env`. The trend continues uninterrupted because the memory store is untouched. Two things to check before firing:
1. `initial_events` uses only relative dates ("as of right now") — it does, so it's safe to replay verbatim.
2. Re-run `evals/` first if the agent version changed while it was off.
Then write the new `DEPLOYMENT_ID` back into `IDS.env` and `build-sheet.json`, and flip this file's status line.

**On-demand still works today** — `LAUNCH.md` fires the same agent with the same outcome and never depended on the deployment. Each manual run costs cents, so this is the cheap way to keep using it without a schedule.

## ✅ Shipped this session (on-demand / offline; daily assessor untouched)

### v1 — Machine-verified flip proof
The live path was already wired (the agent tries `npx -y @yield-cfo/mandate-verify --json` every run and falls back silently on 404). Added `proof/simulate-verifier.sh` — an offline proof that flips a real certificate to `verification.mode: "machine-verified"` using a simulated verifier payload, so the before/after is demoable today without the package. When `@yield-cfo/mandate-verify` publishes, the next scheduled run flips for real, zero code change.

### v2 — Bind-coverage behind a human gate
Added the `bind/` flow: an on-demand session that adds a `bind_coverage` custom tool **session-locally** (no new agent version), asks the agent to propose terms against a certificate, idles at the gate, and lets a human `approve` (writes `bind/outbox/bind-<cert>.json`) or `deny` (agent stands down). Kept deliberately off the daily schedule — an approval gate on the unattended assessor would hang each run in `requires_action`. Demonstrated end-to-end: policy `POL-d2fa68` bound against `uw-2026-07-22-42569c04`.

### Results viewer
Added `viewer/build-viewer.sh` → a self-contained `results-viewer.html`: premium-trend chart + per-run cards, data baked in (opens offline). Re-run to refresh.

## Still ahead

### v3 — ERC-8004 registry cross-check
**What:** A `checks[]` entry that reads the CFO's identity record from registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` to corroborate `agentId 850878`.
**Why deferred:** Registry address + agentId given, but not the getters/ABI to call — needs that confirmed before it's a real PASS/PENDING check.
**How:** Confirm the registry ABI, add it alongside the `AgentMandate` ABI in the system prompt, add one more `checks[]` entry.

### Bind-coverage → real connector (the v2 production path)
**What:** Replace the demo custom tool with a real MCP connector gated `always_ask` (→ `user.tool_confirmation`) once a binding target (contract/ledger/counterparty) exists.
**Why deferred:** No real binding mechanism yet; today's certificates are explicitly preliminary.
**How:** MCP server + vault credential + `always_ask` on that tool; keep it on an on-demand/interactive surface, never the unattended daily deployment (or pin the deployment's agent to a version so the gate can't leak into a scheduled run).

### Always
Re-run `evals/` (the golden set) against any new agent version before promoting it to the scheduled deployment — `evals/run-evals.sh` against the new version; only bump `deployment.json`'s pinned version when verdicts hold.
