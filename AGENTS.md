# AGENTS.md — yield-agentic-cfo (Arc hackathon)

> Committed on purpose: every clone (and every teammate's Claude Code session) bootstraps from the
> same rules and state. The strategy doc (`docs/PLAN.md`) stays gitignored/local — ask Briac for
> the share copy. This repo is PUBLIC: build state belongs here, strategy never does.

## Project

YIELD "Agentic CFO on Arc" — Encode Club Programmable Money Hackathon (Agentic Economy + DeFi
tracks). An autonomous treasury agent that holds its own Circle Wallet on Arc testnet, forecasts a
company's cash position (P10/P50/P90), keeps a safe operating floor, and sweeps surplus USDC into
yield — pulling it back *before* projected shortfalls. Every action runs under the trust stack:
**identity** (ERC-8004) + **mandate** (`AgentMandate`, owner-revocable) + **receipts** (the
forecast hash each decision acted on, committed on-chain).

## Tech Stack

- **TypeScript everywhere**, Node 24, npm workspaces monorepo
- **Chain**: Arc testnet (chainId 5042002, USDC is the NATIVE gas token) via `viem`
- **Wallets/signing**: Circle developer-controlled wallets (`@circle-fin/developer-controlled-wallets`);
  contract deploys via `@circle-fin/smart-contract-platform` (raw `signTransaction` is NOT
  supported on Arc — error 156027)
- **Contracts**: Solidity 0.8.24, Hardhat 3 (CI/WSL only — does not run on Briac's win32-arm64
  machine; `solc-js` WASM works everywhere for compile-only)
- **Validation**: zod schemas in `packages/shared` — the pinned interface contracts
- **Tests**: `node:test` + `fast-check` (TS), chai/Hardhat (contracts, CI-verified)

## Module Map

| Workspace | Responsibility |
|---|---|
| `packages/shared` | Pinned zod interface contracts (§16.2): `ForecastResult`, `Decision`, `ChainExecutor`, `EventLogRecord`. Change ONLY by team agreement |
| `contracts` | `SweepEscrow` (vendored, proven) + `AgentMandate` (live on testnet). 6-dec USDC pools, `SCALE=1e12` at native boundaries |
| `agent` | The worker: `decide()` rule (§16.3) · `CircleChainExecutor` · scheduler (observe/trade) · JSONL event log · heartbeat · ops scripts |
| `forecast` | `baselineForecast()` (§16.4): deterministic, rational-k bands, canonical `inputsHash`. The t0 model service swaps in later behind `modelId` |
| `scenario` | Seeded "Boulangerie Chartier" ledger + simulated clock (demo driver) |
| `dashboard` | Next.js; reads ONE API route backed by the event log, nothing else |
| `verifier` *(W2, **core shipped** 2026-07-23)* | Judge-runnable CLI (`npx -y @yield-cfo/mandate-verify`): two-layer — fetch (chain → NormalizedEvent[]) + PURE replay core (`src/core/replay.ts`, zero I/O) that machine-checks the 5 mandate invariants over full history. **Runs live 5/5 COMPLIANT in ~6 s.** 17 tests test BOTH directions: violating histories it must catch (the negative demo) AND compliant-adversarial histories it must NOT flag (false VIOLATIONs are the dominant failure mode — invariant 3 is an EXACT replay of the contract's lazy tumbling window, never a naive rolling 24h sum) + a live-history golden test. Receipt check is PURE-CHAIN (`decisionId = keccak(forecastHash\|kind)`, no preimage API). Remaining: npm publish, nightly CI → `audit-log` ref → dashboard `audit` block, `GET /forecasts` preimage route, ERC draft |
| `underwriter` *(W3, §18 beat)* | Claude Managed Agent (hosted, scheduled, Outcome-graded) that prices insurance for the CFO from public read-only data: fetches `/events`, cross-checks the `AgentMandate` getters on-chain via viem, computes risk stats, prices a disclosed `stub-v0` premium, and issues a certificate + memo daily. A SEPARATE agent from the CFO (arm's-length); strictly read-only (HTTP GET + `eth_call`, no keys, no tx) — consumes existing surfaces, touches none of the untouchable path. Build kit + first real certificate under `underwriter/`; when `@yield-cfo/mandate-verify` ships it flips to machine-verified with no code change |

## Live state

Addresses, tx links, current targets and blockers live in **`docs/NOW.md`** — read it FIRST every
session; update it in the same PR as any state-changing work. **Do not start a task not listed in
NOW.md without asking.** Deferred/gated work is tracked in `TODOS.md` — don't silently pick items
from it; they're deferred on purpose.

**The deployed worker is live and trading.** "Untouchable" = the scheduler / decision engine /
executor path — do not modify money-moving code without Briac's explicit go. The worker's HTTP
surface (`agent/src/server.ts`) MAY gain additive read-only routes (that's the sanctioned seam);
any worker redeploy restarts the loop (it's restart-safe by design, but coordinate).

**Railway deploys are MANUAL, not auto-from-`main`** (gotcha proven 2026-07-23 — a fix on `main` sat
undeployed while the worker ran 8-day-old code). Deploy with `railway up --service worker` or
`railway up --service dashboard` (uploads the current working dir; Railpack build via the root
`scripts/railway-*.mjs` dispatchers). A failed build keeps the old deployment running. **RPC
liveness is a pool, not a host** — the worker reads through a viem `fallback` across Arc endpoints
(`agent/src/chain/arc-chain.ts`); only `rpc.drpc.testnet.arc.io` serves concurrent `eth_getLogs`,
the rest rate-limit ~1 req/s. Never wire a single `ARC_RPC_URL` as the sole endpoint again.

## Commands

```bash
npm install                          # workspace install
npm run typecheck --workspaces       # all workspaces
npm test --workspaces --if-present   # shared + agent + forecast (contracts run in CI)
npm start --workspace agent          # the Tier-1 loop (SCHEDULER_MODE=observe by default)
npx tsx agent/scripts/<script>.ts    # ops scripts: circle-setup, deploy-mandate, register-identity, e2e-first-decision, usyc-mint-test
npx tsx verifier/src/cli.ts          # @yield-cfo/mandate-verify — live 5/5 in ~6s (--fixture naive-agent for the negative demo)
```

## Environment (names only — see .env.example; secrets live in each runner's local .env)

`ARC_RPC_URL` · `ARC_CHAIN_ID` · `CIRCLE_API_KEY` · `CIRCLE_ENTITY_SECRET` ·
`CIRCLE_AGENT_WALLET_ID` · `AGENT_MANDATE_ADDRESS` · `CHAIN_EXECUTOR` (`circle`|`mock`, explicit) ·
`SCHEDULER_MODE` (`observe`|`trade`) · `HEARTBEAT_URL` · decision knobs (`USER_MIN_USDC`,
`MIN_TICKET_USDC`, `HORIZON_DAYS`). Money-moving scripts need Briac's Circle credentials — they
never leave his machine; build against `CHAIN_EXECUTOR=mock` instead.

## Invariants — never violate

1. **All money movement through `ChainExecutor`** — never construct a transaction anywhere else.
2. **Decision logic is pure and config-driven** — property tests must stay green. No wall-clock
   reads inside `decide()`; `input.now` is the only time source.
3. **Never fake or simulate on-chain results in a default code path** — `MockChainExecutor` only
   behind an explicit `CHAIN_EXECUTOR=mock`; the scheduler moves money only in explicit
   `SCHEDULER_MODE=trade`. If a sandbox doesn't reach a state, debug the integration or document
   the gap — never paper over it with a bypass.
4. **Any degraded input → `HOLD`.** Being wrong must cost opportunity, never solvency.
5. **Schemas in `packages/shared` change only with team agreement.**
6. **No secrets in code or commits; no mainnet keys in this repo, ever.**
7. **Small PRs, conventional commits, typecheck + tests green before merge.**
8. **When code and docs disagree, code wins** — fix the doc in the same PR.

## Conventions & gotchas

- **Units**: ALL amounts are 6-decimal USDC base units as strings (`Decision.amountUsdc`, contract
  pools, forecasts). Arc's 18-dec native accounting is converted only at the contract's
  native-value boundaries (`SCALE = 1e12`). Never mix the two views; never floats in money math.
- **Idempotency**: on-chain `decisionId = keccak(inputsHash ‖ kind)` — wall-clock-independent so
  retries collide on the contract's replay guard. Don't "fix" this into a timestamped id.
- **Executor lifecycle** (§17.6): strictly serial, one in-flight tx; FAILED/stuck → throw → HOLD +
  alert; never blind-retry a money movement.
- Circle API quirks: first request from a fresh process may ECONNRESET (retry once); SCP
  `description` field is strictly alphanumeric; faucet needs a human click (bot detection).
- Local EVM sims (anvil/hardhat-network) cannot reproduce Arc semantics — the `arc-verify` CI
  workflow against real-EVM behavior is the source of truth for contracts.
- ASCII diagrams for non-trivial flows; keep them accurate in the same commit that changes the code.

## gstack (optional tooling)

If you run gstack: use `/browse` for web browsing (never `mcp__claude-in-chrome__*` directly);
`/ship` for PRs, `/investigate` for bugs, `/context-save` / `/context-restore` across sessions.
Not required to contribute.
