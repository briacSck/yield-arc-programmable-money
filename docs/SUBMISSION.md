# Encode "Programmable Money Hackathon" — submission pack

Paste-ready answers, one variant per field (same shape as `underwriter/SUBMISSION.md`, the house
standard). Owner: Sara drafts, Briac reviews and submits **the day before the deadline** (PLAN
§15.6). Two placeholders remain — the video and deck links — and nothing else should need editing
on submission day.

---

**Project name**

> YIELD — the Agentic CFO

---

**One-liner / tagline**

> One AI CFO for every small business, hired under an on-chain contract it provably cannot break.

---

**Description** *(pick per field length)*

**Short (2–3 sentences):**
> YIELD is an autonomous treasury agent for small businesses: it forecasts the cash, keeps an
> owner-set safety floor, puts the surplus to work and pulls it back before payroll — bounded by
> an on-chain mandate (floor, per-ticket cap, daily budget, owner-revocable) it provably cannot
> exceed. It has run unattended on Arc testnet since July 14, and a one-command verifier replays
> its full history against the mandate's five invariants, so a stranger can machine-check the
> record in about six seconds.

**Medium (add):**
> The same CFO brain already charges paying customers over offchain rails (open banking, tokenised
> MMFs) — one brain, two rails; onchain is a migration, not a pivot. The trust loop is complete
> and live: ERC-8004 identity → mandate → decision receipts (each move commits the forecast it
> acted on) → nightly machine audit → an independent Claude underwriter agent that prices
> insurance on the CFO from public data → owner revocation, with the money's path home ungated.
> Bounded ⇒ insurable ⇒ scalable.

**Honest-failure line (use it — it is the strongest part of the record):**
> For 8 of its first days an RPC outage degraded the agent's data feed — and it held, every cycle,
> rather than move money on inputs it couldn't trust. Being wrong costs opportunity, never
> solvency.

---

**Tracks**

> Agentic Economy · DeFi

---

**Built with (Circle / Arc surface)**

> Circle Wallets (developer-controlled, MPC — agent and company wallets) · Circle Contracts (SCP —
> both mandates deployed through it) · Arc testnet (native-USDC gas, sub-second settlement) ·
> USYC (tokenized MMF, the yield venue behind AgentMandateV2) · ERC-8004 (agent identity).

---

**Links** *(every one opened in an incognito window before submitting — §15.6)*

| What | Link |
|---|---|
| Live dashboard (the product) | https://dashboard-production-abea.up.railway.app |
| 90-second guided version | https://dashboard-production-abea.up.railway.app/?demo=90d |
| Repo (public, MIT) | https://github.com/briacSck/yield-arc-programmable-money |
| Video (≤3 min) | **[PENDING — Sara, by Aug 7]** |
| Deck | **[PENDING — Sara]** |
| Live mandate (on-chain) | https://testnet.arcscan.app/address/0x856bec6faadd61b583430e0cd22ec2e211c782b4 |
| Venue-aware mandate v2 | https://testnet.arcscan.app/address/0xd41d3648c71641fb2801415726787d5728492f70 |
| Nightly machine audit | https://github.com/briacSck/yield-arc-programmable-money/actions/workflows/nightly-audit.yml |

**Judge one-command check** (works offline after install; the negative demo is the punchline):

```bash
git clone https://github.com/briacSck/yield-arc-programmable-money && cd yield-arc-programmable-money && npm install
npx tsx verifier/src/cli.ts --fixture live-snapshot   # COMPLIANT, exit 0
npx tsx verifier/src/cli.ts --fixture naive-agent     # a rogue agent: 13 violations, exit 1
npx tsx verifier/src/cli.ts                           # live chain, 5/5 in ~6 s
```

*(If the npm publish lands before submission, swap in `npx -y @yield-cfo/mandate-verify` — and
only then.)*

---

**Team**

> Briac Socklaingum · Vadim [surname] · Sara [surname]

---

**What's next (one honest paragraph)**

> The offchain product already has a paying customer, a signed pilot with Akoneo, 4 LOIs and an
> accountant channel (Fiteco, ~70k client companies); the AMF authorisation track (CIF, then
> PSI/SGP *gestion sous mandat*) makes the on-chain mandate and the regulated instrument the same
> object expressed twice. Next on-chain: the verifier as the conformance tool of a draft ERC for
> liability-derived mandate bounds, and dynamic discounting — the best yield in the real economy
> is a company's own payables.

---

## Pre-submit checklist (§15.6 — run it the day before)

- [ ] Every link above opened in an **incognito** window
- [ ] Repo public; `docs/PLAN.md` and `docs/ERC-DRAFT.md` still correctly gitignored
- [ ] Video plays **logged out** (and not unlisted-broken)
- [ ] Deck link readable without an account
- [ ] Dashboard + `?demo=90d` load on a **phone**
- [ ] `npx tsx verifier/src/cli.ts` run once from a fresh clone that morning (or trust the
      `judge-command` CI badge, which does exactly this from an empty dir)
- [ ] Platform confirmation screenshot saved to the group
