> ⚠️ **STATUS 2026-07-28 — partially overruled on review.** The StableFX/EURC "Tier 1 promotion"
> below was judged ~60% rationalisation (the exposure is on 100% of the cash, not the floor; a
> EUR-denominated floor over a USDC balance would destroy pure-chain verifiability; the honest fix
> is same-unit EURC-to-EURC, see `PLAN-product-v2.md` §3 and `ERC-DRAFT.md` v0.2). The Paymaster
> section re-litigated a decision PLAN §5 had already settled ("never say Paymaster") — **cut**.
> The USYC section stands, and v2 is now deployed (`0xd41d…2f70`). The Nanopayments-premium beat
> remains the one earned track item. Read this file as the *analysis trail*, not the decisions.

# Are we using the Circle stack at full capacity — or namedropping?

_2026-07-28. Test applied to every product below: **does a French SME's CFO agent genuinely need
this, and does its absence make our own claims false?** Anything that fails that test is a logo on
a slide, and we should say so and cut it (§15.3 permits a named-and-explained cut)._

## The finding that matters: our floor is not actually a floor

We claim a **machine-checkable safety floor**. The floor is denominated in **USDC**. Boulangerie
Chartier's obligations — payroll, URSSAF, rent, flour — are denominated in **EUR**.

So the invariant the verifier proves is: *the agent never let the USDC balance fall below N USDC.*
The invariant the owner actually needs is: *the agent never let the company become unable to pay
€12,000 of payroll on the 28th.* **Those are different statements, and EUR/USD can break the second
without ever violating the first.** A 5% move against the euro breaches the real floor while every
one of our five invariants stays green.

This is a **fiduciary hole in the Fiduciary Standard**, found in our own system. It is also the
single most defensible reason to reach for Circle's FX products — not because they are on the track
card, but because without them the product is quietly unsound for its target market, and the ERC we
are drafting would standardise the same mistake for everyone who implements it.

**Consequence for the ERC draft:** the mandate interface needs a *denomination* — the currency the
floor is expressed in — and conformance requires that the floor be evaluated in the denomination of
the company's liabilities. That is a genuine contribution, and it came from building the thing.

---

## Tier 1 — required for the product to be truthful

### USDC + Arc + native-USDC gas · **shipped**
The agent holds its own wallet, pays gas in USDC, settles sub-second. Already real, already the
spine. Nothing to add.

### Circle Wallets (developer-controlled, MPC) · **shipped, about to earn more**
The agent's wallet and the company's wallet. Becomes far more load-bearing with owner mode: Camille
gets a wallet she never sees, and her "Pause my agent" button is a server-side Circle call, not
MetaMask. **This is the non-crypto onboarding story**, and it is the only way the product works for
its actual user.

### Circle Contracts (SCP) · **shipped**
`AgentMandate` deployed and verified through it.

### USYC · **decided (A+B+C), not yet wired** — see §USYC below
Without it, "your idle cash earns" is a stub and owner mode's headline number is fiction.

### StableFX / EURC · **NEW — promoted to Tier 1 by the finding above**
The agent should hold and deploy against **EUR-denominated** value for a EUR-liability company, or
explicitly manage the FX exposure between the two. Concretely, the smallest honest version:
- the mandate's floor carries a **denomination** (EUR), and
- the agent converts through StableFX when deploying/recalling, or holds EURC, and
- the exposure engine we already built **already has the right shape for this**: FX is just another
  input-cost exposure. `assessExposure` takes a cost line and a price signal — EUR/USD is a price
  signal, and the euro value of a USDC floor is exactly the kind of thing that should raise it.

That last point is the tell that this belongs: **the machinery already exists and FX slots into it
without a new concept.** That is what "using the tech at full capacity" looks like, as opposed to
bolting on a swap because the track card lists StableFX.

---

## Tier 2 — removes a failure class we currently code around

### Paymaster
We already have a **gas-exhaustion failure mode**: `gasOk` false → HOLD → heartbeat FAIL. We wrote a
guard, an alert and a test for the case where an autonomous agent runs out of gas and stops being
able to protect the company. **Paymaster deletes that entire class** — the agent stops needing to
hold a gas balance at all.

The argument is agent-native and general: *an autonomous agent that must acquire and maintain its
own gas is a fragile agent, and fragility in a treasury agent is a solvency risk, not an
inconvenience.* That is a real sentence about autonomy, not a logo.

On Arc gas is already USDC, so the win is smaller **until** the agent operates anywhere else — which
is exactly what Gateway/CCTP would make true. Paymaster and cross-chain stand or fall together.

---

## Tier 3 — real, but earn it or cut it

### Gateway vs CCTP
For a bakery, cross-chain is not a felt problem. Two places it becomes real:
1. **Reaching venues.** If the best risk-appropriate yield is not on Arc, a treasury agent must
   reach it. **Gateway** (unified balance, instant availability) fits a treasury agent better than
   **CCTP** (explicit burn/mint transfer), because the agent's problem is *availability against a
   payment calendar*, not moving a lump. Arc stays the settlement hub — which is the DeFi track's
   "cross-chain liquidity using Arc as a settlement hub" criterion, verbatim.
2. **Portfolio-of-agents** (the cabinet with 200 clients): one unified balance, many mandates.

**Honest verdict:** worth *one* legible beat if capacity exists after Tier 1. If it does not, cut it
by name in the README. Building both Gateway and CCTP would be namedropping.

### Nanopayments / ERC-8183 · promised in CP1, unbuilt
The natural, already-half-built use: **the CFO agent pays the underwriter agent its premium**. The
underwriter already prices `stub-v0` (0.0851 USDC/30d) and issues a certificate daily; only
settlement is missing. That is one scene that satisfies a named judging criterion *and* completes
the "bounded ⇒ insurable" spine with money actually moving between two agents.

Second candidate: paying a forecaster agent per inference. Weaker — we have no second forecaster,
and inventing one to justify the rail is the definition of namedropping.

### App Kits / Agent Stack
App Kits is the fastest honest path to owner-mode auth + wallet onboarding. Agent Stack is worth
mining for the Nanopayments leg rather than hand-rolling x402. Use as **means**, do not claim as
features.

---

## USYC — are we giving it the importance it deserves?

No. Today it is "we proved a round-trip." Its full potential is a genuinely novel product claim:

**Duration-matched treasury.** USYC is a tokenised T-bill fund: it accrues NAV and has redemption
mechanics. Our agent *knows the payment calendar* — payroll on the 28th, URSSAF on the 5th. So it
can do what a real corporate treasurer does and almost no software does automatically: **match the
liquidity profile of the investment to the maturity of the liability.** Deploy only what can be back
in the account before the obligation lands; keep the rest liquid; ladder the difference.

That reframes the three USYC options into one story:
- **A (venue-aware mandate)** — the money genuinely earns. Without it the rest is theatre.
- **C (redemption-liquidity awareness)** — the agent asks *"can this be back before payroll?"* before
  it deploys. This is the duration-matching, and it is the part a *contrôleur de gestion* will
  recognise instantly as competent rather than clever.
- **B (yield receipts)** — machine-verified P&L, so the earned number on the owner's screen is not a
  claim, it is a proof.

Together: **"an agent that invests your idle cash in T-bills, never past the date you need it back,
and can prove every euro of it."** No other hackathon project will say that sentence, and every word
of it is checkable.

---

## What this means for the two modes

**Owner mode** must show, in plain English: cash · covered-through date · what is earning · what it
earned · the floor · pause. FX and venue mechanics stay invisible — but the *denomination* fix means
her floor is finally the number she actually cares about.

**Advanced mode** is where the power shows, and it should not be shy: the mandate's bounds and
denomination, the five invariants with the verifier command, the duration-matching decision (why the
agent deployed *this much* and not more), the FX exposure, the venue position and its NAV, the
underwriter's live premium, and the negative demo — a rogue agent failing the same audit. That is a
screen a *contrôleur de gestion* or an *expert-comptable* reads as rigorous, and a judge reads as
nobody-else-has-this.

## Recommended cut list (say it out loud in the README)
- CCTP **or** Gateway — build at most one, name the other as deliberately cut.
- Forecaster-agent-per-inference — cut; the underwriter premium is the honest Nanopayments beat.
- Anything else on the track cards we do not genuinely need.
