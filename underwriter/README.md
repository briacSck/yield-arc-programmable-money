# The Underwriter — CMA underwriter agent

The **§18 underwriter beat**, built on [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview): an independent agent that prices insurance for YIELD's autonomous CFO agent by verifying it stays inside its on-chain mandate.

> **Thesis:** a bounded agent is a measurable agent, and a measurable agent is an insurable agent — **bounded ⇒ insurable ⇒ scalable.**

## What it does

Every run (daily on a schedule + on-demand), from **public read-only data only**:

1. Fetches the CFO's public dashboard (`/api/events`).
2. Writes its own viem script to cross-check the `AgentMandate` contract on Arc testnet (floor / ticket / daily-cap / revoked / balances) and reads the agent wallet's gas.
3. Computes risk stats (closest approach to the floor, daily-cap utilization, breaches, gas health, dashboard-vs-chain agreement).
4. Prices a 30-day premium from a **disclosed stub formula** — `premium = f(floor, caps, verified history)` (`stub-v0`).
5. Issues a machine-readable `certificate.json` + a one-page `memo.md`, and keeps a premium **trend** across runs in a memory store.

It is a **separate agent** from the CFO it judges — arm's-length underwriting, not self-reporting. It is strictly read-only (HTTP GET + `eth_call`, no keys, no transactions) and touches **none** of YIELD's money-moving path; it consumes the same public surfaces (`/events`, the `AgentMandate` getters) the rest of the system already exposes.

## How this maps to YIELD

The CFO agent trades under the on-chain `AgentMandate` (floor 5 / ticket 2 / dailyCap 5 USDC). The Underwriter reads that *same* mandate and prices the risk of insuring the agent that operates under it — the "manage risk / trust layer" beat, made concrete. See `docs/PLAN.md` §18.2 (the Fiduciary Standard track) and §6 Option A.

**Delivered here:** the assessment + pricing half (independent agent, disclosed stub premium, daily certificate, memory trend, machine-verify path wired). **Still roadmap:** the on-chain parametric-cover escrow + oracle trigger, and Nanopayments/ERC-8183 agent-to-agent premium settlement.

## Layout

| Path | What it is |
|---|---|
| `agent.json` · `environment.json` · `outcome.md` · `kickoff.json` · `deployment.json` | The CMA build: agent config, cloud environment (`limited` networking → 2 hosts only), the Outcome rubric, the daily deployment. |
| `memory_store.json` · `memory_seed/` | The `underwriting-history` memory store + its seeded baseline. |
| `LAUNCH.md` | The exact, resumable create-calls (env → agent → memory → session → kickoff). |
| `certificate.json` · `memo.md` | The first real run's output (graded `satisfied`, premium 0.0851 USDC/30d). |
| `proof/` | v1 — offline proof that `verification.mode` flips to `machine-verified` when `@yield-cfo/mandate-verify` ships (`simulate-verifier.sh`). |
| `bind/` | v2 — on-demand, human-gated bind-coverage flow (session-local tool; off the schedule). |
| `viewer/` | Self-contained results page (premium trend + per-run cards; opens offline). |
| `evals/` | Regression baseline (`case-01` = the first verified run). |
| `agent-overview.html` · `overview.css` · `pitch.html` | The schema/overview page + a certificate-styled pitch page. |
| `NEXT-DIRECTIONS.md` · `build-sheet.json` | The version plan and the single source-of-truth build sheet. |

## Reproduce / re-run

This is a build kit for **your own** Anthropic account. Supply a key and follow `LAUNCH.md`:

```bash
cd underwriter
printf 'ANTHROPIC_API_KEY=<your Anthropic API key>\n' > .env   # never committed — gitignored
# then follow LAUNCH.md (env → agent → memory store → session → outcome kickoff)
```

The live objects created during this build (`IDS.env`) are account handles — useless without the key. No secret is committed.
