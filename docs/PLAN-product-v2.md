# PLAN v2 — the product: an agentic CFO a real SMB would actually use

_2026-07-28. Supersedes the owner/advanced-mode framing in `PLAN-product-dashboard.md`.
Written after the founder corrected the positioning._

## 0. What YIELD is (and what it is not)

**YIELD is an agentic CFO for the real economy.** In France and Europe, poor financial management
is the number one cause of company failure. YIELD abstracts corporate finance — treasury,
forecasting, currency, yield, obligations — so an owner does not have to be good at it. It aims to
manage a company's money better than the owner would.

It is already a real business offchain: paying users (€50/month), committed capital, an MVP doing
treasury automation and optimisation over offchain rails and tokenised products, a signed Akoneo
pilot, 4 LOIs, Fiteco interest, an AMF/CIF authorisation track.

**Arc/Circle is the advanced layer**, not a pivot. The founders are six-year crypto natives who
know programmatic stablecoin logic is a materially better substrate for the powerful features.

**The verifier and the ERC are a minor, back-office part.** They are technically and systemically
useful, they buy credibility with a crypto audience that respects builders who ship standards and
open source, and they may matter commercially later. **Nobody is buying a verification layer.** In
the submission they are presented as *how you can check the agent*, never as the product.

## 1. Why onchain — the honest version

Not "onchain does one thing we can't." We can do *some* of it offchain; we are good at this. The
truth is the **level**, and the combination:

| | Offchain today (what we actually run) | On Arc |
|---|---|---|
| Exit a tokenised MMF position | **<24h** (positions <€100k) | **seconds** |
| Yield reachable | 2.2% MMF · 4% tokenised structured products | institutional RWA, any ticket, 24/7 |
| Agent authority | open banking + some automation; **programmatic wire transfers are <2 years old in the UK and only just arriving on Qonto** | a bounded, revocable, provable mandate |
| Parametric insurance, options, composable terms | effectively out of reach (Alpaca for options, and that is about it) | native |
| A **fully agentically managed company** | almost impossible | the actual target |

**The claim to make:** each capability exists somewhere offchain in a weaker form. *All of them,
working together, at this level, for a company this small* — that is only possible onchain, or in a
hybrid where onchain does the advanced work.

**The regulatory path is the product thesis, not a constraint.** YIELD is on the way to **CIF**, then
**PSI / SGP with GSM — _gestion sous mandat_, discretionary management under mandate.** That is the
regulated French instrument for exactly what `AgentMandate` does on-chain: a client grants bounded
discretion, and the manager acts within it without asking permission per transaction.

The regulatory instrument and the deployed contract are **the same object expressed twice.** That is
the strongest thing in this project and it has never been said out loud in an artefact.

Consequences:
- **Build full autonomy.** Discretion is granted at mandate-granting time. The agent does not need
  per-move approval, and designing for that would contradict the licence being pursued.
- **Human approval belongs on material and structural decisions** — changing the mandate's bounds,
  a strategic reallocation, anything a real discretionary manager would escalate to the client.
  That satisfies the EU AI Act's human-in-the-loop requirement where it actually applies, and it is
  how GSM works in practice.
- **Compliance by construction.** A licensed discretionary manager that can *prove* it never
  exceeded its mandate, to a regulator or a client, from public evidence, is a genuinely new thing.
  This is where the verifier stops being back-office and quietly becomes a moat — not as a product
  we sell, but as the reason we can be trusted with the licence.

## 2. The product metaphor: a CFO who takes a brief

A CEO does not "pause" his CFO. He gives him a **vision and constraints**, and the CFO translates
that into a sane, durable financial plan and executes it with every instrument available.

So the owner's surface is not a pause button. It is:

1. **The brief** — what the owner wants: how much safety, how aggressive on yield, what is coming
   (a hire, a machine, a bad season), which currencies the business actually deals in.
2. **The plan** — what the agent will therefore do, stated before it does it, and how the picture
   changes when the brief changes.
3. **The approvals** — the decisions the agent brings back because they are the owner's to make
   (AI Act, and good practice).
4. **The record** — what it did, why, and the proof, reachable by drilling into any number.

That is *contrôle de gestion* an owner can actually operate: simpler to read than Pennylane or
Fygr, and doing more than either, because most of the work is already executed.

## 3. Multi-currency is the corporate-finance unlock

Big companies run multi-currency treasuries: EUR base, foreign balances for real trade,
hedging, and yield placed per currency and per maturity. That takes a finance team. **One agent
should do it for a company with €38k.** This is the clearest expression of the mission: give the
real economy the corporate finance that giants have.

- **EURC is the unit of account.** Floor in EURC, invariant compares EURC to EURC — same-unit, no
  oracle, the verifier stays pure. EURC is live and faucetable on Arc testnet.
- **USDC** for businesses with dollar counterparties, and as a yield/hedging leg.
- **USYC** as the Arc-native yield venue behind the existing `IVenue` seam. Note honestly that USYC
  is permissioned (issuer allowlist, KYC, professional-investor terms) — our agent wallet is
  allowlisted on testnet, and in production the seam routes each client to what they are eligible
  for: a EUR MMF for a French SME, USYC for a US or qualified entity. **The seam is the point.**

## 4. Minimum interactions for "a real SMB would use this"

Ranked. Everything is one logged-in account (no signup) as Boulangerie Chartier.

1. **Set the brief** — safety floor, yield appetite, currency mix. Changing any of them **immediately
   re-runs the forecast and shows the agent's revised plan**. This is the single most product-like
   interaction available and it is mostly compute we already have.
2. **What-if a real decision** — *"can I afford a €3,000/month hire?"* / *"what if I buy a €25,000
   oven in October?"* The agent answers with a date and a consequence. **This is the feature an
   owner would pay for**, and no SME tool does it with an agent's plan behind it.
3. **Approve a major move** — the agent proposes, the owner approves or declines, with the reason
   shown. Satisfies the AI Act human-in-the-loop and is far more interesting than pause/resume.
4. **Drill any number to its proof** — plain sentence → decision record → keccak → arcscan, in place.
5. **Pause / resume** — kept, but as a safety control, not the headline interaction.

## 5. Demo data
Synthetic Boulangerie Chartier, **calibrated on real INSEE sector data curated by Sara**. Real
economic data used for research purposes; the persona is modelled, the shape is real. Say exactly
that.

## 6. Non-goals
No signup flow. No French UI (English; one French screenshot in the deck). No Gateway, CCTP,
Paymaster, StableFX auto-swap, second implementer, AttestationRegistry — named as deliberate cuts
in the README. One earned track item only: the CFO agent paying the underwriter its premium.
