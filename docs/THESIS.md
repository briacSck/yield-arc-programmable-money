# THESIS — what YIELD is, and where the onchain layer takes it

_2026-07-28. The positioning review requested before the final restitution. Deck, video and README
draw from this; when they disagree with it, fix them, not this._

---

## 1. The four assets, in ascending order of rarity

1. **A working product shape** — forecast → decide → act under bounds. Common ambition; uncommon
   to see it run.
2. **A live unattended record with honest failure behaviour** — 14 days, 0 floor breaches, and the
   8-day degraded-data episode where the agent *held* rather than moved. Rare, and more persuasive
   than the clean part of the record.
3. **The full trust loop** — identity (ERC-8004) → mandate (bounds) → receipts (reasons) →
   verifier (anyone re-checks) → underwriter (an independent agent prices the risk) → revocation
   (fire it, money still comes home). Nobody else closes this loop. It is an **employment
   relationship for software**, end to end.
4. **The regulatory identity** — *gestion sous mandat* and `AgentMandate` are the same object
   expressed twice. Unique, and *structural*: it converts Europe's biggest disadvantage for
   autonomous finance — regulation — into the moat.

## 2. The one-sentence company

> **YIELD gives every small business the finance department only giants can afford — one AI CFO,
> hired under a contract it cannot break.**

And the bridge that resolves "which company are you" in one line:

> **One brain, two rails.** The same CFO brain that paying customers use today over offchain rails
> (open banking, tokenised MMFs, <24h) runs on Arc with better physics (seconds, enforced bounds,
> public proof). The hackathon proves the brain on the best rails; the business already charges for
> the brain on the old ones. Onchain is a migration, not a pivot.

## 3. Six pushes — where the vision goes further, honestly

### Push 1 — Balance-sheet-programmable money (the intellectual headline)
Programmable money to date means *conditions on transfers*: escrow, streams, allowances, spend
caps. YIELD's floor is computed from the **liability calendar** — the money knows what the company
owes and when. That is a new category: **money that understands a balance sheet**, and the ERC's
liability-derived floor is its standardised kernel. This claims exactly what the code does (the
forecast recomputes the bound every cycle) and nothing more — which is why it survives ERC-8226,
whose every bound is a static value a human typed.

### Push 2 — The accountant is the buyer, and the certificate is the sales document
The cabinet channel is not just distribution. Accountants sell *prudence*; they will not put their
signature next to "an AI moves your client's money" without an artifact. The underwriter's daily,
independently-priced certificate **is that artifact** — it converts the channel, it doesn't just
de-risk the product. The product for the channel is the **cabinet view**: 200 clients, one screen,
each with floor / coverage date / certificate. (Mock it for the deck; Conquest×Spiko wired 17
portfolio companies in 3 weeks over Spiko's API, so the appetite is proven by someone who wasn't
even trying to build a company out of it.)

### Push 3 — The best yield in the real economy is your own payables
Roadmap, not build: **dynamic discounting**. 2/10 net-30 ≈ ~36% annualised, risk-free to the
payer — no fund on earth competes. An agent that knows the cash calendar can safely accelerate
supplier payments for discounts, turning idle cash into margin **and** injecting liquidity into the
SME supply chain (late B2B payment is one of France's chronic killers). This makes "for the real
economy" literal: the agent's venue isn't only a T-bill fund — it's the company's own supplier
relationships. Only possible with forecast + bounds, which is exactly what exists.

### Push 4 — Compliance as a byproduct (the operating-leverage story)
A regulated discretionary manager owes: mandate documentation, activity reporting to the client,
an audit trail for the regulator. YIELD's architecture **emits all three as a side effect of
operating** — the receipts are the activity report, the chain is the audit trail, the mandate is
the mandate. Incumbents carry compliance headcount; YIELD compiles it. Marginal compliance cost of
the next client ≈ 0. That is the systems claim an a16z partner recognises, and it is honest because
the artifacts already exist and a stranger can run the check in six seconds.

### Push 5 — The what-if is the moment it becomes a CFO
Sweeping cash is a *treasurer*. "Can I afford a €3,000/month hire?" answered from the **same model
that moves the money** is judgment — the actual CFO function, and the feature an owner would pay
for on a Tuesday. In the video it should be beat two, not a footnote. It also points the roadmap
without overclaiming: financing decisions, pricing, scenario planning — the agent already holds the
model; the surface grows.

### Push 6 — EU-shaped autonomy as the contrarian moat
Everyone builds autonomous agents for permissionless settings and then can't sell them to a real
business. YIELD builds the one autonomy design a European regulator can say yes to: discretion
granted once under a mandate (GSM), human authority reserved for material decisions (where the AI
Act actually bites), machine-verifiable bounds, instant revocation with the money's path home
ungated. **"The only agent design Europe can approve" is a category-defining sentence** — and it
inverts the usual take that the EU is where autonomy goes to die.

## 4. Honesty rails — where NOT to push

- The paying customer pays for the **offchain MVP**. Never blur it into agentic-product traction.
- CIF → PSI/SGP is a **long** road (capital requirements, RCCI, programme of activity). "Track
  underway", never "imminent".
- "Agentic CFO" currently demonstrates the **treasurer leg plus one CFO moment** (the what-if).
  Scope the claim; show the road.
- The demo's set-aside pool **does not earn yet** — v2 has its USYC roles granted and the venue
  set (2026-07-31), but no position is opened and the live page renders v1's escrow. "Earns" waits
  for a real venue deposit; "machine-verified yield" additionally waits for the venue-aware
  verifier (issue #23). We say so on the screen itself.
- A mandate with caps/expiry/scope/revocation is **not novel** (ERC-8226 has it all). Stake the
  liability-derived floor only.
- Never mix euros with attested on-chain figures in one glance; the machine verdict stays in
  machine units.

## 5. Where each piece lands

| Claim | Artifact |
|---|---|
| One brain, two rails | Video 0:00–0:30 · deck card 5A/5B · README top fold |
| Balance-sheet-programmable money | ERC draft conclusion · deck card 11C · video close |
| Certificate converts the channel | Deck 11B (channel) + underwriter card · README underwriter row |
| Dynamic discounting roadmap | Deck card 12 ("where it goes") — one bullet, no build |
| Compliance as byproduct | Deck 11C speaker notes · the a16z conversation |
| What-if = CFO moment | Video beat 2 · the live demo click path |
| EU-shaped autonomy | Deck 11C bottom line · ERC security-considerations |
