# AGENTS.md

> Coordinates human + AI coding agents across the team — committed so every clone (and every
> teammate's Claude Code session) bootstraps with the same rules and current state.
> `docs/PLAN.md` (internal strategy) stays gitignored and local — ask Briac for the share copy.

## Invariants — never violate

1. **All money movement through `ChainExecutor`** — never construct a transaction anywhere else.
2. **Decision logic is pure and config-driven** — property tests must stay green.
3. **Never fake or simulate on-chain results in a default code path** — `MockChainExecutor` only
   behind an explicit env flag (`CHAIN_EXECUTOR=mock`).
4. **Any degraded input → `HOLD`.**
5. **Schemas in `packages/shared` change only with team agreement.**
6. **No secrets in code or commits; no mainnet keys in this repo, ever.**
7. **Small PRs, conventional commits, typecheck + tests green before merge.**
8. **When code and docs disagree, code wins** — fix the doc in the same PR.

## Session bootstrap

Read, in order:
1. this file (`AGENTS.md`),
2. `docs/NOW.md` — current targets, blockers, deployment URLs + contract addresses (committed;
   update it in the same PR as any state-changing work),
3. `docs/PLAN.md` — the execution plan (the § numbers referenced in NOW.md). Gitignored/local:
   if you don't have it, ask Briac before starting plan-referenced work.

**Do not start a task that is not listed in `docs/NOW.md` without asking.**

## Where things live

- `packages/shared/` — the pinned interface contracts (zod). The seam between all tracks.
- `contracts/` — `SweepEscrow` (vendored, proven) + `AgentMandate` (§17.2). Hardhat 3; runs on
  CI/WSL, not on the ARM64 dev machine.
- `agent/` — decision engine (§16.3), `ChainExecutor` selection, scheduler, heartbeat.
- `forecast/` — deterministic baseline (§16.4); t0 service upgrades `modelId` later.
- `scenario/` — seeded "Boulangerie Chartier" ledger + simulated clock (§11 / §16.5).
- `dashboard/` — one API route over the event log.
