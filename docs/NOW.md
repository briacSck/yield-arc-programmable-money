# NOW — living state

> **Committed + team-shared** (the repo is public — keep strategy/competitive notes in the local
> `docs/PLAN.md`, never here). Updated at every standup (owner: whoever ran standup). Every session
> starts by reading it; every session that changes state updates it in the same PR.

_Last updated: 2026-07-14 evening (plan v3 APPROVED — W2 verifier track specced; Tier-1 live and untouched)_

## PLAN v3 APPROVED (2026-07-14 evening) — W2 build order

Full spec lives in the local plan (§18, four pinned layers: design/eng/DX/narrative). Team-safe summary — W2 lanes in order:
1. **Worker preimage route FIRST**: one additive `GET /forecasts?inputsHash=0x…` in `agent/src/server.ts` + worker redeploy (scheduler/decision/executor untouched — that's the redefined "untouchable" boundary).
2. **`verifier/` package**: two-layer (fetch → pure replay core); 5 invariants machine-checked over full mandate history; invariant 3 = EXACT lazy-tumbling-window replay (naive rolling sums = false alarms); both fixture suites (violating + compliant-adversarial ≥8) + live-history golden test; bundled single-file CLI, zero-config defaults, `--fixture`, exit codes 0/1/2, <60 s budget asserted in CI. Degraded ship path if 5/5 slips past **Wed Jul 22**: receipt-check-only for CP2, disclosed.
3. **Audit surface on the dashboard**: scoreboard band above the log (5 invariant chips + "N moves × 5 invariants — 0 violations" + closest-approach stat) + per-row verdict chips (PASS/VIOLATION/PENDING/UNVERIFIED — never "FAILED"; post-revoke blocked moves render `BLOCKED — mandate enforced` in sage). Verdicts arrive via nightly CI → `audit-log` git ref → proxy splice into `/api/events`. No plumbing failure may ever render red.
4. **ERC draft** (Briac, ≤3 afternoons): interface + invariants + prior-art falsification (incl. Enzyme/Zodiac) + normative hash rules + fixture files as conformance vectors.
5. **README top fold at CP2**: claim one-liner, `npx -y` block, nightly-audit badge, dashboard link, mandate address + arcscan, Circle tools named, three trust tiers.

**Vadim nods pending (one batch):** shared-schema cap fields (below) + venue seam + mandate-interface generalization + AgentMandate/trade-gate sims review.
**Today-actions:** npm org check — `@yield` likely taken → lock **`@yield-cfo`** before CP1 copy freezes the string. `TODOS.md` now tracks deferred items (incl. the decisionId NatSpec errata — fold into the first verifier PR).

## Deployment URLs + addresses

| Thing | Value |
|---|---|
| **Dashboard (public, LIVE)** | `https://dashboard-production-abea.up.railway.app` — /health 200, content-based |
| **AgentMandate (LIVE)** | `0x856bec6faadd61b583430e0cd22ec2e211c782b4` — floor 5 / ticket 2 / dailyCap 5 USDC, 6-dec pools |
| **ERC-8004 agent identity** | agentId `850878` on `0x8004A818…BD9e` |
| Agent wallet (EOA, Circle) | `0x93d9c11c8e9e23e1e97e855668a27a14accaab7c` |
| Company wallet = owner | `0x4704fb05a6e87c482090cf5534e86c9ab44bbfda` |
| Railway project | `yield-agentic-cfo` (Briac's Projects): `worker` (loop + /data volume + internal :8787) + `dashboard` (Next, proxies) |

## DAY 2b — what shipped

**TRADE MODE IS LIVE (supervised day, gate f).** The scheduler now decides from LIVE chain state
each cycle and executes through the mandate on its own: **first scheduled autonomous DEPLOY
2 USDC** `0x9b9d5ee2…4ffde7` at 09:58 UTC (cycle #1), then cycle #2 correctly SKIPPED on the 6h
anti-oscillation cooldown. The compounding on-chain clock started 2026-07-14.

- **Loop economics hardened** (`39326a3`): dip predicate partitions risk-on/risk-off seasons (no
  deploy INTO a projected crunch → no ping-pong); engine clamps deploys to live mandate caps
  (`DecisionConfig.maxTicketUsdc/dailyCapRemainingUsdc`, additive — **Vadim: schema nod needed**,
  same batch as the venue seam); scaled Boulangerie ledger (1:3800) anchored on TOTAL liquidity;
  6h cooldown; gas preflight → heartbeat FAIL; out-of-line `forecasts.jsonl`; torn-line-tolerant
  log with seq resume (proven across live restarts); trade-gate sims (a)(b)(c)(g) green — 39/39.
- **Dashboard v1 built** (`669bc73`): claim strip w/ live counters · forecast cone as ledger
  horizon (P10–P90 fan, floor rule, decision markers) · decision log (weighted moves + ✓ receipt
  badges, quiet HOLDs, honest FAILED) · on-chain mandate contract panel · uptime strip · revoked
  full-page mode. English, USDC formatter, UTC times, 1:3800 scale chip, paper/ink/sage + Geist.
  UI has ZERO chain reads — one route proxying the worker.
- **Worker HTTP surface**: `/events` (stats + latest forecast + tail + 15s-cached mandate
  snapshot + agent gas), `/health` (content-based: FAILED-storms and gas death read degraded even
  when fresh).
- Executor: retry-once on Circle first-connection resets (caught live on cycle #0).

## Railway state — DEPLOYED ✅ (2026-07-14 ~11:18 UTC)

Two services live on project `yield-agentic-cfo`: `worker` (loop + /data volume + internal
:8787, trade mode, 15-min cycles) + `dashboard` (public URL above, proxies the worker). The
Railway worker's **first autonomous cycle deployed 2 USDC on its own** (`0xf0b60b…dc44`) —
daily budget now 4.98/5.00, caps visibly binding. Local loop KILLED (one owner). Deploy
gotchas for the record: Railway builds with **Railpack** (NIXPACKS_* vars ignored) → root
`start`/`build` dispatch on `RAILWAY_SERVICE_NAME` (`scripts/railway-*.mjs`); Circle SDK needs
the ESM/CJS interop import (`agent/src/chain/index.ts`); Node pinned to 24 (`.node-version`).
Redeploying the dashboard NEVER touches the worker — iterate UI freely.

## Video shot list v1 (§11 beats → shots; build B-roll against these)

1. **Open (0:00–0:20)**: dashboard claim strip close-up — "running unattended since Jul 14 ·
   N on-chain decisions · 0 floor breaches", then zoom out to full page.
2. **The brain (0:20–0:50)**: cone close-up — floor rule + P10 fan; cut to identity badge →
   arcscan registry (agentId 850878).
3. **Beat 1 — deploy (0:50–1:20)**: decision-log row appears (DEPLOY + reason sentence) →
   click tx → arcscan confirmation ~2s → back to cone, marker lands on the horizon.
4. **Beat 2 — pull-back (1:20–1:45)**: pre-payroll dip: P10 crosses floor on the cone →
   WITHDRAW row "pulling funds back ahead of the crunch" → arcscan.
5. **Beat 3 — exposure (W3, once SPICE leg lands)**: wheat shock → FLOOR_RAISE row w/ exposure.
6. **Kicker (2:10–2:25)**: owner revoke tx → full-page revoked mode (banner + greyed cone +
   "MANDATE REVOKED" rule) → attempted deposit FAILS → withdraw still succeeds → reinstate.
   (All five beats already recorded on-chain 2026-07-14 — links in git history/NOW archive.)
7. **Close (2:25–3:00)**: architecture flash naming Circle tools (Wallets, Contracts/SCP,
   native-USDC gas, ERC-8004/8183) → traction line → "we'll be working on this either way."

## User actions (time-sensitive)

- ✅ Team confirmed (Vadim + Sara in). ✅ Sleep off on the dev machine.
- ✅ Railway billing + deploy (done 07-14). ✅ **Heartbeat monitoring LIVE** (healthchecks.io,
  15-min period / 10-min grace; worker pings every cycle, POSTs `/fail` on gas exhaustion —
  weekly Friday chaos drill per §15.4: kill the worker, verify the alert fires).
- ✅ USYC ticket submitted + acknowledged — ⏳ answer their additional-info request.
- CP1 blurb (§10) by Saturday · Corey ping (draft delivered 07-14) · 30-min Discord recon.
- **Vadim**: nod on two additive changes — venue seam (§17.2 IVenue) + `DecisionConfig` cap
  fields (shipped, flagged); review AgentMandate + the trade-gate sims.

## Reminders

- Local loop = the only runner until Railway is green. One owner at a time — never both in trade.
- Never cut: Tier-1 uptime, decision receipts, mandate revoke, video quality, submit Aug 8.
