# NOW — living state

> **Committed + team-shared** (the repo is public — keep strategy/competitive notes in the local
> `docs/PLAN.md`, never here). Updated at every standup (owner: whoever ran standup). Every session
> starts by reading it; every session that changes state updates it in the same PR.

_Last updated: 2026-07-14 midday (DAY 2b: trade mode LIVE, dashboard built, Railway in progress)_

## Deployment URLs + addresses

| Thing | Value |
|---|---|
| **Dashboard (public)** | `https://dashboard-production-abea.up.railway.app` _(deploy pending workspace billing — services + volume + vars are configured; local loop carries the clock meanwhile)_ |
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

## Railway state (finish this first next session if not done)

Configured end-to-end: project + 2 services + `/data` volume + all env vars (worker: chain +
Circle creds + trade mode + volume paths, NIXPACKS build/start cmds; dashboard: `WORKER_URL=
http://worker.railway.internal:8787` + build cmds). **Blocked on: workspace billing (Hobby plan)
on "Briac's Projects"** — builds fail at scheduling with no logs until then. After billing:
`railway up --service worker --ci` then `--service dashboard`, verify
`https://dashboard-production-abea.up.railway.app/health` → 200, THEN kill the local loop
(one owner). Local machine is on never-sleep and carries the clock meanwhile.

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
- ⏳ **Railway Hobby billing** on Briac's Projects → deploy auto-retries.
- **HEARTBEAT_URL is NOT set** (template comment mistaken for a value) — create a check at
  healthchecks.io, then set it locally in `.env` AND `railway variables --service worker --set
  HEARTBEAT_URL=…`. Until then the loop runs unmonitored.
- USYC allowlist ticket (draft in git history of this file) · CP1 blurb (§10) by Saturday ·
  Corey ping (§9.3) · 30-min Discord recon.
- **Vadim**: nod on two additive changes — venue seam (§17.2 IVenue) + `DecisionConfig` cap
  fields (shipped, flagged); review AgentMandate + the trade-gate sims.

## Reminders

- Local loop = the only runner until Railway is green. One owner at a time — never both in trade.
- Never cut: Tier-1 uptime, decision receipts, mandate revoke, video quality, submit Aug 8.
