# TODOS

Deferred work, captured by /autoplan run 3 (2026-07-14). Items here are consciously out of current scope — not forgotten, not silently dropped.

## Verifier + audit surface — CP2 finish line (core + dashboard v2 shipped 2026-07-23, hardened by /review)
- [x] **Dashboard audit surface** — scoreboard band + hero wiring + per-row verdict chips, LIVE (deployed `railway up --service dashboard`). Joined on `txHash`; no plumbing failure renders red.
- [x] **Nightly audit CI** (`nightly-audit.yml`) → appends `verdicts.json` to the `audit-log` ref → proxy splices the `audit` block (raw.githubusercontent). Seeded; first scheduled run 07:17 UTC.
- [ ] **npm publish** `@yield-cfo/mandate-verify` with `--provenance` from Actions + 2FA, zero postinstall. Bundle to a single-file CLI (tsup/esbuild) so cold-cache `npx -y` installs (viem is the only runtime dep — self-contained). Until published, runs from source (`npm run verify -w verifier`). **Add the green nightly-audit badge to the README top fold** when published.
- [ ] **`GET /forecasts?inputsHash=0x…` worker route** — additive read-only route in `agent/src/server.ts` for full preimage *disclosure* (the "why" behind each move). NOTE: no longer blocks invariant 5 — receipt integrity is pure-chain (`decisionId = keccak(forecastHash|kind)`, confirmed against live events 2026-07-23). Nice-to-have, not a dependency.
- [ ] Expand the golden snapshot as live history grows (refresh `verifier/fixtures/live-history-*.json` + bump expected counts in `golden.test.ts`). Live is now at 5 moves.
- [ ] **CP2 submission (KR1, deadline Sun Jul 26)** — draft the progress summary + polish the README top fold (claim, `npx -y` block, badge, dashboard link, addresses, three trust tiers). Not yet done.

## Operational (from the 2026-07-23 outage) — RESOLVED
- [x] **Railway deploy** — done. Railway does NOT auto-deploy from `main` (deploys are manual `railway up --service <worker|dashboard>`). Worker + dashboard both redeployed 2026-07-23; loop revived, first WITHDRAW landed 18:24 UTC.
- [ ] Confirm the **healthchecks.io** alert now actually fires on a FAILED storm (the fix pings `/fail` on 3 consecutive FAILED; the Friday §15.4 chaos drill should now catch a process-up-but-all-failing state, which it missed for 8 days). Wire the worker's `HEARTBEAT_URL` if not already set on Railway.

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
