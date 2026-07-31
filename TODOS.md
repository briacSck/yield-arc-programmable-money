# TODOS

Deferred work, captured by /autoplan run 3 (2026-07-14). Items here are consciously out of current scope — not forgotten, not silently dropped.

## Verifier + audit surface — CP2 finish line (core + dashboard v2 shipped 2026-07-23, hardened by /review)
- [x] **Dashboard audit surface** — scoreboard band + hero wiring + per-row verdict chips, LIVE (deployed `railway up --service dashboard`). Joined on `txHash`; no plumbing failure renders red.
- [x] **Nightly audit CI** (`nightly-audit.yml`) → appends `verdicts.json` to the `audit-log` ref → proxy splices the `audit` block (raw.githubusercontent). Seeded; first scheduled run 07:17 UTC.
- [x] **Verifier packaged for npm** — esbuild single-file bundle (`dist/cli.js`, viem inlined), `bin`/`files`/`prepublishOnly`/`publishConfig`, release-verifier.yml (tag → provenance publish), README badges. Live-chain verify in ~6s from the bundle (measured; earlier ~3s claim was optimistic); `npm pack` = 5 files 136kb.
- [ ] **npm publish → CTO** (auth-only blocker; interactive `npm login` web flow expired its CLI callback repeatedly). `verifier/PUBLISH.md` has the exact steps: granular token → `npm publish`, or NPM_TOKEN secret → tag `verifier-v0.1.0`. Name `@yield-cfo/mandate-verify` is unclaimed. Badges go green on publish. **Interim SHIPPED 2026-07-31:** `npm pack` tarball attached to [Release v0.1.0](https://github.com/briacSck/yield-arc-programmable-money/releases/tag/v0.1.0) — the front-page `npx -y <tarball-url>` judge command is live and verified (live run exits 0, `--fixture naive-agent` exits 1 with 13 violations). Registry publish is now polish, not a blocker.
- [x] **`GET /forecasts?inputsHash=0x…` worker route — SHIPPED 2026-07-31 (PR #37)** — additive read-only route in `agent/src/server.ts` for full preimage *disclosure* (the "why" behind each move); strict hash validation, bounded response, worker redeploy required. (Receipt integrity was already pure-chain — `decisionId = keccak(forecastHash|kind)` — so this is disclosure, not a dependency.)
- [x] **Golden snapshot refreshed 2026-07-27 (4 → 7 moves)** — and made repeatable: `npm run snapshot -w verifier` (`verifier/scripts/snapshot.ts`) rescans live history, refuses to write a non-COMPLIANT snapshot, and prints the expectations to paste into `golden.test.ts` (wiring stays a human edit — a self-updating golden test can't fail). Refreshed again 2026-07-31 (7 → 8 moves, PR #37): fixture `live-history-2026-07-31.json` @ block 54645259; the offline `--fixture live-snapshot` path reports the same 8 moves the dashboard shows. Re-run whenever live history grows.
- [x] **ERC draft written** (§18.1 item 3) — `docs/ERC-DRAFT.md`, v0.1, 2340 words: interface + 5 invariants + exact tumbling-window pseudocode + receipt derivation + conformance vectors + the prior-art falsification table (AP2/Permit2/Firmata/**Enzyme**/**Zodiac**/dHEDGE) staking the surviving triple. **LOCAL/gitignored — private until Demo Day (§18.3).** Briac to skim the falsification section (Meridian/Firmata positioning = his call).
- [ ] **CP2 submission (Briac, deadline Mon Jul 27 13:59 Paris)** — code link + deck link + tracks (DeFi + Agentic Economy). README top fold already polished (`npx -y` block, badges, dashboard). Briac may ask for presentation help over the weekend.

## Operational (from the 2026-07-23 outage) — RESOLVED
- [x] **Railway deploy** — done. Railway does NOT auto-deploy from `main` (deploys are manual `railway up --service <worker|dashboard>`). Worker + dashboard both redeployed 2026-07-23; loop revived, first WITHDRAW landed 18:24 UTC.
- [x] **Heartbeat alert VERIFIED end-to-end** (2026-07-23) — `HEARTBEAT_URL` is set on the worker (hc-ping.com); a controlled `/fail` ping fired the alert channel, confirmed received. The failStorm ping (3 consecutive FAILED → `/fail`) is deployed + unit-tested. The process-up-but-all-failing state now pages.

## USYC venue (§17.4) — REAL, round-trip proven 2026-07-23
- [x] **Round-trip executed on-chain**: subscribe 1 USDC → 0.883398 USYC (deposit `0x46b1dba7…`), redeem → 0.999903 USDC (`0xfd6e3a65…`). Kit: `agent/scripts/usyc-mint-test.ts`.
  - ⚠️ **Evidence correction (2026-07-28):** the original "allowlist confirmed" read
    (`subscriptionLimitRemaining > 0 || maxDeposit > 0`) was a **false positive for every address
    on the chain** — the Teller hands the same 1,000,000/day limit to anyone, including
    `0x…deadbeef`. The real check is `RolesAuthority.canCall(addr, Teller, 0x6e553f65)`
    (`agent/scripts/check-usyc-permission.ts`). The conclusion held — the agent EOA *is*
    permitted — but by luck, not method. The round-trip itself is the actual proof.
- [x] **Venue adapter** `agent/src/chain/usyc-venue.ts` (`IVenue` seam: read-only previews/allowlist + money-move call specs the executor signs; 6 tests + live smoke).
- [x] **RESOLVED 2026-07-28 — option (2) built and DEPLOYED, alongside v1.** `AgentMandateV2` at
  `0xd41d3648c71641fb2801415726787d5728492f70` (block 54088009, funded 2 USDC, 68 Hardhat tests,
  verified COMPLIANT by the unchanged verifier via `--address`). v1 keeps its live history — the
  earlier "restarts the track record" objection was a framing error: v2 runs **beside** v1, not
  instead of it. Venue is UNSET (escrow-only, honestly identical to v1) until Circle grants the
  contract its USYC role — support ticket sent 2026-07-28 with the address
  (`docs/ACTIONS-FOR-BRIAC.md`). Then: owner calls `setVenue(0x9fdF…C105A)`.
- [~] *(superseded analysis, kept for the trail)* Wire USYC as the mandate's deploy target — GATED, and **option (a) is now ruled out on inspection (2026-07-27)**. The proposed "executor-level paired move (mandate.deposit + USYCVenue.mintCall)" cannot work against the frozen contract: `AgentMandate.deposit()` only moves numbers between `companyBalance` and `deployedBalance`, and the native USDC backing both pools is **held by the mandate contract itself** (funded via `payable fundCompany`). It makes no external calls and has no path to send funds to the Teller; the only exit is `emergencyWithdrawAll` → owner. So the agent wallet cannot subscribe USYC *with the deployed funds* — it could only subscribe with its own gas-wallet USDC, which would make "the deployed surplus is earning T-bill yield" **false on-chain**. That is exactly what invariant #3 forbids. Remaining options:
  - **(1) Keep the disclosed stub for the demo [RECOMMENDED].** The mandate tracks `deployedBalance`; the proven USYC round-trip stands alone as a DeFi-track beat. Zero new Solidity, live track record and the verifier's pinned deploy block untouched. Venue re-verified live 2026-07-27: allowlisted, 1,000,000 USDC/day subscription limit remaining.
  - **(2) A venue-aware `AgentMandate` v2** that subscribes inside `deposit()` and redeems inside `withdrawToCompany()`. The only *real* integration — and the shape a genuine implementer of the ERC would build. Cost: new Solidity in W3, a new deploy block, and the on-chain history restarting from zero (the "running unattended since Jul 14" line and the 7-move verified history are continuity we cannot re-earn before Demo Day).
  - **(3) Owner-side mirrored position** — subscribe a matching amount in a separate wallet. Honest only with heavy disclosure, and weaker than (1) for it.
  - **Team call (§17.2).** The recommendation is (1) for the hackathon + (2) written into the ERC draft as the reference integration shape.
- [ ] Decide whether the demo shows the agent HOLDING USYC (real yield position) vs the round-trip proof only — **this collapses into the decision above**: under option (1) it is the round-trip proof only.

## Post-hackathon
- [ ] `/api/events` pagination: `server.ts` caps `limit` at 1000 (~890 records by Demo Day — fine; silently truncating from late August). The verifier is deliberately independent of this route.
- [ ] Verifier support for non-AgentMandate contracts (generalize the fetch layer once a second real implementer exists).
- [ ] Real underwriter premium pricing — the underwriter agent shipped as a Claude Managed Agent (`underwriter/`, 2026-07-22) with the disclosed `stub-v0` formula + daily certificate; **real actuarial pricing stays deferred** (stub is disclosed by design for the hackathon). On-chain parametric-cover escrow + Nanopayments/ERC-8183 premium settlement also still roadmap.

## Gated (opens with a specific decision)
- [ ] Salted receipt commitments (`keccak(salt ‖ canonicalJson)`) + authenticated preimage access — REQUIRED before pilot mode (real Akoneo ledger) ever feeds the loop; spec already in the ERC draft's security-considerations section.
- [ ] Approach C adopt-kit (npm quickstart + outreach inviting other teams to implement the mandate interface) — W3-slack only, per design doc; re-evaluate at W3 kickoff.
- [ ] AttestationRegistry automation beyond nightly CI (only if the W3 attestation gate opens).

## Small errata (fold into the first verifier PR)
- [x] **Errata FIXED 2026-07-27** — `AgentMandate.sol` NatSpec (was `keccak(inputsHash ‖ kind ‖ asOf)`) and PLAN §17.2 (was `keccak(inputsHash ‖ window)`) both now state the executor's actual `keccak256(utf8("<inputsHash>|<kind>"))`, with a dated ERRATA note preserving what they used to say. Comment-only — deployed bytecode untouched (contract frozen; invariant 8: code wins).
