# Vendored assets — provenance

Per plan §5, the hackathon repo starts fresh and **vendors** the proven Arc primitives (copies,
not dependencies). Do not re-sync from the source branch; evolve these copies here.

**Source:** `yield-ai-solution/yield-backend`, branch `feat/arc-sprint-identity`
**Commit:** `1dc5e88` — *feat(arc): register on canonical ERC-8004 registry + ABI drift-check (TODO-12)* (2026-06-23)

| File here | Source path | Notes |
|---|---|---|
| `contracts/SweepEscrow.sol` | `contracts/contracts/SweepEscrow.sol` | ✅ CI-proven min-balance covenant, verbatim |
| `hardhat.config.ts` | `contracts/hardhat.config.ts` | verbatim (Hardhat 3 + mocha/ethers, ESM) |
| `test/SweepEscrow.test.ts` | `contracts/test/SweepEscrow.test.ts` | verbatim |
| `scripts/deploy.ts` | `contracts/scripts/deploy.ts` | verbatim; still references yield-backend `.env` var names in comments |
| `scripts/register-arc-agent.ts` | `scripts/register-arc-agent.ts` (repo root) | ⚠️ moved into `contracts/scripts/`; its imports assume yield-backend `src/arc/*` — **rewire before running** |
| `abis/IdentityRegistry.json` | `contracts-erc8004/abis/IdentityRegistry.json` | ERC-8004 IdentityRegistry ABI |
| `package.json` | `contracts/package.json` | verbatim |

**New in this repo (not vendored):**
- `contracts/AgentMandate.sol` — the mandate contract extending the covenant idea (plan §17.2). Interface skeleton; risk logic is `TODO(Vadim)`.
- `test/AgentMandate.test.ts` — §17.7 test bar; risk cases are `it.skip` pending implementation.

**ARM64 note:** Hardhat does not run on Briac's ARM64 machine. Contract iteration is Vadim-local
or via CI/WSL; `arc-verify.yml` (real-EVM CI) is the source of truth.
