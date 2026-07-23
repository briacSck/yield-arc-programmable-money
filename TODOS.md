# TODOS

Deferred work, captured by /autoplan run 3 (2026-07-14). Items here are consciously out of current scope — not forgotten, not silently dropped.

## Verifier + audit surface — CP2 finish line (core + dashboard v2 shipped 2026-07-23, hardened by /review)
- [x] **Dashboard audit surface** — scoreboard band + hero wiring + per-row verdict chips, LIVE (deployed `railway up --service dashboard`). Joined on `txHash`; no plumbing failure renders red.
- [x] **Nightly audit CI** (`nightly-audit.yml`) → appends `verdicts.json` to the `audit-log` ref → proxy splices the `audit` block (raw.githubusercontent). Seeded; first scheduled run 07:17 UTC.
- [x] **Verifier packaged for npm** — esbuild single-file bundle (`dist/cli.js`, viem inlined), `bin`/`files`/`prepublishOnly`/`publishConfig`, release-verifier.yml (tag → provenance publish), README badges. Live-chain verify in ~3s from the bundle; `npm pack` = 5 files 136kb.
- [ ] **npm publish → CTO** (auth-only blocker; interactive `npm login` web flow expired its CLI callback repeatedly). `verifier/PUBLISH.md` has the exact steps: granular token → `npm publish`, or NPM_TOKEN secret → tag `verifier-v0.1.0`. Name `@yield-cfo/mandate-verify` is unclaimed. Badges go green on publish.
- [ ] **`GET /forecasts?inputsHash=0x…` worker route** — additive read-only route in `agent/src/server.ts` for full preimage *disclosure* (the "why" behind each move). NOTE: no longer blocks invariant 5 — receipt integrity is pure-chain (`decisionId = keccak(forecastHash|kind)`, confirmed against live events 2026-07-23). Nice-to-have, not a dependency.
- [ ] Expand the golden snapshot as live history grows (refresh `verifier/fixtures/live-history-*.json` + bump expected counts in `golden.test.ts`). Live is now at 5 moves.
- [x] **ERC draft written** (§18.1 item 3) — `docs/ERC-DRAFT.md`, v0.1, 2340 words: interface + 5 invariants + exact tumbling-window pseudocode + receipt derivation + conformance vectors + the prior-art falsification table (AP2/Permit2/Firmata/**Enzyme**/**Zodiac**/dHEDGE) staking the surviving triple. **LOCAL/gitignored — private until Demo Day (§18.3).** Briac to skim the falsification section (Meridian/Firmata positioning = his call).
- [ ] **CP2 submission (Briac, deadline Mon Jul 27 13:59 Paris)** — code link + deck link + tracks (DeFi + Agentic Economy). README top fold already polished (`npx -y` block, badges, dashboard). Briac may ask for presentation help over the weekend.

## Operational (from the 2026-07-23 outage) — RESOLVED
- [x] **Railway deploy** — done. Railway does NOT auto-deploy from `main` (deploys are manual `railway up --service <worker|dashboard>`). Worker + dashboard both redeployed 2026-07-23; loop revived, first WITHDRAW landed 18:24 UTC.
- [x] **Heartbeat alert VERIFIED end-to-end** (2026-07-23) — `HEARTBEAT_URL` is set on the worker (hc-ping.com); a controlled `/fail` ping fired the alert channel, confirmed received. The failStorm ping (3 consecutive FAILED → `/fail`) is deployed + unit-tested. The process-up-but-all-failing state now pages.

## USYC venue (§17.4) — REAL, round-trip proven 2026-07-23
- [x] **Allowlist confirmed + round-trip executed on-chain**: subscribe 1 USDC → 0.883398 USYC (deposit `0x46b1dba7…`), redeem → 0.999903 USDC (`0xfd6e3a65…`). Kit: `agent/scripts/usyc-mint-test.ts`.
- [x] **Venue adapter** `agent/src/chain/usyc-venue.ts` (`IVenue` seam: read-only previews/allowlist + money-move call specs the executor signs; 6 tests + live smoke).
- [ ] **Wire USYC as the mandate's deploy target behind the seam** — GATED (untouchable path + frozen contract): the deployed `AgentMandate` is pure pool-accounting and does not mint USYC inside `deposit()`. Real integration needs either (a) executor-level: on a DEPLOY, mandate.deposit + USYCVenue.mintCall as a paired move, or (b) a new venue-aware mandate. Needs the team nod (§17.2). Decide vs keeping the disclosed stub for the demo — the round-trip is already a strong standalone DeFi-track beat.
- [ ] Decide whether the demo shows the agent HOLDING USYC (real yield position) vs the round-trip proof only.

## Post-hackathon
- [ ] `/api/events` pagination: `server.ts` caps `limit` at 1000 (~890 records by Demo Day — fine; silently truncating from late August). The verifier is deliberately independent of this route.
- [ ] Verifier support for non-AgentMandate contracts (generalize the fetch layer once a second real implementer exists).
- [ ] Real underwriter premium pricing — the underwriter agent shipped as a Claude Managed Agent (`underwriter/`, 2026-07-22) with the disclosed `stub-v0` formula + daily certificate; **real actuarial pricing stays deferred** (stub is disclosed by design for the hackathon). On-chain parametric-cover escrow + Nanopayments/ERC-8183 premium settlement also still roadmap.

## Gated (opens with a specific decision)
- [ ] Salted receipt commitments (`keccak(salt ‖ canonicalJson)`) + authenticated preimage access — REQUIRED before pilot mode (real Akoneo ledger) ever feeds the loop; spec already in the ERC draft's security-considerations section.
- [ ] Approach C adopt-kit (npm quickstart + outreach inviting other teams to implement the mandate interface) — W3-slack only, per design doc; re-evaluate at W3 kickoff.
- [ ] AttestationRegistry automation beyond nightly CI (only if the W3 attestation gate opens).

## Small errata (fold into the first verifier PR)
- [ ] `AgentMandate.sol` NatSpec claims `keccak(inputsHash ‖ kind ‖ asOf)` and PLAN §17.2 claims `keccak(inputsHash ‖ window)` — both wrong vs the executor's actual `keccak(utf8("<inputsHash>|<kind>"))`. Contract is frozen; fix the docs (invariant 8: code wins).
