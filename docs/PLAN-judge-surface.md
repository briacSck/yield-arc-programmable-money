<!-- /autoplan restore point: ~/.gstack/projects/briacSck-yield-arc-programmable-money/main-autoplan-restore-20260728-084642.md -->
> ⚠️ **SUPERSEDED — this plan solved the wrong problem.** It treated the dashboard as a judge
> artifact; the founder's correction (2026-07-28): **the dashboard is the product** — the app a
> non-crypto business owner uses. See `PLAN-product-v2.md` and `THESIS.md`. The /autoplan review
> appended below remains valid as findings (several of its bugs were real and are fixed on `main`).

# PLAN — the judge surface: make YIELD self-explanatory (autoporteur)

_Draft 2026-07-28, for review. Scope: everything a judge or a curious user meets **without us in the
room**. Not a redesign — the visual system is good and stays._

## 0. The problem, stated honestly

Someone lands on the dashboard cold. Today they get a beautiful page that assumes they already know
what YIELD is. Evidence, from the live page this morning (1440×900):

- **Above the fold** they learn *"An autonomous CFO, running unattended on Arc"*, four numbers, and
  a forecast chart. They do **not** learn: what problem this solves, for whom, why "bounded" is the
  point, or what to click next. There is no link to the repo, the video, or the verifier source.
- **The decision log — by far the largest area of the page — is ~95% identical `HOLD` rows.**
  Dozens of *"HOLD: no actionable surplus (0 USDC < min ticket) and no projected floor breach within
  30d"*. The single `DEPLOY 1.53 USDC` that proves the whole thesis is buried mid-scroll, visually
  identical in weight to the noise around it.
- **Scale reads as a toy.** The pool is `8.46 USDC`, floor `5.00`. The 1:3800 demo-scale note is
  ~10px text in the footer, hundreds of pixels from the numbers it explains. A judge who misses it
  concludes we built a €8 treasury manager.
- **The strongest asset is below the fold.** `0 violations — machine-verified` is in the stat row,
  but the thing that makes it credible — the scoreboard, the five invariant chips, and
  `npx -y @yield-cfo/mandate-verify` — is a full screen down, under a chart.
- **The page is a dead end.** No route to the verifier source, the scenario driver, the underwriter
  agent, the contract, or the repo.

Judging is a skim. The page must win in 10 seconds, reward 60, and survive 10 minutes.

## 1. The 60-second path we are designing for

| Time | What they should have | Where it comes from |
|---|---|---|
| 0–10 s | "An AI agent is managing a real company's cash on-chain, unattended, and it provably cannot exceed its mandate." | Hero + one-line thesis + the machine verdict |
| 10–30 s | "Here is it actually doing it — and here is *why* it moved." | One curated move, its reason sentence, its receipt, its explorer link |
| 30–60 s | "And I don't have to trust the screen." | `npx -y @yield-cfo/mandate-verify` inline, plus what it checks |
| 1–10 min | Depth: the mandate, the forecast, the full log, the repo, the ERC, the underwriter | Links that exist today but are invisible |

## 2. Principles

1. **Do not redesign.** Paper/ink/sage, Geist, the stat treatment and the cone all work. This is a
   hierarchy and self-explanation problem, not an aesthetic one.
2. **Every number explains itself where it sits.** No number whose meaning lives in a footnote.
3. **Signal over completeness in the default view.** The full log stays available; it stops being
   the page's centre of gravity.
4. **Never overclaim.** Simulation stays labelled simulation. Demo scale stays labelled demo scale.
   The credibility of the audit is the whole product; a single oversold number costs more than every
   clarity gain here combined.
5. **The page is a hub, not a leaf.** Every artifact we built should be one click away.

## 3. Changes — dashboard

### 3.1 Above the fold: add the "what and for whom" (new)
A single line under the hero, in existing body style: what problem, for whom, what is different.
Draft: *"French SMEs don't die of bad margins — they die of cash timing. YIELD forecasts the wall,
moves treasury ahead of it, and does it under an on-chain mandate the owner can revoke and anyone
can audit."* Plus a compact link row: **repo · verifier · contract · video**.

### 3.2 Promote the verdict, demote the chart
Move the machine-audit scoreboard **above** the forecast cone. The cone is the beautiful thing; the
verdict is the *differentiating* thing, and it currently loses the fold to it.

### 3.3 Fix the decision log's signal-to-noise (the big one)
- **Collapse consecutive identical HOLDs** into one line: *"· 47 quiet cycles — no surplus above the
  floor, no projected breach (Jul 27 06:24 → Jul 28 06:24)"*, expandable.
- **Default the log to moves + state changes**, with a toggle for "every cycle". The current
  "every cycle, including the ones that moved nothing" is honest and should stay reachable — as a
  choice, not as the default wall of text.
- **Give each move a one-line human framing** above the machine reason: *"Pulled funds back before
  payroll"* / *"Swept idle cash into yield"*. The reason sentence stays underneath as the evidence.

### 3.4 Make scale legible at the point of use
Every USDC figure in the mandate panel and the hero gains an inline demo-scale equivalent, e.g.
`8.46 USDC` → `8.46 USDC · ≙ €32,148 at demo scale (1:3800)`, with the ratio explained once, in
place, not only in the footer.

### 3.5 Explain the invariants in one line each
The five chips (`floor · ticket · window · asymmetry · receipts`) are jargon cold. Each needs a
plain-language tooltip/subtitle: *asymmetry → "the agent can always give money back, even after
being fired."*

### 3.6 Coverage honesty
The scoreboard now reads 8 moves; the log shows more decisions than that (HOLDs aren't moves). Say
so explicitly so nobody reads a mismatch as a gap: *"8 money moves audited · HOLDs move no money."*

## 4. Changes — README top fold
The README is strong already. Gaps: no link to the **scenario driver** (the demo you can run), no
link to the **underwriter**, no one-paragraph "what you are looking at" for someone who arrives from
a judging spreadsheet rather than from the deck. Add a 3-tier "verify me" ladder explicitly:
watch the dashboard → run `npx` → build from source.

## 5. Changes — a runnable demo path
`npm start -w scenario -- --speed 1` now replays 90 days with all four beats. Nothing on the
dashboard or README tells a judge it exists. It is the single best "understand this project in 90
seconds without trusting us" artifact we have. Give it a line in both.

## 6. Non-goals
- No new visual language, no new framework, no dark mode.
- No change to `/api/events`' one-route invariant.
- No change to the money path, the mandate, or the verifier's logic.

---

# /autoplan REVIEW — 2026-07-28 · Voices: [subagent-only] (Codex not installed)

## PHASE 1 — CEO REVIEW (mode: SELECTIVE EXPANSION)

### 0A. Premise challenge

| # | Premise the plan rests on | Stated or assumed? | Verdict |
|---|---|---|---|
| P1 | **Judges land on the dashboard cold.** | Assumed | **WEAKEST LINK.** Hackathon judging usually starts with the submission form: title, blurb, video, then *maybe* the repo. The dashboard may be the third thing they see, or never. If P1 is wrong, this plan optimises the wrong surface. |
| P2 | The visual system is good; only hierarchy and self-explanation need work. | Stated (§2.1) | Holds. The page is genuinely well-designed; nothing in the audit suggested otherwise. |
| P3 | The decision log's HOLD noise actively costs comprehension. | Stated with evidence | Holds — it is ~95% of the largest region of the page. |
| P4 | Collapsing HOLDs does not damage the transparency claim. | Assumed | Contested by the plan itself (§7.1). Needs a decision, not an assumption. |
| P5 | Demo-scale equivalents clarify rather than inflate. | Assumed | Genuinely risky. "8.46 USDC ≙ €32,148" can read as dressing up a toy. |
| P6 | There is time for this before the Aug 8 submission. | Unstated | Holds — 11 days, and the work is UI + copy, off the money path. |
| P7 | The npx command printed on the dashboard and README works. | **Unstated and FALSE today.** | The package is not published. Every judge who runs the headline trust command gets a 404. The plan never mentions it. |

**P7 is the finding that matters most.** The plan is about making the project self-explanatory, and
the single most important self-service action a judge can take is currently broken.

### 0B. What already exists (leverage map)

| Sub-problem | Already built |
|---|---|
| Audit scoreboard + 5 invariant chips | `dashboard/app/page.tsx:254` `Scoreboard` |
| Per-move verdict chips | `page.tsx:363` `MoveVerdict` |
| Decision rows w/ reason + receipt + explorer link | `page.tsx:298` `LogRow` |
| Uptime strip | `page.tsx:388` `UptimeStrip` |
| Audit data seam (git ref → proxy → `audit` block) | `dashboard/app/api/events/route.ts` |
| README top fold (npx block, badges, addresses) | `README.md:1-33` |
| Offline verify path | `verifier --fixture live-snapshot` |
| 90-day self-service demo | `scenario/` (shipped yesterday, undocumented publicly) |

Nothing in this plan needs new infrastructure. It is hierarchy, copy, one grouping function, and links.

### 0C. Dream state

```
CURRENT      A beautiful instrument that assumes you already know what it is.
             Headline trust command 404s. Best self-service artifact is invisible.
THIS PLAN    A judge understands the claim in 10s, sees one proof in 60s, and can
             verify it themselves without asking us anything.
12-MONTH     An accountant onboards a client's treasury, sets a mandate, and the
             same audit surface is what they show the client each month.
```

Delta this plan does NOT close: nothing on the page speaks to the *accountant* persona (the real
GTM), and the demo-scale fiction stands between the demo and a real ledger. Both are correctly
out of scope for the hackathon.

### 0C-bis. Implementation alternatives

| # | Approach | Effort (human / CC) | Pros | Cons |
|---|---|---|---|---|
| **A** | Dashboard-first clarity (this plan) | 2 d / ~2 h | Fixes the artifact that survives after the video ends; compounding value for the real product | Optimises a surface judges may reach third |
| **B** | Video + deck first, dashboard as B-roll | 3 d / n/a | Matches how judging actually works | Video is Sara's lane; the dashboard stays confusing for everyone who *does* look |
| **C** | Separate marketing landing page + keep dashboard as pure instrument | 3 d / ~4 h | Clean separation of "explain" and "prove" | New surface to build, deploy and keep honest; splits the story across two URLs |
| **D** | Publish npm + fix the trust command, docs only, no UI work | 0.5 d / ~30 min | Unblocks the highest-value judge action | Leaves the comprehension problem entirely unsolved |

**Selected: A + D.** D is not an alternative to A — it is a prerequisite the plan omitted. A page that
explains itself perfectly and then hands the judge a command that 404s is worse than either fix alone.

### 0E. Temporal interrogation

- **Hour 1:** reorder fold, add thesis line + link row. Cheap, high payoff.
- **Hour 2–3:** log collapse + toggle. The risky one (see Phase 2/3 findings).
- **Hour 4:** scale legibility + invariant plain-language.
- **Hour 6+:** README ladder, scenario visibility, /how-it-works decision.
- **Unblocked in parallel, not by us:** npm publish (CTO). If it does not land, the plan MUST ship a
  working fallback command rather than a broken one.

### 0F. Mode: **SELECTIVE EXPANSION** — hold the plan's scope, add the P7 prerequisite.

## PHASE 2 — DESIGN REVIEW [subagent-only]

**Scorecard:** hierarchy 6 · states 2 · specificity 3 · honesty 5 · visual consistency 7 ·
accessibility 1 · camera-readiness 6. Verdict: *"a strong diagnosis document and a weak
specification."* Accepted — §0 is evidence-based, §3 is intentions with sample copy.

### Critical findings (auto-adopted)

| # | Finding | Decision | Principle |
|---|---|---|---|
| D-H3 | **The plan's own 10–30 s beat has no UI.** §1 promises "one curated move, its reason, its receipt, its explorer link" and §3 never builds it. | **ADOPT §3.2b — the proof card.** One move rendered directly under the scoreboard, above the cone: human framing, machine reason, PASS chip, amount, tx link. It is the thing a judge screenshots, and the only element where the audit and the money path visibly touch. | P1 |
| D-S1 | **Audit-absent becomes a fold collapse.** `route.ts` returns `audit: null` on any failure and `page.tsx:131` renders the scoreboard conditionally. That rule was safe *only because the block was below the fold*. Promote it and a dead feed deletes the hero. | **ADOPT — the slot always holds.** Same box, degraded content: last-known verdict + date, "live audit feed unreachable — retrying", and the `npx` line, which depends on no feed at all. Cache last-good verdict server-side. | P1 |
| D-L1 | **The human framing has no stated provenance.** A caption keyed on `decision.kind` would print "Pulled funds back before payroll" on *every* WITHDRAW, including ones that happened for other reasons — a hardcoded human sentence stacked above a machine-derived one, next to PASS chips. | **ADOPT — derive or print nothing.** Extend the existing `decision.exposure` pattern (`page.tsx:331`); no parallel copy table. No derivable trigger ⇒ no caption. Typographically marked as ours (ink, sentence case, never mono). | P4, P5 |
| D-C1 | **"47 quiet cycles" would be a false number.** `page.tsx:145` renders `.slice(0, 60)` of a `limit=200` fetch. The moment a count is printed, a rendering truncation becomes a quantitative claim about history. | **ADOPT — no count we cannot back.** Either compute server-side over true history, or phrase with no numeric claim. This is exactly what principle §2.4 exists to prevent. | P1 |

### Also adopted (mechanical)

- **D-H1 fold budget as an acceptance test**, not a hope: at 1440×900 *and* 1280×800 the five chips
  and the `npx` line must be visible without scrolling. If they aren't, the thesis line gets cut —
  never the scoreboard.
- **D-H2 kill the duplicate fact.** The 4th hero stat already *is* the audit verdict, with an
  `#audit` anchor that exists only because the scoreboard was a screen away. Once it's above the
  fold, the scoreboard owns the fact; three stats beat four with a repeat.
- **D-A1 subtitles, not tooltips.** `title=` doesn't screenshot, doesn't exist on touch, and is
  unreliable for screen readers. Accessibility scored 1/10 — the plan never mentioned it.
- **New principle §2.6: every explanation must survive a screenshot.** Resolves the tooltip, the
  stale-audit and the demo-scale questions in one stroke.
- **D-S2 add a state matrix (§3.7)**: loading · empty-moves-only · error · partial-audit ·
  stale-audit · revoked · audit-absent. The plan specified zero and *creates three*. Notably:
  a moves-only default with zero moves renders an empty log on any fresh deploy — 0 moves must
  auto-fall back to the full log.
- **D-S3 stale audit changes the headline, not the eyebrow** once it's above the fold. This repo
  just survived an 8-day silent outage; a stale banner as the first screenshotted object is a live
  judging risk.
- **D-X1 group identity under the 30 s poll**: key groups by the `seq` of the first member, not by
  array index, or open groups jump and close on camera every 30 seconds.

### Surfaced as TASTE decisions (see final gate)
- **T1 — how to collapse the log.** The reviewer argues the wall of HOLDs is not only noise: its
  *bulk is the message*, and replacing it with a sentence converts shown evidence into asserted
  evidence on a page whose pitch is "take nothing on faith." Proposes promoting the existing
  `UptimeStrip` to be the log's header (one tick per cycle, full width, nothing hidden) instead of a
  text collapse.
- **T2 — how to express demo scale.** Reviewer rates the drafted `≙ €32,148` as *inflating*: fake
  precision, repetition turning a note into a claim, and an unreadable glyph. Alternatives: say it
  once structurally, or a unit toggle. Hard exclusion adopted either way: **never convert inside the
  scoreboard** — the machine verdict stays in the units the verifier checked.

## PHASE 3 — ENG REVIEW [subagent-only]

**Ratings:** architecture 7/10 (5 as written — placement unstated) · **test coverage 1/10** ·
performance risk 3/10 · error paths 6/10 · deployment risk 2/10.

### Live bugs found while reviewing (all client-only, none touches a schema or the money path)

| # | Bug | Evidence |
|---|---|---|
| E-B1 | **The hero contradicts the chain.** `stats.onChainMoves` = 5 (worker counter, lost across the Jul 23 redeploy) vs `audit.totalMoves` = 8 (verifier, reads the chain). **Verified live today.** On a page whose thesis is "don't trust the screen." | live `/api/events` |
| E-B2 | **`revokedAt` fabricates a timestamp.** `page.tsx:40-45` scans only the 200-record window and falls back to `new Date()`. Once a revocation scrolls out of the window, the banner says the mandate was revoked "just now" — forever — and the cone draws the marker at today. | `page.tsx:40` |
| E-B3 | **`pastCoverage` cannot compute coverage.** `auditThroughBlock` is a block number used only for truthiness; `ExecutionResult` carries no block number, so "newer than the scan" and "scanned but unverdicted" are indistinguishable. Both render PENDING; one should be UNVERIFIED. §3.6 invites judges to do exactly this arithmetic. | `page.tsx:319` |
| E-B4 | **A revoke-blocked deposit renders shame-red.** `kind--failed` → `--neg`, but PLAN §18.2 pins that this case must read **"BLOCKED — mandate enforced" in sage** — it is the mandate *working*, and it is the demo's punchline. | `globals.css:207` |
| E-B5 | **The dashboard has no `test` script**, so the root `npm test --workspaces --if-present` skips it entirely. Same class of silent-skip as the CI glob bug fixed yesterday. | `dashboard/package.json` |

### Critical plan defects

- **E-D1 (CRITICAL, converges with D-C1):** the oldest collapsed group would state a count *and a
  start timestamp* that are artifacts of `limit=200`. Fix: leading group renders open-ended, **no
  start timestamp**, count derived from `stats` (unwindowed ground truth) — *"153 earlier quiet
  cycles — window truncated."* **Never raise `limit` to paper over it** (see perf).
- **E-D2 (CRITICAL):** with a moves-only default, an all-HOLD window renders an **empty log** — the
  page's largest section goes blank exactly when the agent has been most disciplined. Fix:
  **collapsing *is* the filter**; the summary line is the honest floor, never a mode that can empty.
- **E-D3 (HIGH):** the 30 s poll swaps the whole tree; groups keyed by index will jump and re-key
  under the reader on camera. Anchor expansion state to the **`seq` of the group's oldest record**.
- **E-D4/D5:** group on the semantic predicate, not string equality (HOLD reasons embed live
  numbers, so equality shatters runs), and on array adjacency, not `seq` adjacency (`EventLog`
  silently skips torn lines).

### Placement (the plan never stated it — this is how grouping ends up in the proxy)
Grouping → new pure `dashboard/lib/log-groups.ts`. Scale helper → `dashboard/lib/format.ts` (already
declares itself the display edge). Filter → client `useState`/`useMemo` over records already in
memory, **not** a re-fetching query param. Nothing goes in `route.ts`; nothing goes in the worker.
**Open question §7.4 (`/how-it-works`) → REJECTED** on the project's own precedent (PLAN §18.2:
*"the page has no nav; nobody types /audit"*).

### Performance — one rule
Payload is the only real exposure: ~450 B/HOLD × `limit=1000` ≈ **500 KB every 30 s per open tab**,
`cache: no-store`, on conference wifi. **The window-boundary problem is solved with `stats`, never
by raising `limit`.** (If it ever bites: drop `identitySig` — ~30% of the bytes, 0% of the pixels.)

### Test plan (artifact)
Add a `test` script to `dashboard/package.json` first, or none of it runs. Keep all new logic pure so
`node --test` suffices — **do not add jsdom/RTL the week of a demo.** 15 cases specified in
`~/.gstack/projects/…/main-test-plan-20260728.md`; the four that matter if time collapses are the
ones that put a *wrong claim on screen*: group/row/group ordering, FAILED breaks a group, the
truncated boundary group carries no start timestamp, and all-HOLD never yields an empty log.
**Free fixture generator nobody connected:** `npm start -w scenario` writes an `event-log.jsonl` —
point the dashboard at it and every edge case above is eyeballable in 90 seconds.

## PHASE 3.5 — DX REVIEW [subagent-only]

**Scores:** getting started **2/10** · naming 7 · error messages 5 · docs findability 5 ·
version safety 4 · environment friction 4.
**TTHW: ∞ on the advertised path.** Target: 30 s zero-install, ≤3 min from a clone.

### The finding that explains everything
**Every test of the judge path was a false positive.** Run `npx -y @yield-cfo/mandate-verify`
*inside* the repo and it works — npx resolves the name against the workspace symlink in local
`node_modules` first. Run it from a temp dir: `E404`. That is why an unpublished package has been
printed on the front page, in the dashboard (`page.tsx:280`) and four times in the verifier README
for five days without anyone noticing. **Never validate that path from inside the repo again** — the
fix is a CI job that runs it from an empty temp dir, so a 404 fails the build.

### Fixed during this review (PR #9, merged)
`--fixture live-snapshot` crashed with a raw ENOENT stack **from the built artifact**: yesterday's
snapshot refresh renamed the fixture, `dist/` was a Jul 23 bundle, and `prepublishOnly` does not run
on `npm pack` — so any tarball release would have shipped a broken offline path. Now `prepack`, plus
a guard test that every whitelisted fixture loads. Verified: live-snapshot exits 0, naive-agent
exits 1 with 13 violations.

### Open DX defects (not yet fixed)
| # | Defect | Severity |
|---|---|---|
| X1 | **Unclaimed npm scope is a supply-chain hole.** The public README instructs strangers to `npx -y` a name **anyone can publish**. For an *audit tool*, that is a uniquely bad failure. Claim it today, placeholder counts. | CRITICAL |
| X2 | RPC failure exits **127 with a libuv assertion**, not the documented 2 — and it is specific to HTTP-error-with-retries, i.e. **exactly the 429 rate-limit case**. Breaks the exit-code contract the nightly CI relies on to tell "infra flake" from "violation". | HIGH |
| X3 | The excellent error doctrine (*"infrastructure, not a violation"*) prints **after** viem dumps status, URL, request body and the target's entire HTML. The judge sees a wall of red and closes the terminal. | HIGH |
| X4 | Claim drift: README says the live verify takes **~3 s**; measured **6.2 s**. On a product whose currency is not overclaiming, a 2× optimistic number on the front page is the wrong kind of small. | MEDIUM |
| X5 | Version is hardcoded in `cli.ts` separate from `package.json`, and appears in **no** human output — the verdict a judge screenshots carries no version at all. `npx -y <name>` is unpinned. | MEDIUM |
| X6 | "Getting started" is a **contributor** path (416 MB `node_modules`, 19.6 s typecheck) to run a 4-second simulation. Split "verify it yourself (no install)" from "develop". | MEDIUM |

### Adopted: the ladder is four rungs, offline BEFORE live
| Rung | Command | Cost | If it fails |
|---|---|---|---|
| 0 Watch | dashboard URL | 0 s | — |
| 1 Offline proof | `--fixture naive-agent` / `--fixture live-snapshot` | ~1 s, no network | nothing to fail |
| 2 Live history | no args | ~6 s, needs Arc RPC | falls back to rung 1 |
| 3 Read + test | clone → `src/core/replay.ts` → `npm test -w verifier` | 2.3 s | — |
Rung 1 goes first because it is faster, firewall-proof, and the one that survives a testnet wobble
on stage.

---

## CROSS-PHASE THEMES (independent convergence — highest-confidence signals)

1. **The human caption is a lie surface — flagged by ALL THREE voices independently** (design L1,
   CEO F9, eng H1). A hand-written *"Pulled funds back before payroll"* above a machine-derived
   reason, beside PASS chips, on the one page whose credibility is that it is an instrument.
   **Auto-adopted: derive from the decision record alone, or print nothing.**
2. **A printed quiet-cycle count would be fabricated** (design C1, eng D1) — truncated-window
   artifact presented as history. **Auto-adopted: `stats`-derived or no number at all.**
3. **The euro annotation is a credibility risk, not a clarity win** (design §5, CEO F5, eng H2).
   Three voices, unprompted. It also folds a currency conversion (USDC→EUR at exactly 1.00) into
   what is sold as a *scale* conversion. **→ taste decision T2, with a strong lean to dropping it.**
4. **The one command the project dares judges to run is a 404** (CEO F1, DX F1/F2), and DX found
   *why* it went unnoticed for five days. **→ decision T3.**
5. **Audit-null above the fold deletes the hero** (design S1, eng). **Auto-adopted: slot always holds.**
6. **The scenario driver is drastically undersold** (CEO F3, DX F7) — 4.2 s, no keys, no chain,
   deterministic, shows the revocation beat the live chain doesn't have.

## 7. Open questions for review
1. Is collapsing HOLDs by default *honest*, given "every cycle, including the ones that moved
   nothing" is currently a deliberate transparency claim? (My read: yes, if the toggle is visible
   and the count is shown — hiding nothing, ranking better.)
2. Demo-scale equivalents everywhere: does `≙ €32,148` read as clarifying or as inflating? Is there
   a framing that is unambiguously honest?
3. Does the hero line risk sounding like a pitch deck on a page whose credibility comes from being
   an instrument, not a pitch?
4. How much of this belongs on the dashboard vs a separate `/how-it-works` page that the video and
   deck can also point at?
