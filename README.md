# YIELD — Agentic CFO on Arc

An autonomous treasury agent that holds its own [Circle Wallet](https://www.circle.com/) on
[Arc](https://arc.network), **forecasts a company's cash position** (P10/P50/P90 over 30/60/90
days), and on its own keeps a safe operating floor while deploying surplus USDC into yield —
pulling funds back *before* projected shortfalls, settling sub-second in USDC, every action
signed under a **verifiable on-chain agent identity (ERC-8004)**.

> A CFO that never sleeps, for the real economy, built agent-native on Arc.

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

## Status

Early build for the Encode Club "Programmable Money Hackathon" (Arc / Circle), Agentic Economy
track. Interfaces are pinned; implementation is in progress. See `CONTRIBUTING`-style build
invariants in `AGENTS.md` (local).

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
