# What only you can do — 2026-07-28

Three of these unblock me. The fourth is a decision. Everything else on the plan I can execute.

---

## 1. USYC role grant — email Circle / Hashnote support

**Why:** `AgentMandateV2` subscribes the deployed surplus into USYC so "your idle cash earns" stops
being a stub. But the USYC Teller gates subscription on a `RolesAuthority` allowlist, and I verified
on-chain that **only the agent EOA holds a role** — the company wallet and the v1 mandate contract
do not. A newly deployed v2 contract will hold none either. **This is a permissions grant, not a
code change**, and it is the long pole: everything else about v2 is built and CI-green.

Send this now, before the deploy, so the process is already moving.

> **Subject:** USYC testnet — allowlisting a smart contract address for subscription (Arc testnet)
>
> Hello,
>
> We're building on Arc testnet as part of the Circle/Encode Programmable Money hackathon. Our agent
> wallet `0x93d9c11c8e9e23e1e97e855668a27a14accaab7c` is already permissioned for USYC subscription,
> and we've completed a full subscribe/redeem round trip successfully (deposit
> `0x46b1dba7…`, redeem `0xfd6e3a65…`).
>
> We're now moving the position from the wallet into a smart contract: an owner-revocable treasury
> mandate that holds a company's operating cash and subscribes the surplus into USYC on the
> company's behalf, under on-chain bounds the owner sets.
>
> Two questions:
>
> 1. What is the process to have a **contract address** granted the USYC subscription role on Arc
>    testnet (the role checked by `RolesAuthority.canCall(addr, Teller, 0x6e553f65)`)? We can supply
>    the deployed address, source, and the deploying/owning wallet.
> 2. Is there anything about a contract holder (as opposed to an EOA) that changes the eligibility
>    review — and does the same route exist on mainnet for a regulated entity? We're on the AMF/CIF
>    authorisation track in France and expect to hold client assets under a discretionary mandate.
>
> Happy to share the contract source and tests; it's a small, self-contained mandate with no
> upgradeability and no admin key beyond the owner's own exit.
>
> Thanks,
> Briac — YIELD

**If they say no or go quiet:** v2 still deploys and is verifiable, it just stays escrow-only
(identical to v1) with the venue unset — and we say exactly that rather than implying yield we do
not earn.

---

## 2. npm publish — the token route (the CLI login is not going to work)

`npm login` has now failed repeatedly for you; `PUBLISH.md` already records the browser callback
expiring. Skip it. The repo already has `.github/workflows/release-verifier.yml`, which publishes
**with provenance** — strictly better for an audit tool, since the tarball's origin becomes
machine-verifiable back to the exact commit.

1. npmjs.com → **Access Tokens** → **Granular Access Token**, scoped to `@yield-cfo`, **read+write**.
2. **In your own terminal, not here** (a token pasted into this session would be in the transcript
   and I'd have to treat it as burned):
   ```
   gh secret set NPM_TOKEN
   ```
   It reads the value from stdin, so it never appears in a command line.
3. Tell me. I push `verifier-v0.1.0`, CI runs the 20 tests, rebuilds via `prepack`, and publishes.

**Also worth doing regardless:** claiming the scope closes a real supply-chain hole. Our public
README and dashboard currently name a package **anyone could publish under**.

---

## 3. License — a decision, not a task

I wrote **MIT** into the README, inferring it from `verifier/package.json`, while the repo root said
`TBD`. That was my inference, not your call. Confirm MIT for the whole repo or tell me otherwise —
it is on the front page of a public repo judges will read.

---

## 4. Worth more than any of the above

- **Email the RC Pro broker**: *"here's a bounded, owner-revocable, machine-verifiable agent mandate
  — would you quote it, and if not, what would you need?"* 30 minutes. Even a "no, but here's what
  we'd need" converts *bounded ⇒ insurable* from a claim into evidence, and it is a slide no other
  team can have.
- **Get a conversion number out of Akoneo.** One paying customer plus no evidence that an accounting
  firm converts its book is the open question about the company, not the hackathon.
- **Video footage.** Still zero, with the freeze two days out. The scenario driver replays 90 days
  deterministically in 4 seconds and is the film set.
