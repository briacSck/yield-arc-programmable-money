# Implementing a conforming AgentMandate

This verifier is not only YIELD's self-audit — it is the **conformance tool** for the mandate
interface. Implement the interface below, deploy anywhere the verifier can reach (it ships
configured for Arc testnet), and one command machine-checks your deployment's full history against
the same five invariants YIELD's live mandate is held to:

```bash
# from a clone, after `npm install`:
npx tsx verifier/src/cli.ts --address 0xYourMandate --deploy-block <constructor block>
# or cold, no clone at all:
npx -y https://github.com/briacSck/yield-arc-programmable-money/releases/download/v0.1.0/yield-cfo-mandate-verify-0.1.0.tgz \
  --address 0xYourMandate --deploy-block <constructor block>
```

Exit codes are a contract: **0** compliant · **1** a real violation (the tool working) · **2** an
operational problem, nothing proven either way.

The reference implementations live in this repo: `contracts/contracts/AgentMandate.sol` (v1, the
live deployment) and `contracts/contracts/AgentMandateV2.sol` (venue-aware v2). The verifier's pure
replay core — the executable form of everything below — is `verifier/src/core/replay.ts`, zero I/O.

## The interface

Roles and state (all amounts in **6-decimal base units** of the treasury asset):

```solidity
address owner;            // the principal (company / human)
address agent;            // the agent's signer
uint256 floorUsdc;        // balance the agent must never draw the principal below
uint256 maxTicketUsdc;    // per-transaction cap on risk-adding moves
uint256 dailyCapUsdc;     // 24h budget-window cap on risk-adding moves
bool    revoked;          // owner kill switch
uint256 companyBalance;   // the principal's liquid, floor-protected position
uint256 deployedBalance;  // funds moved into the deployed leg
```

Functions:

```solidity
// Risk-ADDING: company → deployed. Triple-gated, blocked when revoked.
function deposit(uint256 amount, bytes32 decisionId, bytes32 forecastHash) external; // onlyAgent whenNotRevoked

// Risk-REDUCING: deployed → company. NEVER gated by the mandate — callable even when revoked.
function withdrawToCompany(uint256 amount, bytes32 decisionId, bytes32 forecastHash) external; // onlyAgent

// Owner controls.
function setMandate(uint256 floor, uint256 maxTicket, uint256 dailyCap) external; // onlyOwner
function revoke() external;   function reinstate() external;                      // onlyOwner
function emergencyWithdrawAll() external;                                         // onlyOwner, unconditional
```

The six events — the verifier's **fixed ABI**. Signatures must match byte for byte; the verifier
reconstructs the whole mandate state from these alone:

```solidity
event DecisionExecuted(bytes32 indexed decisionId, uint8 kind, uint256 amount, bytes32 forecastHash);
event MandateChanged(uint256 floor, uint256 maxTicket, uint256 dailyCap);
event Revoked(address by);
event Reinstated(address by);
event CompanyFunded(uint256 amount, uint256 newCompanyBalance);
event EmergencyWithdrawal(address to, uint256 amount);
```

- `kind` is `0` for DEPLOY (risk-adding) and `1` for WITHDRAW (risk-reducing).
- The **constructor MUST emit `MandateChanged`** with the initial bounds — that is how a verifier
  seeds mandate state from the deploy block. A live scan that never sees it refuses to emit a
  verdict (operational error, never "vacuously compliant").
- `CompanyFunded.newCompanyBalance` carries the contract's authoritative post-state; the verifier
  asserts its reconstruction against it at every funding event and reports drift.
- Unknown topics are tolerated and counted, never fatal — additive events (see the v2 venue
  extension below) are safe.

## The five invariants (normative)

A conforming `deposit` MUST revert unless ALL of 1–4 hold, and both entry points are subject to 5.

1. **floor** — after the move, `companyBalance >= floorUsdc`. The contract checks the **addition
   form** — revert if `companyBalance < amount + floorUsdc` — because the subtraction form
   underflows before reaching a named error. Equality is legal: draining to exactly the floor
   passes.
2. **ticket** — `amount <= maxTicketUsdc`, using the value **in force at that move** (a prior
   `setMandate` re-versions the caps; the verifier versions them by `(blockNumber, logIndex)`).
3. **window** — the 24h cap is an **exact lazy tumbling window**, NOT a rolling sum:

   ```
   if (blockTimestamp >= windowStart + 86400) {   // boundary is >=
       windowStart = blockTimestamp;               // the deposit's own timestamp, not a fixed stride
       windowDeployed = 0;
   }
   require(windowDeployed + amount <= dailyCapUsdc);  // equality allowed
   windowDeployed += amount;
   ```

   Consequences your implementation must reproduce: up to `2 × dailyCap` can legally deploy across
   one boundary; `setMandate` does NOT reset the window; `emergencyWithdrawAll` does NOT touch
   window state. A verifier that checks "sum of deposits in any 24h ≤ cap" is checking a
   **different, stricter predicate** and will flag legal histories.
4. **asymmetry** — `deposit` reverts when `revoked`; `withdrawToCompany` MUST NOT be gated on
   `revoked`; `emergencyWithdrawAll` MUST succeed for the owner unconditionally. Firing the agent
   can never trap funds, and the safe exit is never blocked.
5. **receipt** — the idempotency key derives from the reasoning commitment:

   ```
   decisionId = keccak256( utf8( hex(forecastHash) + "|" + KIND ) )    KIND ∈ {"DEPLOY","WITHDRAW"}
   ```

   where `hex(forecastHash)` is the lowercase `0x`-prefixed 32-byte hex string. This makes receipt
   integrity **purely on-chain checkable**: given only the emitted
   `(decisionId, kind, forecastHash)`, anyone re-derives the binding with no off-chain data. A
   reused `decisionId` MUST revert (replay guard); the verifier reports a duplicate in history as a
   contract-level impossibility. `forecastHash` itself commits the canonical serialization of the
   inputs the decision was computed from (in YIELD, RFC 8785-style canonical JSON — sorted keys, no
   insignificant whitespace); serving that preimage is optional disclosure, not required for the
   invariant.

Gate order in the reference `deposit`: replay guard → floor (addition form) → ticket → window.

## Conformance vectors — the fixtures ARE the spec

An implementation conforms iff a verifier of the rules above produces the expected verdicts on
these event streams. They are **normative**: if your reading of the prose disagrees with a fixture,
the fixture wins.

| Vector | File | Expected verdict |
|---|---|---|
| **Violating, one per invariant** — floor breach, ticket breach, 24h-window burst, deposit-while-revoked, non-deriving `decisionId` | [`verifier/src/core/replay.test.ts`](src/core/replay.test.ts) (`VIOLATION ·` cases — hand-written `NormalizedEvent[]` streams the frozen reference contract can no longer emit; that is their point) | each is CAUGHT (exit 1) |
| **Compliant-adversarial** — histories a naive verifier falsely flags: balance exactly `== floor`; cap exactly filled; the legal 2× burst straddling a window boundary; a deposit one second before the boundary; `setMandate` mid-window (re-versions, no reset); `emergencyWithdrawAll` → re-fund → deposit (window carried); revoke → withdraw → reinstate → deposit; multiple deposits in one block | [`verifier/src/core/replay.test.ts`](src/core/replay.test.ts) (`OK ·` cases) | NOT flagged (exit 0) |
| **The negative demo** — a naive unbounded agent violating everything, including the duplicate-`decisionId` replay guard (block 20) | [`verifier/fixtures/naive-agent.json`](fixtures/naive-agent.json) (run it: `--fixture naive-agent`) | 13 violations, exit 1 |
| **Live-history golden** — the reference deployment's real history at a pinned block | [`verifier/fixtures/`](fixtures/) `live-history-*.json` (run it: `--fixture live-snapshot`) | COMPLIANT, exit 0 |

To run the whole suite against your changes: `npm test -w verifier`.

The fixture format is the verifier's `NormalizedEvent` JSON (string-encoded bigints — see
[`verifier/src/fixtures.ts`](src/fixtures.ts) for the exact hydration). Writing your own vectors as
event streams and feeding them to `replay()` needs no chain and no fork: the core is pure.

## What conformance does NOT require

- **Storage layout or extra views** — the verifier reads events only.
- **A yield venue** — escrow-only (v1 behaviour) conforms. The v2 venue extension
  (`VenueChanged` / `VenueSubscribed` / `VenueRedeemed` / `VenueExitFailed` / `TokenRescued`) is
  additive: a venue-aware verifier reconstructs the deployed leg as cost basis + shares and
  cross-checks venue flows against receipts, but the five invariants are computed identically with
  or without venue events.
- **The application layer** — how the agent computes decisions is out of scope; the mandate binds
  what it may do and receipts bind what it claimed to think.

## Checklist

- [ ] Six event signatures byte-identical; constructor emits `MandateChanged`.
- [ ] `deposit` gate order: replay → floor (addition form) → ticket → window; blocked when revoked.
- [ ] Window is lazy-tumbling exactly as specified (`>=` boundary, own-timestamp reset, equality allowed, no reset on `setMandate`/`emergencyWithdrawAll`).
- [ ] `withdrawToCompany` ungated by the mandate; `emergencyWithdrawAll` unconditional for the owner.
- [ ] `decisionId` re-derives as `keccak256(utf8("<forecastHash>|<KIND>"))`; reuse reverts.
- [ ] `CompanyFunded` carries the authoritative post-balance.
- [ ] `npx tsx verifier/src/cli.ts --address <yours> --deploy-block <n>` exits 0 on your history.
- [ ] `npm test -w verifier` stays green if you add vectors.

Questions about the interface itself (extensions, standardization) → open an issue; the
specification document is maintained by the YIELD team.
