# TODOS

Deferred work, captured by /autoplan run 3 (2026-07-14). Items here are consciously out of current scope — not forgotten, not silently dropped.

## Verifier — CP2 finish line (core shipped 2026-07-23, `verifier/`)
- [ ] **npm publish** `@yield-cfo/mandate-verify` with `--provenance` from Actions + 2FA, zero postinstall. Bundle to a single-file CLI (tsup/esbuild) so cold-cache `npx -y` installs (viem is the only runtime dep; no workspace deps to inline — the package is self-contained). Until published, the command runs from source (`npm run verify -w verifier`).
- [ ] **Nightly audit CI** → writes `verdicts.json` to a dedicated `audit-log` git ref → dashboard proxy splices an in-band `audit` block into `/api/events` (raw.githubusercontent, not api.github.com). Green badge in README.
- [ ] **Dashboard audit surface** — the design-pinned scoreboard band (5 invariant chips + "N moves × 5 invariants — 0 violations" + closest-approach stat) above the log + per-row verdict chips. Joined on `txHash` (dashboard has no keccak dep). No plumbing failure ever renders red.
- [ ] **`GET /forecasts?inputsHash=0x…` worker route** — additive read-only route in `agent/src/server.ts` for full preimage *disclosure* (the "why" behind each move). NOTE: no longer blocks invariant 5 — receipt integrity is pure-chain (`decisionId = keccak(forecastHash|kind)`, confirmed against live events 2026-07-23). This route is now the preimage-explorer nice-to-have, not the verifier's dependency.
- [ ] Expand the golden snapshot as live history grows (refresh `verifier/fixtures/live-history-*.json` + bump expected counts in `golden.test.ts`).

## Operational (from the 2026-07-23 outage)
- [ ] **Railway deploy of the RPC-pool fix is PENDING** — `50326a2` is on `main` but the worker did not auto-redeploy; it's still running the single-endpoint code and still failing every cycle. Needs a manual Railway deploy of latest `main` (or confirm which branch/trigger Railway watches). Until then the loop stays dead. See NOW.md incident section.
- [ ] Confirm the **healthchecks.io** alert now actually fires on a FAILED storm (the fix pings `/fail` on 3 consecutive FAILED; the Friday §15.4 chaos drill should now catch a process-up-but-all-failing state, which it missed for 8 days).
- [ ] **USYC allowlist ambiguity** — Circle's 2026-07-15 confirmation says "enabled you for the ARC testnet **USDC** allowlist" but the request was **USYC** (the Teller). Confirm USYC specifically before building the venue adapter (§17.4) against it.

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
