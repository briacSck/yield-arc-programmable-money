# YIELD — hackathon submission (CP3 / final)

Encode Club **Programmable Money Hackathon** (Arc / Circle) · Agentic Economy + DeFi tracks.
This file is the submission-form copy, committed so the repo carries the same story the judges
read on the platform. Everything claimed here is publicly re-checkable — the ladder is in the
[README](README.md#check-it-yourself--four-rungs-offline-first).

## Links

| What | Where |
|---|---|
| Live demo (the product, live agent data) | https://dashboard-production-abea.up.railway.app |
| 90-second self-playing version | https://dashboard-production-abea.up.railway.app/?demo=90d |
| Demo video | _Loom link lands with the final submission_ <!-- SUBMISSION TODO(briac) --> |
| One-command audit (any machine) | `npx -y https://github.com/briacSck/yield-arc-programmable-money/releases/download/v0.1.0/yield-cfo-mandate-verify-0.1.0.tgz` |
| Nightly audit verdict (tamper-evident ref) | https://raw.githubusercontent.com/briacSck/yield-arc-programmable-money/audit-log/verdicts.json |

## Project description (the short version)

YIELD is an autonomous CFO for real-economy SMBs — the businesses that fail from poor financial
management, not bad products. Our agent holds its own Circle wallet on Arc, forecasts the
company's cash, keeps an owner-set safety floor, deploys surplus USDC into yield, and pulls it
back before projected shortfalls. It has run unattended since July 14, 2026: 2,100+ cycles,
8 on-chain moves, 0 floor breaches.

What makes it hireable is the trust stack, not the yield: an ERC-8004 on-chain identity, an
owner-revocable on-chain mandate it provably cannot exceed, decision receipts binding each move
to the forecast that caused it, and a one-command verifier that replays its full history —
8 moves × 5 invariants, 0 violations. That made it insurable: a separate agent, with no keys and
no access to our systems, priced the first premium ever quoted on an autonomous agent from
on-chain evidence alone. **Bounded ⇒ insurable ⇒ scalable.**

## The choices we made, and why

- **Bounded, not autonomous.** Nobody can underwrite an agent's discretion, so we never asked
  anyone to trust it. The mandate is `require` statements, not policy in a PDF. A bounded
  mandate with a replayable history can be *priced* — that is the unlock.
- **The asymmetry.** Depositing is gated and revocable; withdrawing back to the company is
  never blocked. Even a revoked agent can always bring the money home. Being wrong must cost
  opportunity, never solvency.
- **Honest evidence over theatre.** The demo mode is loudly labelled a simulation and never
  fabricates audit verdicts or explorer links. The record keeps its 8-day RPC-outage window
  (Jul 15–23), during which the agent held every cycle rather than act on data it couldn't
  trust.
- **What we deliberately did not build** — Gateway/CCTP, Paymaster, StableFX, ERC-8183 —
  reasons in the [README](README.md#what-we-deliberately-did-not-build).

## What's behind it

A real company: one paying customer at €50/month, a signed Akoneo pilot, 4 LOIs, Fiteco
interest (~70,000 client companies), and an AMF authorisation track (CIF → PSI/SGP, *gestion
sous mandat*). The same CFO brain serves customers over offchain rails today; Arc is the same
product on its most advanced rails. The CFO agent is the wedge and the first insured customer;
the bond market for agents is the business. Positioning: [`docs/THESIS.md`](docs/THESIS.md).
