# TODOS

Deferred work, captured by /autoplan run 3 (2026-07-14). Items here are consciously out of current scope — not forgotten, not silently dropped.

## Post-hackathon
- [ ] `/api/events` pagination: `server.ts` caps `limit` at 1000 (~890 records by Demo Day — fine; silently truncating from late August). The verifier is deliberately independent of this route.
- [ ] Verifier support for non-AgentMandate contracts (generalize the fetch layer once a second real implementer exists).
- [ ] Real underwriter premium pricing (stub formula is disclosed by design for the hackathon).

## Gated (opens with a specific decision)
- [ ] Salted receipt commitments (`keccak(salt ‖ canonicalJson)`) + authenticated preimage access — REQUIRED before pilot mode (real Akoneo ledger) ever feeds the loop; spec already in the ERC draft's security-considerations section.
- [ ] Approach C adopt-kit (npm quickstart + outreach inviting other teams to implement the mandate interface) — W3-slack only, per design doc; re-evaluate at W3 kickoff.
- [ ] AttestationRegistry automation beyond nightly CI (only if the W3 attestation gate opens).

## Small errata (fold into the first verifier PR)
- [ ] `AgentMandate.sol` NatSpec claims `keccak(inputsHash ‖ kind ‖ asOf)` and PLAN §17.2 claims `keccak(inputsHash ‖ window)` — both wrong vs the executor's actual `keccak(utf8("<inputsHash>|<kind>"))`. Contract is frozen; fix the docs (invariant 8: code wins).
