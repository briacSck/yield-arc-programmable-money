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
> We've now moved that position into a smart contract, deployed and live:
>
> - **Contract to allowlist: `0xd41d3648c71641fb2801415726787d5728492f70`** (Arc testnet, deployed
>   at block 54088009 by our Circle developer-controlled company wallet
>   `0x4704fB05a6e87C482090cF5534E86c9ab44bBFda`)
>   https://testnet.arcscan.app/address/0xd41d3648c71641fb2801415726787d5728492f70
> - It's an owner-revocable treasury mandate: it holds a company's operating cash and subscribes
>   the surplus into USYC under on-chain bounds the owner sets. Both roles are needed — the
>   contract **calls `Teller.deposit`** and **holds the USYC share**
>   (`RolesAuthority.canCall(addr, Teller, 0x6e553f65)` currently returns false for it).
> - Source is public (`contracts/contracts/AgentMandateV2.sol` in our repo): self-contained, no
>   upgradeability, no admin key beyond the owner's own exit, 68 tests.
>
> Could you add this contract address to the USYC subscription allowlist on Arc testnet?
>
> One forward-looking question: does the same route exist on mainnet for a regulated entity? We're
> on the AMF/CIF authorisation track in France and expect to hold client assets under a
> discretionary mandate.
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

## 3b. Underwriter — Demo Day plan (archived deliberately to save budget; that's fine)

The daily schedule was archived on purpose during build week. Two ways to make it fresh for
Demo Day, cheapest first:

- **On-demand run the morning of** (recommended): fire `LAUNCH.md`'s on-demand path — a certificate
  **dated Demo Day**, costs cents, no schedule needed. Do the same before the video shoot so the
  memo on camera isn't a week old.
- **Restart the schedule** (only if you want "runs daily" to be present-tense again): archive is
  terminal in the API — it's a *re-create*, not an un-archive. `underwriter/NEXT-DIRECTIONS.md`
  documents it: re-`POST` the saved `deployment.json` against the same `AGENT_ID`/`ENV_ID`/
  `MEMSTORE_ID`, write the new `DEPLOYMENT_ID` back, and the underwriting history continues
  uninterrupted. Do it ~Aug 18 so two or three fresh runs exist by the 20th.

Either way, the pitch line stays as shipped: *six scheduled assessments, on demand today,
restorable without losing the trend* — cost discipline, not a gap.

## 4. Worth more than any of the above

- **Email the RC Pro broker**: *"here's a bounded, owner-revocable, machine-verifiable agent mandate
  — would you quote it, and if not, what would you need?"* 30 minutes. Even a "no, but here's what
  we'd need" converts *bounded ⇒ insurable* from a claim into evidence, and it is a slide no other
  team can have.
- **Get a conversion number out of Akoneo.** One paying customer plus no evidence that an accounting
  firm converts its book is the open question about the company, not the hackathon.
- **Video footage.** Still zero, with the freeze two days out. The scenario driver replays 90 days
  deterministically in 4 seconds and is the film set.
