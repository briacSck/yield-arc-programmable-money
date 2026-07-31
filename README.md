# YIELD — the agentic CFO for the real economy

In France and Europe, **poor financial management is the number one cause of company failure** —
not bad products, not weak demand. A small business owner is a baker, a builder, a designer; they
are not a CFO and cannot afford one. YIELD is the CFO they hire anyway: it forecasts the cash,
keeps a safety floor the owner sets, puts the surplus to work, pulls it back before payroll, and
answers the question owners actually ask — *"can I afford this hire?"* — from the same model that
moves the money.

**This repo is that product on its most advanced rails.** The same CFO brain our paying customers
use today over offchain rails (open banking, tokenised money-market funds, <24 h exits) runs here
on [Arc](https://arc.network): settlement in seconds, bounds enforced by a contract instead of a
promise, and a public record anyone can re-check. One brain, two rails — onchain is a migration,
not a pivot.

## The business behind the demo

- **A paying customer today, at €50/month** (one — we don't round up), and capital committed
  through the tool.
- **A signed pilot with Akoneo, 4 LOIs, interest from Fiteco** (an accounting network of roughly
  70,000 client companies) — accountants are the channel, because they hold the client
  relationship and they sell prudence.
- **An AMF authorisation track underway: CIF, then PSI/SGP with *gestion sous mandat*** —
  discretionary management under mandate, the regulated French instrument for exactly what the
  on-chain `AgentMandate` implements. The licence and the contract are the same object expressed
  twice; the verifier below is how a three-person company earns institutional trust with
  mathematics instead of a balance sheet.

## The demo, live

**🟢 Unattended on Arc testnet since July 14, 2026.** Honest version: for 8 of those days
(Jul 15–23) an RPC outage degraded the agent's data feed — and it **held**, every cycle, rather
than move money on inputs it couldn't trust. That is invariant #4 working, not the record's
asterisk. We found it, removed the single point of failure, and verified end-to-end that the
alert which would have caught it now fires.

[![nightly audit](https://github.com/briacSck/yield-arc-programmable-money/actions/workflows/nightly-audit.yml/badge.svg)](https://github.com/briacSck/yield-arc-programmable-money/actions/workflows/nightly-audit.yml)
<!-- The npm badge is intentionally absent until the package is published: it resolves against a
     package that does not exist yet and renders as an error at the top of the front page. A missing
     badge costs less than a broken one on a project whose pitch is that its claims check out. -->

- **Live dashboard:** https://dashboard-production-abea.up.railway.app — every decision, its
  reason sentence, and its on-chain receipt, with explorer links, plus a **machine-audit
  scoreboard**: 5 invariant chips checked nightly by the verifier.
- **The 90-second version:** [the same product replaying a full simulated quarter](https://dashboard-production-abea.up.railway.app/?demo=90d)
  (`?demo=90d`) — deploy, pull-back before a crunch, a commodity shock, and the owner revoking
  mid-quarter with the mandate blocking the agent's next move. Loudly labelled a simulation; it
  never fabricates audit verdicts or explorer links.
- **The mandate (on-chain):** [`0x856bec6faadd61b583430e0cd22ec2e211c782b4`](https://testnet.arcscan.app/address/0x856bec6faadd61b583430e0cd22ec2e211c782b4)
  — floor, per-ticket cap, 24h budget, owner-revocable.
- **Agent identity:** ERC-8004 agentId `850878` · agent wallet [`0x93d9…ab7c`](https://testnet.arcscan.app/address/0x93d9c11c8e9e23e1e97e855668a27a14accaab7c)
  (Circle developer-controlled wallet).
- **Machine-checked autonomy:** the verifier replays the agent's FULL on-chain history and checks
  every move against the mandate's five invariants (floor / ticket / budget window /
  post-revocation asymmetry / decision receipts). The live history verifies **COMPLIANT in ~6 s**,
  and the same tool run against a rogue agent **fails it, 13 violations**. How to run it, offline
  or live: [Check it yourself](#check-it-yourself--four-rungs-offline-first).

Built on: **Circle Wallets** (developer-controlled, MPC) · **Circle Contracts (SCP)** ·
**native-USDC gas on Arc** · **ERC-8004 identity** · **USYC** (tokenized MMF, the yield venue
behind `AgentMandateV2`).

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
| `contracts/` | `AgentMandate` (the live on-chain mandate) + `AgentMandateV2` (venue-aware: subscribes the deployed surplus into an ERC-4626 yield venue, deploys *alongside* v1 so v1 keeps its record) + 68 Hardhat tests |
| `agent/` | Node worker: forecast client · decision engine · `ChainExecutor` · scheduler · heartbeat |
| `forecast/` | deterministic baseline forecast (+ optional proxy to the t0 model service) |
| `scenario/` | seeded-ledger generator + simulated-clock demo driver |
| `dashboard/` | **the product**: the owner's screen (the answer, the brief, "can I afford it?", what the agent did) with the full machine-checked record on the same page — every line drills in place to its hash and transaction. Next.js, on Railway |
| `verifier/` | judge-runnable invariant verifier (`@yield-cfo/mandate-verify`) — two-layer (fetch → **pure, zero-I/O replay core**), machine-checks the 5 mandate invariants over full live history in one command. 20 tests including compliant-adversarial fixtures a naive verifier would wrongly flag, plus a golden test against real testnet history |
| `underwriter/` | an **independent** Claude Managed Agent that prices insurance on the CFO agent from its on-chain mandate + verified history — read-only by construction (no keys, no transactions), disclosed `stub-v0` premium. **6 scheduled runs completed; the daily schedule is currently archived and it runs on demand** — the history and memory store carry over if rescheduled. Why this matters beyond a demo: the market for insuring AI judgment is real — Lloyd's now backs an AI-liability policy (Armilla) and AIUC-1 is a certification standard for agentic AI — and **nobody applies any of it to onchain treasury agents**. Bounded ⇒ insurable ⇒ scalable; the certificate is also what lets an accountant put their signature next to the recommendation |

## Status

Encode Club "Programmable Money Hackathon" (Arc / Circle), Agentic Economy + DeFi tracks.
**Deployed and autonomous since Jul 14**: two Railway services (worker loop + dashboard),
heartbeat-monitored, trade mode at live mandate caps. Shipped since: the product screen (the
owner's brief, "can I afford it?", proof-in-place drill-downs), working owner controls signed by
the company's Circle wallet behind a passphrase gate, the verifier + nightly audit, and the
venue-aware `AgentMandateV2`
([`0xd41d…2f70`](https://testnet.arcscan.app/address/0xd41d3648c71641fb2801415726787d5728492f70),
deployed alongside v1). On Jul 31 Circle granted v2 **both USYC allowlist roles** (verified
against the Teller's `RolesAuthority`) and the owner
[set the venue](https://testnet.arcscan.app/tx/0x00e6ed513c23e74404d7d484d699ec3ff271b20ad23235b2c7235e930a20b37c)
to the USYC Teller — v2's deployed leg now routes into the tokenized MMF (no position opened yet;
v1 keeps the live record). Positioning and
where this goes: `docs/THESIS.md`. Build invariants for humans and AI agents: `AGENTS.md`; live
state: `docs/NOW.md`; deferred items: `TODOS.md`.

## Check it yourself — four rungs, offline first

Each rung is independent. Rung 1 comes before rung 2 deliberately: it is faster, works behind any
firewall, and it is the one that still answers if the public Arc endpoints are rate-limiting.

| | What | Cost | If it fails |
|---|---|---|---|
| **0** | Watch it: [the live dashboard](https://dashboard-production-abea.up.railway.app) · or [a full simulated quarter in 90 s](https://dashboard-production-abea.up.railway.app/?demo=90d) | 0 s | — |
| **1** | **Offline proof**, no network once installed: `git clone … && cd yield-arc-programmable-money && npm install`, then `npx tsx verifier/src/cli.ts --fixture live-snapshot` (exits 0) and `--fixture naive-agent` (a rogue agent, **13 violations, exits 1**) | ~15 s install, ~1 s run | nothing to fail |
| **2** | **Live history**: `npx tsx verifier/src/cli.ts` — replays every move the agent ever made against all five invariants | ~6 s | falls back to rung 1, exit code 2 |
| **3** | **Read it**: the entire invariant logic is `verifier/src/core/replay.ts`, zero I/O. Then `npm test -w verifier` | ~2 s | — |

Exit codes are a contract: **0** compliant · **1** a real violation (the tool working) · **2** an
operational problem, nothing proven either way.

> **`npx -y @yield-cfo/mandate-verify` is not live yet.** The package is built and ready but not
> published, so that command 404s today. Use the clone path above until this note disappears.

## Developing

```bash
npm install
npm run typecheck
npm run test          # 209 tests across 6 workspaces
```

Contracts (Hardhat 3 — **must run on x64**; there is no `solidity-analyzer` build for Windows
ARM64, so use CI or WSL):

```bash
cd contracts && npm install && npm run compile && npm test   # 68 tests
```

## What we deliberately did not build

Named, because a hackathon submission that lists every logo on the track card is less honest than
one that says where it stopped:

- **Gateway / CCTP** — a bakery has no cross-chain problem, and Unified Balance is USDC-only, so
  the "unified euro balance" premise fails on contact. One venue, on Arc, is the honest scope.
- **Paymaster** — gas on Arc is already native USDC. Sponsorship would add a dependency, not remove
  one. We kept the gas-exhaustion guard instead and page on it.
- **StableFX auto-conversion** — the FX exposure is real and is written up in the standard draft.
  Automating a swap we do not yet need would be motion, not progress.
- **A second ERC implementer** — one recruited in a week is a friend doing us a favour.
- **ERC-8183 agent-to-agent settlement** — promised in our first checkpoint blurb, honestly
  unbuilt. The named first use when it lands: the CFO agent paying the underwriter its premium.
- **French UI** — the product's market is French; this audience is not.

## License

MIT — see [`LICENSE`](LICENSE).
