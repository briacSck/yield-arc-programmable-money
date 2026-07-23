# Underwriting Memo — YIELD CFO Agent

- **Certificate:** `uw-2026-07-22-42569c04`
- **Issued:** 2026-07-22T14:14:48Z
- **Verification mode:** `degraded-heuristic` (see below)
- **Subject:** wallet `0x93d9…ab7c` · mandate `0x856b…82b4` · Arc testnet chain `5042002` · ERC-8004 agentId `850878` on registry `0x8004…BD9e`

> **Preliminary.** This certificate is preliminary and pending machine verification. It is built entirely from public, read-only data fetched this run (Arc testnet RPC `eth_call`/`eth_getBalance` and the public dashboard). No transaction was signed or sent, and `stub-v0` is a disclosed placeholder formula — not an actuarially bound quote.

## What I checked

**Machine-verification upgrade (attempted first).** Ran `npx -y @yield-cfo/mandate-verify --json`. The package is not published yet (npm `E404 Not Found`) — the expected state today — so I fell back to my own read-only heuristic checks and set `verification.mode = degraded-heuristic`. A missing package is normal, not a problem.

**Dashboard.** `GET /api/events?limit=200` → HTTP 200 (289 KB). Reported stats: **781 cycles / 781 decisions, 1 on-chain move** (first = last = 2026-07-14T11:18:24Z), **0 floor breaches**, last cycle 2026-07-22T14:05:21Z. All 200 decision events in the window are `HOLD` cycles the CFO itself labels `status:"FAILED"` — each with reason *"cycle inputs failed (RPC request limit reached) — refusing to act on degraded input."* That is the CFO's **own telemetry** about conservative behavior: when its RPC feed was rate-limited, it declined to trade rather than act on bad data. I report it as such — it is not an underwriting failure. The dashboard's `mandate` snapshot field is `null` (a data gap), so I cross-checked the mandate directly on-chain instead.

**On-chain (viem, Arc RPC).** `chainId` confirmed **5042002**. AgentMandate getters (6-decimal USDC):

| Getter | Raw | USDC |
|---|---|---|
| floorUsdc | 5000000 | 5.00 |
| maxTicketUsdc | 2000000 | 2.00 |
| dailyCapUsdc | 5000000 | 5.00 |
| companyBalance | 6000000 | 6.00 |
| deployedBalance | 4000000 | 4.00 |
| windowDeployed | 4985900 | 4.9859 |
| windowStart | 1784017473 | 2026-07-14T08:24:33Z |
| revoked | false | active |

Some getters (`dailyCapUsdc`, `revoked`, `companyBalance`, `windowDeployed`) first hit transient RPC *"request limit reached"* rate-limiting — the same condition the CFO's HOLD cycles show — and **resolved cleanly on retry**. RPC hiccups are data gaps, never treated as breaches. Agent wallet native balance (`eth_getBalance`) = `6972875235313535495` wei; the native gas token is 18-decimal, so ≈ **6.97 USDC-equivalent** of gas.

## What I found

- **Mandate active, no breaches.** `revoked=false`; `companyBalance` 6.00 > `floor` 5.00 (buffer **1.00 USDC**); dashboard `floorBreaches=0`.
- **Daily-cap utilization ≈ 99.72%** (`windowDeployed` 4.9859 / `dailyCap` 5.00). Within cap, no breach — but running close to the limit, worth watching.
- **Gas healthy.** ≈6.97 USDC vs my disclosed 1.00 USDC healthy-gas threshold (the surcharge floor) — comfortably above.
- **Dashboard ↔ chain agree** on every cross-checkable field (identifiers, single on-chain move, zero floor breaches consistent with active mandate and balance above floor). Only gap is the null dashboard snapshot, covered by direct on-chain reads.
- **Pending (not failures):** per-move ticket-size adherence (individual move amounts aren't exposed; the one lifetime move predates the event window) and the ERC-8004 registry read (not required this run).

## Risk stats

| Metric | Value |
|---|---|
| On-chain move count | 1 |
| Closest approach to floor | 1.00 USDC (companyBalance − floor) |
| Daily-cap utilization | 99.72% |
| Floor breaches | 0 |
| Revoked | false |
| Gas balance | 6.97 USDC-equivalent |
| Dashboard/chain agreement | Full on all cross-checkable fields |

## Premium — `stub-v0`

- `max_loss_per_window = min(dailyCap 5.00, max(0, companyBalance 6.00 − floor 5.00)) = ` **1.00 USDC**
- `compliant_days = ` **8** (consecutive days no floor breach & not revoked, from first on-chain move 2026-07-14 to now; anchored to the seed baseline of 1 day on 2026-07-15)
- `hazard = clamp(0.10 × 0.98^8, 0.02, 0.10) = ` **0.085076**
- `surcharge = ` **1.0** — no *core* check is UNVERIFIED (the one UNVERIFIED item, the null dashboard snapshot, is non-core and covered on-chain), and gas 6.97 ≥ 1 USDC so no gas surcharge
- **`premium_30d = 1.00 × 0.085076 × 1.0 = 0.0851 USDC`** over 30 days

Plain English: 30-day premium = insurable exposure this window × a hazard rate that decays with clean days × surcharges for unverified data / low gas.

## Trend

The only prior record is a **seeded, synthetic baseline** (`uw-seed-0`, premium ≈ $49.00, `compliant_days=1`, synthetic `max_loss` $500) — **not a real assessment**. This is the first real run. Today's premium **$0.0851** is far below it, driven mainly by the real (small) on-chain exposure — `max_loss_per_window` of **$1.00** versus the seed's synthetic $500 — and secondarily by accrued compliant history dropping the hazard from 0.098 to 0.0851 (`compliant_days` 1 → 8). This is **not** a like-for-like comparison because the baseline was synthetic; future real runs should show the premium drift down further as clean days accumulate.

## Disclaimers

This certificate is **preliminary and pending machine verification**, produced in degraded-heuristic mode because the `@yield-cfo/mandate-verify` package is not yet published. All figures come from public read-only data fetched this run; no key was used and no transaction was signed or sent. `stub-v0` is a disclosed placeholder pricing formula, not a bound quote. Transient RPC rate-limiting affected some reads and the CFO's own cycles; such data-plumbing issues are data gaps, not mandate violations.
