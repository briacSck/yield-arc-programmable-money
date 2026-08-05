# Demo video — shot list (Aug 8 submission)

Owner: Sara (film + edit). Everything below is pre-verified: every URL loads, every command
runs, every claim is one the repo can back. Target length **2:30** — judges skim; the last
30 seconds are the ERC close, cuttable to land at 2:00 without losing the proof spine.

**House rule carried over from the judge-surface review: never film the verifier from inside
the repo.** Open a fresh terminal in an empty directory (`mkdir demo && cd demo`) so the npx
run on camera is the same run a judge gets.

## Pre-flight (5 min, before recording anything)

1. `https://dashboard-production-abea.up.railway.app` loads and shows the live mandate.
2. `https://dashboard-production-abea.up.railway.app/?demo=90d` plays the simulated quarter.
3. In an **empty** directory, both commands below run clean (first run pays a ~10 s npx
   install; run each once before filming so the on-camera take is fast):

   ```bash
   npx -y https://github.com/briacSck/yield-arc-programmable-money/releases/download/v0.1.0/yield-cfo-mandate-verify-0.1.0.tgz
   npx -y https://github.com/briacSck/yield-arc-programmable-money/releases/download/v0.1.0/yield-cfo-mandate-verify-0.1.0.tgz --fixture naive-agent
   ```

4. Terminal: dark theme, font ≥ 16 pt, window sized so the verifier's verdict block fits
   without scrolling. Browser: hide bookmarks bar, 100 % zoom.

## Shots

| # | Time | Screen | Action | Voiceover (draft) |
|---|------|--------|--------|-------------------|
| 1 | 0:00–0:15 | Live dashboard, top fold | Slow scroll: balance, mandate chip, latest moves | "This is a real autonomous treasury agent, live on Arc testnet. Real USDC, real yield venue, no human in the loop. It has been running for weeks — every move you see settled on-chain." |
| 2 | 0:15–0:35 | Same page, mandate panel + ArcScan tab of the mandate contract | Hover floor / ticket / 24h-window figures, flash the contract page | "Before it moved a cent, the company signed an on-chain mandate: a cash floor it can never break, a per-move ticket cap, a 24-hour budget. Not policy in a PDF — `require` statements in the contract." |
| 3 | 0:35–1:05 | `?demo=90d` | Let the simulated quarter play; pause on a DEPLOY move, open its drill-down | "Here's a full quarter compressed to ninety seconds, on a synthetic ledger. Payroll spikes, slow months — the agent deploys when it's safe and pulls back when it isn't. Watch the floor line: it never crosses." |
| 4 | 1:05–1:20 | Drill-down still open | Point at the printed verify command in the drill-down | "Every move carries a receipt, and the dashboard tells you how to check its record on a machine that has never seen this repo." |
| 5 | 1:20–1:50 | Fresh terminal, empty dir | Run the tarball command; let the COMPLIANT verdict land | "One command. It replays the agent's entire on-chain history and re-checks every move against all five mandate invariants. Eight moves, five invariants, zero violations — against the chain, not against us." |
| 6 | 1:50–2:10 | Same terminal | Run `--fixture naive-agent`; the 13-violation red verdict, exit 1 | "And it's not a rubber stamp. Point the same auditor at an unbounded agent and it fails loudly — thirteen violations, exit code one. That's what makes the green run mean something." |
| 7 | 2:10–2:30 | README top fold, then the mandate ArcScan page | Slow scroll over the rungs-of-trust table | "Bounded means auditable. Auditable means insurable. That's the standard we're proposing — and everything you just watched is public, live, and re-runnable today." |

## Fallbacks

- **RPC flaky during shot 5** (exit 2): film `--fixture live-snapshot` instead — same verdict
  over YIELD's committed real history, works offline. Say "against a signed snapshot of its
  real history" instead of "against the chain".
- **Demo playbar stutters on the recording machine**: record at 1× and speed the clip in the
  edit; the chart animates the same.
- **Terminal take goes long**: the npx install line can be cut in the edit — keep the verdict
  block uncut, it is the money shot.

## Assets to capture extra (b-roll, 30 s each)

- ArcScan tx page of the setVenue call and one DEPLOY move.
- Dashboard scoreboard band (the nightly audit strip).
- `verifier/src/core/replay.ts` scrolled slowly in an editor (for the "read it" beat if the
  edit wants it).
