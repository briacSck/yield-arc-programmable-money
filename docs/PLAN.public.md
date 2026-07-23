# YIELD — Arc Hackathon: "Agentic CFO on Arc" — Public Build Plan

> **Sanitized, team-shareable extract** of the internal strategy plan (`docs/PLAN.md`, which stays
> local). This copy carries the **technical build spec** — scope, deployment ladder, week plan,
> architecture, and the Fiduciary Standard track — with strategy removed: regulatory positioning,
> pilot-company names, personal contacts, and competitive/disclosure timing live only in the private
> plan. Where something was cut, it's marked _[strategy — see private plan]_. This repo is PUBLIC;
> **build state belongs here, strategy never does** (AGENTS.md). Last synced: 2026-07-23.

---

## 1. Goal hierarchy

Win the Encode Club "Programmable Money Hackathon" (Arc / Circle), **Agentic Economy + DeFi**
tracks, with an autonomous treasury agent that is *credible* because it is *bounded* — a CFO would
actually hire it. Secondary: a reusable trust-layer artifact (the Fiduciary Standard, §18) that
outlives the hackathon.

## 3. Thesis (one sentence)

An autonomous CFO agent that holds its own Circle Wallet on Arc, forecasts a company's cash
position, and keeps a safe operating floor while sweeping surplus USDC into yield — pulling funds
back *before* projected shortfalls — every action signed under a verifiable on-chain identity
(ERC-8004) and bounded by an owner-revocable on-chain mandate.

## 6. Scope — MVP / planned / stretch

- **MVP (shipped):** autonomous forecast→decide→deploy/withdraw loop on Arc testnet · Circle Wallets
  agent wallet · USDC-gas settlement · ERC-8004-signed actions · live hosted dashboard · runs
  unattended on a schedule.
- **Planned (W3, cheap + judge-visible):**
  1. **Nanopayments / ERC-8183** — the CFO agent pays a specialist forecaster-agent per inference in
     USDC micro-payments (agent-to-agent commerce). Arc ships a native job-settlement standard
     (ERC-8183: create job → fund USDC escrow → submit deliverable → settle); decide raw-x402 vs
     ERC-8183 at W3 kickoff on which integrates faster. Timebox: cut if it fights back > 3 days.
  2. **Exposure-aware floor (SPICE leg)** — the agent raises its safe floor when input-cost exposure
     spikes ("the bakery's flour line IS wheat"). Reuses the deterministic exposure engine.
  3. **On-chain decision receipts (SHIPPED)** — each decision hashes the forecast snapshot it acted
     on into the settlement event; anyone can replay *why* the agent moved money.
  4. **Agent mandate (SHIPPED)** — `AgentMandate`, the agent's owner-granted, owner-revocable
     on-chain employment contract it provably cannot exceed. Identity + mandate + receipts = the
     full trust stack.
- **Risk-protection stretch — Option A chosen and SHIPPED:** the **underwriter agent** (agentic
  insurance). Prices cover for the CFO agent from its on-chain mandate + verified history.
  **Realized 2026-07-22 as a Claude Managed Agent (`underwriter/`)** — the *assessment + pricing*
  half (disclosed `stub-v0` premium, daily certificate); on-chain parametric-cover escrow + oracle
  trigger and ERC-8183 premium *settlement* stay roadmap. (Option B — a cross-chain Hyperliquid
  hedge leg over CCTP — was the higher-risk alternative, not built; _[strategy — see private plan]_.)
- **Explicitly OUT:** multi-agent swarms for their own sake; LLM-driven decisioning (a deterministic
  rule + a real forecast beats a black box on "clear decision logic tied to real signals").

## 7. Deployment ladder

- **Tier 0 (required):** MVP on Arc public testnet; dashboard publicly reachable; contract addresses
  verified/linked from the README. ✅
- **Tier 1 (the differentiator):** the agent runs **continuously, unattended, on a schedule**,
  accumulating a multi-week on-chain track record. "It's been running since July 14 — here's the
  explorer history" is the Demo Day line. Uptime-monitored. ✅ deployed 2026-07-14.
- **Tier 2 (stretch):** Arc mainnet / private-testnet if access opens; and/or **pilot mode** — the
  deployed agent fed by a real anonymized company ledger. _[pilot specifics — private plan]_

## 8. Team & week plan

Three contributors (a product/decision-engine + narrative owner, a CTO on contracts + Circle
integration + infra, and a video/deck/community owner). Parallelization principle: the chain track
and the decision track never wait on each other — they meet only through the pinned interfaces of
§16 (decision track codes against `MockChainExecutor` + forecast fixtures; chain track codes against
fixture `Decision` objects).

| Week | Dates | Build | DoD |
|---|---|---|---|
| **W1** | Jul 13–19 | repo · agent wallet (Circle) · deploy SweepEscrow→AgentMandate · ERC-8004 identity · first agent-signed USDC tx · CI green | Agent autonomously sends a USDC tx on testnet under ERC-8004 identity; CP1 submitted early |
| **W2** | Jul 20–26 | *(engine + scheduler + baseline forecast + dashboard + Tier-1 trade loop + heartbeat pulled forward to Jul 14)*. CP2 submission · chaos drill · **§18: verifier over FULL live history · audit view · ERC draft** | CP2 submitted; loop uptime unbroken; **verifier passes 5/5 in one command** (✅ core shipped 2026-07-23); audit view live; draft in repo |
| **W3** | Jul 27–Aug 2 | Nanopayments/ERC-8183 beat · exposure-floor leg · scenario driver · **§18: underwriter beat (✅ shipped 2026-07-22) · second implementer + attestations (gated)** | §6 "planned" in or consciously cut; two agents under one interface (gated) |
| **W4** | Aug 3–9 | **Feature freeze Aug 5** · video · deck · judge docs · **submit Aug 8** | Final submission in, every link public, 24 h before lock |
| **W5–6** | Aug 10–20 | Demo Day pitch around the live track record · keep agent alive | Live pitch < 5 min; uptime unbroken |

## 15. Execution OS (ops that matter for the build)

- **Cut order** (invoked without debate when a week's DoD slips ≥ 2 days): §18 items enter FIRST
  (they're the standard lane, first to yield); never cut Tier-1 uptime, decision receipts, mandate
  revoke, video quality, or the Aug 8 submission.
- **Monitoring:** heartbeat ping every cycle (healthchecks.io); missed ping → alert < 15 min;
  dashboard `/health` is content-based (a FAILED storm or gas-dead agent reads degraded even when
  records are fresh). **Weekly Friday chaos drill: kill the worker, verify the alert fires.**
  _(2026-07-23 incident: an 8-day silent RPC outage slipped past this because the process stayed UP
  while every cycle failed — the heartbeat now `/fail`-pings on 3 consecutive FAILED cycles too. See
  NOW.md.)_
- **Secrets:** testnet-only keys, never committed; **no mainnet key ever touches this repo.**

## 16. Build spec (for humans AND AI coding agents)

**16.1 Stack & layout:** single monorepo, TypeScript everywhere (viem for chain). AI-agent bootstrap:
Circle Agent Skills + Circle CLI + codegen MCP + arc-docs MCP; lean on those rather than guessing.

```
├── AGENTS.md           ← invariants + module map (committed)
├── docs/NOW.md         ← living state (committed); docs/PLAN.md strategy (local)
├── packages/shared/    ← zod schemas = THE interface contracts
├── contracts/          ← SweepEscrow → AgentMandate + Hardhat tests
├── agent/              ← worker: forecast client · decision engine · ChainExecutor · scheduler · heartbeat
├── forecast/           ← deterministic baseline (+ optional proxy to the model service)
├── dashboard/          ← Next.js, on Railway
├── scenario/           ← seeded ledger + simulated-clock driver
├── verifier/           ← @yield-cfo/mandate-verify — invariant verifier (W2)
└── underwriter/        ← Claude Managed Agent that prices insurance (W3 §18 beat)
```

**16.2 Interface contracts (pinned Day 1, `packages/shared`, zod):**

```ts
ForecastResult { asOf, horizonDays, series: [{ date, p10, p50, p90 }], modelId, inputsHash }
Decision       { id, ts, kind: 'DEPLOY'|'WITHDRAW'|'HOLD'|'FLOOR_RAISE', amountUsdc,
                 floorUsdc, reason, forecastInputsHash, exposure? }
ChainExecutor.execute(d: Decision) → { txHash, explorerUrl, identitySig, receiptHash }
```

ALL money movement goes through `ChainExecutor` — one module, no exceptions. `MockChainExecutor`
implements the same interface, selected ONLY by explicit env flag. The dashboard reads one API route.

**16.3 Decision rule (config, not code debate):**

```
safe_floor = max(USER_MIN, 0.90 × min(balance, trailing 30d)) + exposure_uplift
deploy     = balance − max(safe_floor, min(p10, next 30d))     execute if ≥ MIN_TICKET
withdraw   = if min(p10, next HORIZON) < safe_floor → withdraw the projected shortfall
FAIL-SAFE  = stale inputs (>24h) or forecast error → HOLD + alert
```

**Being wrong must cost opportunity, never solvency.** Property-test this rule first (floor never
breached by an agent action; HOLD on any degraded input) — those tests are the repo's contract.

**16.4 Deterministic baseline forecast:** p50 = current balance + known AR/AP by due date +
detected recurring events; p10/p90 = p50 ∓ k·σ(trailing 60d daily deltas)·√t. One file, explainable;
the model service upgrades `modelId` later without touching any consumer.

**16.5 Demo data:** persona **"Boulangerie Chartier"** — a French SME bakery (payroll on the 28th,
URSSAF on the 5th, flour ≈ 14% of costs, seasonal revenue), scaled 1:3800 onto a ~10 USDC pool with
a 5 USDC floor so the P10 tail crosses the floor pre-payroll (recall) and clears it after late-month
revenue (deploy) — a monthly rhythm of small, cap-bounded, real on-chain moves. Fixed seed; the
scenario driver replays bit-identically for the video.

**16.6 Invariants — never violate** (verbatim in AGENTS.md): (1) all money movement through
`ChainExecutor`; (2) decision logic pure + config-driven, property tests green, no wall-clock in
`decide()`; (3) never fake on-chain results in a default path (`MockChainExecutor` only behind an
explicit flag; money moves only in explicit trade mode); (4) any degraded input → HOLD; (5) shared
schemas change only by team agreement; (6) no secrets/mainnet keys in the repo; (7) small PRs,
conventional commits, typecheck + tests green; (8) code wins over docs — fix the doc in the same PR.

## 17. Chain architecture

**17.1 Flow of funds:**

```
  ERC-8004 IdentityRegistry (Arc testnet — registered)
      ▲ resolve(agentAddr) → agentId                 [observer/judge verification path]
      │
  CompanyWallet ──deposit(amount, decisionId, forecastHash)──► AgentMandate (escrow)
  (USDC, Arc)   ◄─withdrawToCompany(amount, decisionId, fh)──  holds deployed surplus
      ▲                              each call emits DecisionExecuted(...)
      │ owner-only: setMandate / revoke / emergencyWithdrawAll
   Owner (human) — can always exit, can always fire the agent
```

**17.2 `AgentMandate` (extends the vendored `SweepEscrow`):** roles `owner` / `agent`; mandate
`floorUsdc` / `maxTicketUsdc` / `dailyCapUsdc` / `revoked`. **The asymmetry IS the thesis:**
`deposit` (risk-adding) is triple-gated (floor, ticket, 24h budget window) and blocked when revoked;
`withdrawToCompany` (risk-reducing) is NEVER gated — even when revoked. Decision receipts =
`forecastHash` in `DecisionExecuted` (event-only). **The 24h cap is a lazy tumbling window** (resets
24h after it opened, so up to 2× `dailyCap` can legally deploy across one boundary) — the exact
semantics the verifier replays.

**Idempotency (pinned, code-authoritative):** `decisionId = keccak(utf8("<forecastInputsHash>|<DEPLOY|WITHDRAW>"))`
(`agent/src/chain/circle-chain-executor.ts`). The on-chain `forecastHash` arg IS that same
`forecastInputsHash`, so the receipt is verifiable purely on-chain. _Errata: the contract NatSpec and
an earlier §17.2 note claiming `keccak(inputsHash ‖ window)` / `‖ asOf` are wrong — code wins; the
contract is frozen, the docs get fixed. Confirmed against all live events 2026-07-23._

**17.3 Signing:** Circle developer-controlled wallet (MPC, EOA), proven on Arc testnet via
`createContractExecutionTransaction`. Strictly-serial executor, deterministic idempotency key,
FAILED → throw → HOLD + alert (never blind-retry a money movement).

**17.4 Yield venue:** default **USYC** (real tokenized-MMF testnet primitive) behind the
`ChainExecutor`/mandate seam, gated on allowlisting; fallback is an explicitly-labeled DEMO ACCRUAL
(never display fake yield as real). **REAL, round-trip proven on-chain 2026-07-23** — the USYC
Teller (`0x9fdF…C105A`) is an ERC-4626 vault (asset = USDC, share = USYC). The agent wallet is
allowlisted (`subscriptionLimitRemaining` = 1,000,000 USDC/day) and executed a full round-trip:
subscribe 1 USDC → 0.883398 USYC (deposit `0x46b1dba7…`), redeem → 0.999903 USDC (`0xfd6e3a65…`).
Kit: `agent/scripts/usyc-mint-test.ts`; venue seam: `agent/src/chain/usyc-venue.ts` (`IVenue` —
read-only previews/allowlist + money-move call specs the `ChainExecutor` signs, never moving money
itself). **Not yet wired into the live loop** (frozen mandate + untouchable executor) — wiring USYC
as the mandate's deploy target is the next gated step; the round-trip already stands as a real
DeFi-track beat.

**17.5 Toolchain:** Hardhat (proven `arc-verify.yml` real-EVM CI is the source of truth — local
anvil/hardhat-network cannot reproduce Arc semantics: native-USDC rules, `PREVRANDAO`=0, EIP-7708
Transfer logs).

## 18. The Fiduciary Standard track

**Thesis:** every trust rail bounds *spending* (AP2 mandates, Permit2/session keys, x402, escrow);
nothing bounds an agent exercising *financial judgment over managed money*. YIELD's mandate +
receipts are the reference implementation of that missing leg. Generalized: **identity (ERC-8004) ·
work (ERC-8183) · stewardship (this)**. Business spine: **bounded ⇒ insurable ⇒ scalable.**

**18.1 W2 deliverables (the A-floor):**

1. **Verifier — the star (✅ core shipped 2026-07-23).** `@yield-cfo/mandate-verify` — two-layer:
   a fetch layer (chain → `NormalizedEvent[]`) + a **pure** replay/check core that machine-checks
   the 5 invariant predicates over full history. **Runs live 5/5 COMPLIANT in ~6 s.**
   - **Invariant 3 = EXACT lazy-tumbling-window replay** (reset iff `ts ≥ windowStart + 86400`;
     `setMandate` doesn't reset, `emergencyWithdrawAll` doesn't touch window state). A naive rolling
     24h sum produces **false VIOLATIONs on legal history** — the dominant failure mode, since live
     history is compliant by construction.
   - **Receipt check is pure-chain** — `decisionId = keccak(forecastHash|kind)`, no preimage API.
   - **Violating fixtures = the test suite = the negative demo:** one catch-fixture per invariant
     (`--fixture naive-agent`, exits 1, 13 violations) + a **compliant-adversarial** suite the
     verifier must NOT flag + a **golden test** against real testnet history. 17 tests.
   - **Fetch:** one address-only `getLogs` per chunk, `parseEventLogs({strict:false})` (tolerate Arc
     EIP-7708 native-transfer logs), order by `(blockNumber, logIndex)`, chainId preflight.
   - **DX:** zero-config default, `--fixture` / `--address` / `--deploy-block` / `--rpc` / `--json`,
     exit codes 0 (compliant) / 1 (violation) / 2 (operational). Deploy block **51743317** pinned.
   - **Remaining for CP2:** npm publish (`--provenance`), nightly-audit CI → `audit-log` git ref →
     dashboard `audit` block, the design-pinned scoreboard band. See TODOS.
2. **Audit surface** on the dashboard (✅ SHIPPED 2026-07-23) — a scoreboard band above the decision
   log (5 invariant chips + "N moves × 5 invariants — 0 violations" + closest-approach-to-floor stat)
   + hero wiring (the claim strip's first number IS the machine verdict) + per-row verdict chips.
   Vocabulary: `PASS / VIOLATION / PENDING / UNVERIFIED` — never "FAIL(ED)". **No data-plumbing
   failure ever renders red — red means the verifier spoke** (the proxy validates the feed and
   returns null on anything malformed). Verdicts arrive via nightly CI (`nightly-audit.yml`) →
   `audit-log` ref → proxy splice into `/api/events`, joined dashboard-side on `txHash`. Live now.
3. **ERC draft** (✅ DRAFTED 2026-07-23, v0.1): interface + 5 invariants + exact tumbling-window
   pseudocode + receipt derivation + normative conformance vectors + a **prior-art falsification
   section** that formally attempts expressing floor/caps/asymmetry/receipts in AP2, Permit2/session
   keys, ERC-8183 SLA terms, **and the DeFi manager-policy frameworks that are the actual closest
   prior art** (Enzyme policy manager, Gnosis Zodiac Roles Modifier, dHEDGE/Set). Stated up front:
   bounds-on-discretion alone won't survive; the surviving claim is the triple — **decision receipts
   + asymmetric post-revocation authority + on-chain agent identity, machine-checkable over full
   history**. _Draft is held private until Demo Day per the disclosure strategy; the reference
   implementation (live `AgentMandate`) and checker (`@yield-cfo/mandate-verify`) are already public._

**18.2 W3 deliverables (gated, priority order):**

4. **Underwriter-agent beat (✅ SHIPPED 2026-07-22 — `underwriter/`).** An arm's-length agent prices
   cover for the CFO agent from its on-chain mandate + verified history — `premium = f(floor, caps,
   verified history)` as a **disclosed `stub-v0`** formula. Built as a **Claude Managed Agent**
   (hosted, daily-scheduled, Outcome-graded): reads the live `AgentMandate` getters via viem + the
   public `/events`, strictly read-only (no keys, no tx), issues `certificate.json` + `memo.md` per
   run. First run graded **satisfied**, premium **0.0851 USDC/30d**. Machine-verify path wired (tries
   `npx -y @yield-cfo/mandate-verify`, flips `verification.mode` with zero code change). Human-gated
   bind flow kept OFF the unattended schedule. **Deferred:** ERC-8183/x402 premium *settlement* +
   on-chain parametric-cover escrow + oracle trigger — the CMA delivers assessment + pricing;
   settlement is the next layer.
   - **How it relates to the standard (the synthesis):** the CMA underwriter and the on-chain/ERC
     leg are **complementary layers, not substitutes.** The ERC + verifier define the *substrate* —
     what makes a mandate's bounds machine-checkable and therefore *ratable*; the CMA is *one
     conforming reader* of that substrate (off-chain judgment: it reads the mandate, prices risk,
     grades itself). On-chain premium settlement (ERC-8183) is a *third* layer that closes the loop.
     None dominates: the standard says **what an underwriter reads**, the verifier proves **the
     reading is sound**, the CMA is a **live underwriter**, and settlement is **how the premium
     moves**. This session's discovery that receipt integrity is pure-chain tightens the seam — an
     underwriter (human or agent) can verify a mandate's entire history with one command and no
     trusted intermediary, which is precisely the "bounded ⇒ insurable" claim made concrete.
5. **Second implementer** (a minimal bounded yield-rebalancer under the SAME mandate interface) +
   **attestations** (periodic Merkle root over decision history; verifier checks inclusion) — built
   only if the W3 checkpoint is green. If built: the attester is a dedicated key or the owner, NOT
   the agent wallet; ACL `onlySubmitter`, append-only, no admin upgrade; attestations are additive
   evidence — the verifier NEVER treats a root as superseding raw event replay.
   _Pilot mode (real anonymized ledger) is the elevated W3 alternative — strategy/prerequisites in
   the private plan._

**18.4 Success criteria:** verifier 5/5 over full history in one judge-runnable command _(✅ core)_ ·
audit view answers the per-row "did this move risk harm?" question on camera < 10 s · negative demo
recorded _(✅ `--fixture naive-agent`)_ · _(gated)_ two agents under one interface · the 3-min video
tells "bounded ⇒ insurable ⇒ scalable" through live artifacts only · underwriter beat met _(✅)_.

**18.5 Pitch rule** (applies to every external artifact): the standard is NEVER pitched as
"replay/verify blockchain txs" (block-explorer energy) or as a groundbreaking-EIP claim. Lead with
the PRODUCT (a hireable autonomous CFO); governance = why it's hireable; insurability = the roadmap
consequence. The defensible technical claims, used only when pressed: (a) receipts bind off-chain
judgment to on-chain moves — the chain records *what*, never *why*; (b) the mandate bounds what
COULD happen, not just records what did; (c) standardization = comparability = the move that makes
bounds ratable. **Verifier = evidence, never headline.**

---

_Distribution/disclosure timing, the demand-test criteria, regulatory firewall, pilot-company
details, and competitive analysis are deliberately omitted — they live in the private `docs/PLAN.md`.
Ask the maintainer for the share copy._
