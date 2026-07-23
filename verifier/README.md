# @yield-cfo/mandate-verify

**Replay a YIELD `AgentMandate`'s full on-chain history and machine-check every move against its five invariants — in one command, zero config.**

```bash
npx -y @yield-cfo/mandate-verify
```

No args, no env, no prompts: it verifies YIELD's **live** mandate on Arc testnet
([`0x856bec6f…c782b4`](https://testnet.arcscan.app/address/0x856bec6faadd61b583430e0cd22ec2e211c782b4)),
replaying every `DecisionExecuted` / `MandateChanged` / `Revoked` / `Reinstated` / funding event
from the deploy block and checking each agent move against the mandate the contract actually
enforced. Full live history verifies in **~6 seconds**.

> The chain records *what* the agent did. This proves it could never have done otherwise.

## The five invariants

| Invariant | What it proves |
|---|---|
| **floor** | After every DEPLOY the company balance stayed above the owner-set floor. |
| **ticket** | No single deploy exceeded the per-ticket cap in force at that block. |
| **window** | The 24h budget was never breached — an **exact** replay of the contract's lazy tumbling window (a naive rolling-24h sum produces false alarms on legal history). |
| **asymmetry** | No deposit while revoked; withdrawals (risk-reducing) always allowed — the mandate thesis in one check. |
| **receipt** | Each move's `decisionId` re-derives on-chain as `keccak(forecastHash \| kind)` — the forecast the agent acted on is cryptographically bound to the move. **No external data required.** |

These are **history-level** properties (the window is rolling; asymmetry is a property of the
revocation history), not per-row checks — so the verifier reconstructs mandate state event by event
and re-derives the exact predicate the contract enforced at each move.

## Try it

```bash
# Verify the live mandate (the judge command)
npx -y @yield-cfo/mandate-verify

# See a violating agent fail the same audit — the negative demo
npx -y @yield-cfo/mandate-verify --fixture naive-agent      # exits 1, 13 violations

# Offline: verify a committed snapshot of YIELD's real history (works behind any firewall)
npx -y @yield-cfo/mandate-verify --fixture live-snapshot

# Machine-readable verdict
npx -y @yield-cfo/mandate-verify --json
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | **COMPLIANT** — the agent stayed within its mandate. |
| `1` | **VIOLATION** found — the verifier caught an out-of-bounds move (the product working). |
| `2` | **Operational error** — RPC/args failed; nothing proven either way. An RPC flake never prints red. |

## Options

```
--fixture <name>     verify a compiled-in fixture, no network (naive-agent | live-snapshot)
--address <0x..>     verify a different mandate (any conforming deployment)
--deploy-block <n>   the mandate's constructor block (required with --address)
--rpc <url>          override the RPC endpoint (default: built-in Arc endpoint pool)
--json               emit the verdict record and nothing else
-h, --help
```

`--address` is first-class: the verifier is not hard-wired to the author's deployment — any agent
under the same mandate interface can be audited.

## Trust ladder

The audience is precisely people who think about trust, so nothing here asks for any:

- **Run nothing** — watch the [live dashboard](https://dashboard-production-abea.up.railway.app).
- **Run one command** — `npx -y @yield-cfo/mandate-verify` (above).
- **Build from source** — the entire invariant logic is one pure, I/O-free file:
  [`src/core/replay.ts`](./src/core/replay.ts). Clone, read it, run `npm test -w verifier` (both
  violating and compliant-adversarial fixtures + a golden test against real history).

## How it's built

Two layers, split so the checks are testable without a live chain:

- **fetch** (`src/fetch.ts`) — the only I/O. Chain logs → `NormalizedEvent[]`, ordered by
  `(blockNumber, logIndex)` (never timestamp: Arc has sub-second blocks), tolerating unknown topics
  (Arc EIP-7708 native-transfer logs).
- **core** (`src/core/replay.ts`) — **pure**: `NormalizedEvent[] → Verdict`. Deterministic, no
  network, no clock. Fixtures are hand-written event streams fed straight to it — including
  histories the frozen contract can no longer emit (a floor breach, a post-revoke deposit), which
  is exactly how the negative demo and the "verify the verifier" proof work.

Part of the [YIELD — Agentic CFO on Arc](../README.md) monorepo. MIT.
