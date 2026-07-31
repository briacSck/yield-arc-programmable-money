# Handoff — Vadim (CTO) · engineering workstreams to submission

**Written 2026-07-31.** Self-contained: everything you need is in this file or linked from it.
The strategy docs `docs/PLAN.md` and `docs/ERC-DRAFT.md` are **gitignored** (deliberate,
pre-Demo-Day) — ask Briac to send them, but nothing below depends on reading them first.

## Deadlines (hard)

| Date | What |
|---|---|
| **Fri Aug 1** | Attention tripwire: any standard/ERC-lane work not started by EOD is auto-cut |
| **Tue Aug 5** | Feature freeze |
| Thu Aug 7 | Video recorded (Sara; your items #4/#5 are her film set) |
| **Fri Aug 8** | Submission |
| Sat Aug 9 | Hard platform lock — late = unjudged |
| Thu Aug 20, 18:00 CEST | Demo Day (live pitch; ERC public reveal) |

## Who owns what (so you don't duplicate)

- **You** — everything in this file: release engineering, verifier, dashboard plumbing, chain work.
- **Sara** — pitch deck + demo video (storyboard, capture, edit) + one-pager.
- **Briac + Claude** — docs truth sweep (test counts, timing claims, `contracts/README.md`
  rewrite, LICENSE), dashboard **copy/CSS-only** polish (demo discoverability links, kicker copy,
  micro-copy, favicon/OG, mobile CSS), submission form text, Firmata research memo.
- **Briac only** — npm token (`gh secret set NPM_TOKEN`), `setVenue` owner call (script ready,
  see below), CP2 confirmation, license decision, broker/Akoneo emails.

**Merge order:** the copy lot (Briac+Claude) touches `dashboard/app/page.tsx` too. They go first
(small diffs, fast), then you branch for #4/#5. Don't build on an unmerged copy branch.

## State of the world (verified on-chain and in-repo, 2026-07-31)

- Build is done and green on `main` (`acaf257`): contracts v1+v2, agent worker, verifier,
  underwriter, dashboard with the 90-day demo sim at `/?demo=90d`. Live:
  <https://dashboard-production-abea.up.railway.app/>
- **Live worker and nightly audit both point at mandate v1** `0x856bec6faadd61b583430e0cd22ec2e211c782b4`
  (17+ days of audited history — that streak is an asset; nothing below may endanger it).
- **USYC grant landed.** Circle/Hashnote granted the v2 mandate contract
  `0xd41d3648c71641fb2801415726787d5728492f70` **both** required roles — verified via the Teller's
  own `RolesAuthority.canCall` (not the old false-positive read):
  - `Teller.deposit` (`0x6e553f65` on teller `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`): GRANTED
  - hold USYC share (`transfer` on share token `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`): GRANTED
  - Re-check anytime: `npx tsx agent/scripts/check-usyc-permission.ts 0xd41d…2f70`
- `setVenue` is Briac's one command (`npx tsx agent/scripts/set-venue.ts --execute`; preflight
  passed 2026-07-31). After it, v2's DEPLOY leg routes USDC→USYC shares. **v1 stays the live story.**
- npm: `@yield-cfo/mandate-verify@0.1.0` never published, name unclaimed, no git tag. Blocked only
  on Briac's token. The README's front-page `npx` command 404s today (it says so itself).

## Your workstreams, in priority order

### 1. Un-break the judge command today (no npm creds needed) — ~0.5 d
The single highest-leverage item in the repo. `npx -y` accepts **tarball URLs**:
`npm pack` the verifier → attach the `.tgz` to a GitHub Release → swap the front-page command to
`npx -y https://github.com/<org>/<repo>/releases/download/<tag>/<file>.tgz` and delete the
"not live yet" note (`README.md` ~line 125, it was written to be deleted).
Also: (a) add a dry-run job to `.github/workflows/release-verifier.yml` so Briac's publish is
literally `gh secret set NPM_TOKEN` + `git tag verifier-v0.1.0 && git push origin --tags`;
(b) extend `.github/workflows/judge-command.yml` to run the interim command **from an empty temp
dir** (house rule: never validate the judge path from inside the repo).
When the real npm publish lands, flip the command back and the underwriter auto-upgrades to
`machine-verified` (zero code — `underwriter/HANDOFF.md:56`).

### 2. Verifier DX — the three defects a judge will hit — ~0.5–1 d
From the judge-surface review (`docs/PLAN-judge-surface.md:304-309`; the doc is superseded but
these findings are current):
- **X2**: RPC-retry exhaustion exits **127** (libuv assert), not the documented **2**. Nightly CI
  relies on exit 2 = "operational, don't publish" (`.github/workflows/nightly-audit.yml:41-52`).
  Catch it in `main()` of `verifier/src/cli.ts`.
- **X3**: the error doctrine line prints *after* viem dumps status/URL/body. Judge sees a wall of
  red before "this is infrastructure, not a violation". Reorder; trim the dump (`cli.ts:192`).
- **X5**: version is hardcoded in `cli.ts:16` and absent from the human footer. Single-source from
  `package.json` and print `mandate-verify v0.1.0 (<commit>)` in the footer a judge screenshots.

### 3. Venue-aware verifier — NEWLY UNBLOCKED by the grant — ~1 d
`verifier/src` has **zero** notion of a venue (grep `venue|USYC` — no hits). AgentMandateV2 emits
`VenueChanged` / `VenueSubscribed(decisionId, assetsIn, sharesMinted)` /
`VenueRedeemed(decisionId, sharesBurned, assetsOut, assetsRequested)`; USDC leaves the contract to
the Teller on deploy. Run `--address <v2>` after venue moves and today's verifier will misread it.
Until this lands, **no surface may claim "machine-verified" about yield.**
Scope: teach the reconstruction that deployed-leg = cost basis + shares (see the NAV note in
`contracts/contracts/AgentMandateV2.sol` ~line 71 and 136); treat `VenueRedeemed` shortfall
honestly; add fixtures from v2's 68 Hardhat tests. Read `agent/src/chain/usyc-venue.ts` first —
`previewRedeem(shares)` is the mark-to-market read.
Then a **proof-cycle script** (fund ~2 USDC → deploy → `VenueSubscribed` → redeem → yield delta):
you write it, Briac runs it (Circle creds live only in his `.env` / Railway). Model it on
`agent/scripts/deploy-mandate-v2.ts` (Circle SDK patterns, `waitCircle` helper) and the new
`agent/scripts/set-venue.ts`. Those two txs are what Sara cites in the video and the README claims.

### 4. ForecastCone: show the story it claims to show — ~1 d
`dashboard/app/page.tsx:285` says "…and every move the agent made", but
`dashboard/components/ForecastCone.tsx:72` drops any marker older than 24 h before `asOf` — during
the 90-day replay the signature chart is near-static. Sim ticks already carry
`companyBalanceUsdc` per day: render the **realized history as a solid line** left of `asOf`, move
markers on it, so the chart grows day by day on camera. Also `fmtAxis` (`ForecastCone.tsx:65`)
prints `38000.00` — needs `toLocaleString` + unit.

### 5. Demo beat chapters + kicker moment — ~1 d
The sim tags four beats (`scenario/src/sim.ts:85`: `deploy`, `pullback`, `exposure`, `kicker`) but
the demo adapter drops the field (`dashboard/lib/demo.ts:27-49`, `toEventRecord`). Map it through,
replace "day N/90" with a **scrubber with 4 labeled, clickable tick-marks**, add "next beat ⏭".
When the `kicker` beat fires, flash/auto-scroll the `BLOCKED — mandate enforced` row
(`page.tsx:536-558`) — it's the thesis's punchline and currently the quietest pixel on screen.
This is Sara's film set: converts 90 s of playback into a 15 s guided tour.
**Do not touch the demo honesty contract** (`dashboard/lib/demo.ts:10-17`): no fabricated audit
verdicts, no explorer links on sim data, amber banner stays.

### 6. Small paid-down items — ~0.5 d total
- `GET /forecasts?inputsHash=0x…` read-only route in `agent/src/server.ts` (`TODOS.md:10`).
- Golden snapshot refresh: `npm run snapshot -w verifier` (stale at block 53950410 / 7 moves).
- Owner passphrase: replace `window.prompt` (`dashboard/components/OwnerMode.tsx:114-126`) with a
  styled inline input matching `.owner-confirm` — it's what a judge sees if they click "Pause".
- The nod batch addressed to you in `docs/NOW.md:257`: shared-schema cap fields, venue seam,
  mandate-interface generalization, review of `AgentMandate` + trade-gate sims.

### 7. ERC lane — ONLY if started before the Aug 1 tripwire — ~0.5–1 d
`verifier/IMPLEMENTERS.md`: implement `IAgentMandate` → run the verifier `--address 0x… 
--deploy-block N` → pass the conformance fixtures. This reframes the verifier from self-audit into
the standard's conformance tool. Link the ERC's conformance vectors to the real fixture files in
`verifier/`. The Firmata citation and 8226-vs-solo positioning are **Briac's call** — don't
circulate anything.

## Decisions that are NOT yours to make alone

- **Worker v1→v2 switch**: recommend **no** before freeze — v1's audited streak is the story; v2
  with a proof-cycle tx is better evidence than a risky J-5 migration. Raise it with Briac if you
  disagree.
- Yield claims on any public surface: gated on (a) `setVenue` done, (b) proof-cycle txs, and for
  "machine-verified", (c) your workstream #3.
- ERC positioning, license, anything customer-facing.

## Gotchas that will cost you an hour each if unknown

- **RPC**: `https://rpc.drpc.testnet.arc.io` is the only endpoint that serves concurrent reads.
- Repo CI once **silently skipped root-level tests** via a bad glob — when adding test files,
  verify they actually run in CI, not just locally.
- Circle SDK: `description` fields are strictly alphanumeric (punctuation → 400); tx polling
  pattern is `waitCircle` in `agent/scripts/deploy-mandate-v2.ts`.
- `dashboard/next.config.mjs` has an `extensionAlias` (`.js`→`.ts`) so the dashboard imports
  workspace TS; `scenario/package.json` exports `./src/sim.ts` directly.
- On Windows/PowerShell: BOM and here-string pitfalls in scripts — prefer committed `.ts` scripts
  over inline shell.
- Judge-path validation always from an **empty temp dir** (`judge-command.yml` exists for this).

## Definition of done, per item

Ship each workstream as its own PR against `main` with tests. The bar that already exists: 200+
tests green, `npm run test` from root, no `git add -A`. Anything touching the dashboard: verify on
the deployed Railway preview AND at `/?demo=90d` — every deploy-and-look this month found a bug
tests missed.
