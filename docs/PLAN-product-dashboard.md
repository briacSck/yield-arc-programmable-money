# PLAN — the product: a CFO app for a business owner who doesn't know what a blockchain is

_Draft 2026-07-28. Supersedes `PLAN-judge-surface.md`, which solved the wrong problem: it treated
the dashboard as an artifact for judges. **The dashboard is the product.**_

## 0. Who this is for

**Primary user — Camille, owns Boulangerie Chartier.** Has never heard of a mandate, a receipt hash
or an invariant. Wants to know: *do I make payroll on the 28th, is my idle cash doing anything, and
can I stop this thing if I get nervous.* She would not describe herself as using crypto, and the
product should not require her to.

**Secondary user — her contrôleur de gestion / accountant.** Wants the evidence: what moved, when,
under what rule, and can it be checked independently. This is the person the current dashboard was
built for.

**Tertiary — the Arc ecosystem.** The verifier, the mandate interface and the ERC draft are the
part we open-source because it may be useful beyond us. **A bonus, not the product.**

The current dashboard serves #2 by default and #1 not at all. That is the inversion to fix.

## 1. The product thesis, in Camille's words

> "I have €38,000 in the account. Payroll is €12,000 on the 28th and the URSSAF hits on the 5th.
> I never know how much I can safely leave sitting there, so it all sits there earning nothing.
> This thing works out what I can spare, puts it to work, and pulls it back before I need it.
> I set the floor it can never go under. I can stop it whenever I want."

Everything on the default screen should serve that paragraph. Nothing else belongs there.

## 2. Two modes

| | **Owner mode (default)** | **Advanced mode (toggle)** |
|---|---|---|
| Question answered | "Am I covered, and what did my agent do for me?" | "Prove it." |
| Money shown as | € at the business's real scale | USDC, plus base units where it matters |
| Actions | plain sentences: *"Set aside €6,000 for the payroll on the 28th"* | decision records, kinds, amounts, reasons |
| Trust surface | one quiet line: *"Every action is recorded and independently checkable →"* | today's full instrument: invariant chips, receipts, tx links, `npx` command |
| Controls | adjust floor · pause the agent · add funds | same, plus raw mandate parameters |

**Advanced mode is not a lesser view — it is today's dashboard, preserved.** Nothing built so far is
thrown away; it stops being the front door. The toggle is persisted (localStorage + `?mode=`) so an
accountant lands where they left off, and so a demo can deep-link straight to either.

## 2b. Borrow the screen YIELD already validated

`YIELD/yield-frontend/src/app/dashboard/page.tsx` solves this exact problem for real French SMEs.
The Arc product is that screen with **one thing changed: the agent acts on its own, under a mandate
the owner sets and can revoke.** Autonomy becomes the upgrade rather than the subject.

| YIELD (production, human-driven) | Arc version (agent-driven) |
|---|---|
| `Bonjour, Jean.` + `Position du 28 juillet` | same |
| *"Vous avez 12 400 € à placer aujourd'hui"* | *"Votre agent a placé 12 400 € ce matin"* — past tense; it already happened |
| Buttons **Placer** / **Retirer** | the agent does both; the owner's buttons become **Ajuster mon plancher** / **Mettre en pause** |
| Hero `Trésorerie totale` in € | same — company + deployed |
| `+X € gagnés` pill | same — **needs USYC A to be a real number** (§6) |
| `AllocationBar` bank / réserve / investi / plaçable | banque / **plancher de sécurité** / placé / plaçable |
| Card *Compte bancaire* (IBAN, sync) | card **Compte** (on-chain balance, "synchronisé" = last cycle) |
| Dark card *Support d'investissement — Spiko Euro* | dark card **Support — USYC** (Circle's tokenised T-bill) |
| Activity rows w/ approve / cancel | **what your agent did**, past tense, no approval needed — that IS the product |

The dark investment card is where the Arc story lands hardest: same shape as the product a French
SME already understands, with a Circle-native RWA behind it and an agent operating it under bounds.

**Language: French.** The persona is a French bakery and the GTM is French accountants. YIELD's
production UI is French; the hackathon dashboard is English. Owner mode should be French with an
EN toggle, or English throughout if the judging audience makes that safer — flagged in §8.

## 3. Owner mode — the screen

Ordered by what Camille asks first.

### 3.1 The answer, not the data
One sentence, largest type on the page, computed from the forecast the agent already produces:

> **You're covered through 12 September.**
> Payroll on the 28th and the URSSAF on the 5th are both funded, with €7,400 to spare at the tightest point.

Under it, three numbers in her units: **in the account · working for you · earned so far**.
"Earned so far" is the number that makes this a product rather than a safety feature — see §6, it
does not exist yet and it is the single biggest gap.

### 3.2 The cash wall
The existing forecast cone, relabelled for a human: the P10 line becomes **"if things go badly"**,
P50 **"expected"**, the floor becomes **"your safety floor — the agent never goes below this"**.
Same component, same maths, no crypto vocabulary. The tightest point gets a marker and a date,
because that is the thing she actually loses sleep over.

### 3.3 What your agent did
Not a decision log. A short, dated, human list — the last ~10 things, no hashes, no kinds:

> **24 July** · Set aside €5,800 ahead of payroll — your balance was projected to dip close to your floor.
> **20 July** · Put €7,600 to work — you were holding more than you needed for the next 30 days.

Rules: derived from the decision record, never hand-written (three independent reviewers flagged
hand-written captions as a lie surface). Cycles where nothing happened do not appear at all — they
belong in advanced mode. If there is genuinely nothing to show: *"Nothing needed doing this week —
your cash never came near the floor."*

### 3.4 Controls — the part that makes it hers
Currently the owner's powers exist only as on-chain calls. They need to be buttons:

- **Your safety floor: €20,000** · `Adjust` → the existing `setMandate`
- **Pause my agent** → the existing `revoke`. Labelled in her terms, not "revoke". Confirmation
  copy states the truth plainly: *"Your agent stops moving money immediately. Anything already
  working for you can still come back. You can restart it whenever you like."* That sentence IS the
  asymmetry doctrine, in French-bakery English.
- **Add funds** → `fundCompany`.

This is the biggest functional gap: today the product is read-only for the person who owns the money.

### 3.5 The quiet trust line
One line, bottom of the owner view, not shouted:

> Every action your agent takes is recorded publicly and can be checked by anyone — including your
> accountant. **See the evidence →** (switches to advanced mode)

## 4. Advanced mode — keep, don't rebuild
Today's page, with the fixes the review already produced (all still valid, all bugs in code that
carries into the product):

- **E-B1** hero says 5 on-chain moves, verifier says 8 — the page contradicts the chain. Source from
  chain truth.
- **E-B2** `revokedAt` fabricates `new Date()` once the revocation scrolls out of the window.
- **E-B3** PENDING vs UNVERIFIED is not actually computable; count against `audit.totalMoves`.
- **E-B4** a revoke-blocked deposit renders shame-red instead of **"BLOCKED — mandate enforced"** in
  sage. That row is the demo's punchline.
- **E-B5** the dashboard has no `test` script, so the root `npm test --workspaces` skips it.
- **D4 decision:** promote `UptimeStrip` to be the log's header (one tick per cycle, nothing hidden)
  rather than collapsing runs into a claimed count.
- **Never print a count we cannot back** — `stats` is unwindowed ground truth; the 200-record window
  is not.

## 5. Scale [RESOLVED — refill is impossible, and the reframe makes it unnecessary]

**Measured 2026-07-28: total testnet USDC across owner, agent and mandate = 19.9 USDC**, of which
the mandate already holds 10. The Arc faucet is 20 USDC per address per 2 h behind bot detection
that needs a human click. Reaching 1,000 USDC would take days of manual claiming; €38,000-equivalent
is unreachable. **Refilling to a believable SME position is not available to us.**

The product reframe resolves it anyway:

- **Owner mode shows Boulangerie Chartier's business position in euros at real scale** (€38k
  balance, €12k payroll). This is a modelled demo client — the same convention as every SaaS demo
  account — and it is what "demo ledger, real settlement" has meant in this project since day one.
- **Advanced mode shows the real on-chain USDC**: small, real, verifiable, with the mandate,
  receipts and the verifier command.
- **One honest bridge line** connects them, stated once: *"Boulangerie Chartier is a modelled client.
  Its cash profile is real French-SME data; settlement runs on Arc testnet at 1:3800 scale — every
  rule is enforced at full fidelity, only the amounts are small."*

This is **not** the euro-annotation three reviewers rejected. They rejected pasting `≙ €32,148` beside
on-chain figures *on an instrument*, which mixes attested and unattested numbers in one glance. Here
the two live in different modes with a stated relationship, and the machine verdict never leaves
machine units.

## 6. The gap that matters most: yield is not real yet
Owner mode's "earned so far" has nothing behind it. Today `deployed` is an accounting entry inside
the mandate; the USDC does not earn. That is the **USYC A** decision already taken: a venue-aware
mandate where `deposit()` actually subscribes USYC and `withdrawToCompany()` redeems.

Without it, the product's core promise — *your idle cash earns* — is a stub. With it, "earned so
far" is a real number, and **C** (redemption-liquidity awareness: can the money get back before
payroll) stops being theoretical, and **B** (machine-verified P&L) has something to verify.

This reframe raises A from "impressive for Circle" to **load-bearing for the product**. It needs
Vadim, and it spends the one-new-contract budget.

## 7. Non-goals
- Not a redesign of the visual system. Paper/ink/sage and Geist stay.
- No new data route. The dashboard keeps its one-proxied-route invariant and zero chain reads.
- No change to the scheduler/decision/executor money path.
- No marketing site. This is the app.

## 8. Open questions
1. Owner mode default for *everyone*, or remember per-visitor with advanced deep-links for the
   demo and the README?
2. Do the owner controls (§3.4) write on-chain from the browser (needs a wallet/signer story for a
   non-crypto user — Circle Wallets?) or stay read-only with a "call your accountant" path for the
   hackathon?
3. Does the video show owner mode, advanced mode, or the switch between them? The switch is
   arguably the most Arc-native thing we have: same money, two audiences, one chain.
