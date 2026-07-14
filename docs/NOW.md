# NOW — living state

> **Committed + team-shared** (the repo is public — keep strategy/competitive notes in the local
> `docs/PLAN.md`, never here). Updated at every standup (owner: whoever ran standup). This is how
> N parallel agents/humans stay coherent without meetings. Every session starts by reading it;
> every session that changes state updates it in the same PR.

_Last updated: 2026-07-14 evening (DAY 2: Integration #1 COMPLETE — two days early)_

## Deployment URLs + addresses

| Thing | Value |
|---|---|
| **AgentMandate (LIVE)** | **`0x856bec6faadd61b583430e0cd22ec2e211c782b4`** — floor 5 / ticket 2 / dailyCap 5 USDC (demo values, 6-dec pools) |
| **ERC-8004 agent identity** | **agentId `850878`** on IdentityRegistry `0x8004A818…BD9e` — registered from the agent wallet |
| Agent wallet (EOA, Circle) | `0x93d9c11c8e9e23e1e97e855668a27a14accaab7c` |
| Company wallet = mandate OWNER | `0x4704fb05a6e87c482090cf5534e86c9ab44bbfda` |
| Arc RPC / Explorer | `https://rpc.testnet.arc.network` / `https://testnet.arcscan.app` |
| Dashboard URL | _(not deployed yet — Railway, W2; event-log.jsonl is its contract)_ |

## DAY 2 — what shipped (all pushed, CI proves the contract suite)

**Integration #1 (§8.1 Thursday's milestone) ran END-TO-END on testnet:** live on-chain state →
`baselineForecast` → `decide()` → `CircleChainExecutor` → `AgentMandate`, five beats, each
asserted against on-chain pool state:
1. **First autonomous DEPLOY** `0x918b867b…a760a5` (0.9859 USDC surplus above the P10-guarded floor; forecast hash committed on-chain as the receipt)
2. **revoke()** by owner `0x49d0a4dc…62c756` — "you can fire your CFO agent"
3. **deposit-while-revoked BLOCKED** (Circle tx FAILED on MandateRevoked — recorded proof)
4. **WITHDRAW while revoked CONFIRMED** `0xc9e7fcb0…6bfda3` — fail-safe asymmetry live
5. **reinstate()** `0x6f23550c…b6ac60d`

**Code landed:**
- `decide()` (§16.3) — BigInt rule, ceil floor rounding, withdraw-wins priority, clamps, horizon
  guard, judge-legible reasons; 5 property invariants + 9 unit tests (21 agent-side tests total for engine+executor).
- `baselineForecast()` (§16.4) — rational k (no floats), canonical reorder-invariant `inputsHash`,
  negative-clamp, 3-month-boundary calendar tests; 8 tests.
- `AgentMandate.sol` — full implementation: 6-dec pools + `SCALE=1e12` native boundary,
  addition-form floor gate (no underflow panic), fixed 24h budget window (boundary-tested),
  constructor validation, CEI on `emergencyWithdrawAll`; **18-case suite** un-skipped (CI-verified).
- **Scheduler (Tier-1 loop)** — `runCycle`/`startScheduler` with observe|trade modes
  (observe = default, money CANNOT move), live mandate balance reads, JSONL event log with
  seq-resume, heartbeat w/ 5s timeout; 7 tests. **Loop STARTED 2026-07-14 in observe mode**
  (15-min cycles, local machine — move to Railway for true uptime, W2).
- Executor hardening: `onChainDecisionId = keccak(inputsHash‖kind)` (wall-clock-independent —
  retries collide on-chain), timeout re-check before throwing.
- Scripts: `compile-mandate` (solc-js WASM), `deploy-mandate` (spike gate + SCP fallback),
  `register-identity` (idempotent via balanceOf), `e2e-first-decision` (the 5-beat run).

## Spike-gate verdicts + gotchas (for Vadim)

- **Raw `signTransaction` deploy: NOT supported on ARC-TESTNET** (Circle error 156027) — kept as
  first-try in the script so the gate reopens if Circle enables it. **SCP `deployContract` works**
  (`@circle-fin/smart-contract-platform`) and is the deploy path from this machine; your Hardhat
  path stays canonical for iteration.
- Circle SCP `description` field is strictly **alphanumeric** — a hyphen 400s the deploy.
- IdentityRegistry is an **ERC-721**: `register(string agentURI)` mints to msg.sender;
  `balanceOf(agent)` is the idempotency read. Our agentURI = the repo URL (upgrade to an
  agent-card JSON later via `setAgentURI`).
- api.circle.com still ECONNRESETs on first request from a fresh process — retry once.
- Observe-loop note: live balances (~9 USDC) + Boulangerie fixture ledger (38k scale) →
  coherent HOLDs; the W2 scenario driver reconciles scales (fixture wallet-level ledger ↔
  on-chain pools).

## Open items / next critical path

1. **Venue seam decision (Vadim nod needed, Wednesday standup):** add owner-settable `IVenue` to
   AgentMandate before HIS deploy iteration — makes the W2/W3 USYC swap a `setVenue()` call
   instead of a redeploy. (Approved-deferred at the /autoplan gate; extends pinned §17.2.)
2. **Railway deploy of the observe loop** (true Tier-1 uptime + heartbeat) — W1 Fri lane, now
   unblocked; `npm start --workspace agent`, env per `.env.example`.
3. Dashboard v1 reads `event-log.jsonl` (schema pinned in `packages/shared/src/event-log.ts`).
4. USYC allowlist ticket ⏳ (submitted? — draft below if not). Then the Teller adapter behind the
   venue seam.
5. CP1 blurb (§10) on the platform — submit Saturday.

## USYC allowlist ticket — paste at support.circle.com (if not yet sent)

> Subject: Arc Testnet USYC allowlisting request (hackathon — Programmable Money / Agentic Economy)
> We're building an autonomous treasury agent on Arc Testnet for the Encode x Circle Programmable
> Money Hackathon (Agentic Economy + DeFi tracks). The agent sweeps SMB surplus USDC into USYC via
> the Teller under an on-chain mandate. Please allowlist our Arc Testnet address for testnet USYC:
> `0x93d9c11c8e9e23e1e97e855668a27a14accaab7c` (Circle developer-controlled wallet).
> Team: YIELD (yield-arc-programmable-money). Thank you!

## Reminders

- The 5-beat e2e IS the demo-day kicker footage source — Sara: arcscan links above are B-roll.
- Never cut: Tier-1 uptime, decision receipts, mandate revoke, video quality, submit Aug 8.
