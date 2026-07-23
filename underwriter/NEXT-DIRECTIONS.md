# Next directions

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
