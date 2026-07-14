# YIELD — Agentic CFO on Arc

An autonomous treasury agent that holds its own [Circle Wallet](https://www.circle.com/) on
[Arc](https://arc.network), **forecasts a company's cash position** (P10/P50/P90 over 30/60/90
days), and on its own keeps a safe operating floor while deploying surplus USDC into yield —
pulling funds back *before* projected shortfalls, settling sub-second in USDC, every action
signed under a **verifiable on-chain agent identity (ERC-8004)**.

> A CFO that never sleeps, for the real economy, built agent-native on Arc.

**🟢 LIVE — trading autonomously on Arc testnet since July 14, 2026, no human in the loop.**

- **Live dashboard:** https://dashboard-production-abea.up.railway.app — every decision, its
  reason sentence, and its on-chain receipt, with explorer links.
- **The mandate (on-chain):** [`0x856bec6faadd61b583430e0cd22ec2e211c782b4`](https://testnet.arcscan.app/address/0x856bec6faadd61b583430e0cd22ec2e211c782b4)
  — floor, per-ticket cap, 24h budget, owner-revocable.
- **Agent identity:** ERC-8004 agentId `850878` · agent wallet [`0x93d9…ab7c`](https://testnet.arcscan.app/address/0x93d9c11c8e9e23e1e97e855668a27a14accaab7c)
  (Circle developer-controlled wallet).
- **Coming at Checkpoint 2 (Jul 26):** `npx -y @yield-cfo/mandate-verify` — one command that
  replays the agent's FULL on-chain history and machine-checks every move against the mandate's
  invariants (floor / ticket / budget window / post-revocation asymmetry / decision receipts).
  Until then, the dashboard is the run-nothing audit tier.

Built on: **Circle Wallets** (developer-controlled, MPC) · **Circle Contracts (SCP)** ·
**native-USDC gas on Arc** · **ERC-8004 identity** · ERC-8183 (agent-to-agent settlement, W3).

## The trust stack

An autonomous treasury agent is only hireable if a CFO can trust it. YIELD demonstrates the full
trust layer, not just a hot wallet:

- **Identity** — *who* is acting: a verifiable on-chain agent identity (ERC-8004).
- **Mandate** — *what it may do*: an owner-granted, owner-revocable on-chain employment contract
  (`AgentMandate`) the agent provably cannot exceed.
- **Receipts** — *why it acted*: each decision commits the forecast snapshot it acted on
  (`forecastHash`) into the on-chain settlement event, so anyone can replay the reasoning.

## Decision loop

```
[signals] balance + AR/AP + recurring + tax deadlines + input-cost exposure
  → [forecast] P10/P50/P90 cash, next 30/60/90d
  → [decide]  deploy surplus above max(safe_floor, projected P10 min)
              withdraw ahead of a projected floor breach
  → [act]     move USDC via Circle Wallet + AgentMandate covenant, gas in USDC
  → [settle]  sub-second on Arc; ERC-8004-signed; recorded on the dashboard
  → loop on a schedule, no human in the loop
```

The invariant, ported from production YIELD: **being wrong must cost opportunity, never
solvency.** Any degraded input → `HOLD`. All money movement goes through one `ChainExecutor`.

## Repository layout

| Path | What |
|---|---|
| `packages/shared/` | zod schemas = the pinned interface contracts (`ForecastResult`, `Decision`, `ChainExecutor`) |
| `contracts/` | `SweepEscrow` (min-balance covenant) → `AgentMandate` (the on-chain mandate) + Hardhat tests |
| `agent/` | Node worker: forecast client · decision engine · `ChainExecutor` · scheduler · heartbeat |
| `forecast/` | deterministic baseline forecast (+ optional proxy to the t0 model service) |
| `scenario/` | seeded-ledger generator + simulated-clock demo driver |
| `dashboard/` | live decision log + explorer links (Next.js, on Railway) |
| `verifier/` | *(W2)* judge-runnable invariant verifier — replays the mandate's full event history and machine-checks it |

## Status

Encode Club "Programmable Money Hackathon" (Arc / Circle), Agentic Economy + DeFi tracks.
**Deployed and autonomous since Jul 14**: two Railway services (worker loop + dashboard),
heartbeat-monitored, trade mode at live mandate caps. The decision engine, mandate contract,
identity registration, baseline forecast, and dashboard shipped in days 1–2; current work is the
verifier + audit surface. Build invariants for humans and AI agents: `AGENTS.md`; live state and
current targets: `docs/NOW.md`; deferred items: `TODOS.md`.

## Getting started

```bash
npm install
npm run typecheck
npm run test
```

Contracts (Hardhat 3, run from CI/WSL if your machine is ARM64):

```bash
cd contracts && npm install && npm run compile && npm test
```

## License

TBD.
