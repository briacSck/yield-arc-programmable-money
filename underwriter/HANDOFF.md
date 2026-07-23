# HANDOFF — continue The Underwriter from here

> Context-save for resuming the underwriter work inside this repo. Written 2026-07-22.
> Read this + `README.md` + `NEXT-DIRECTIONS.md`, then you're oriented. Strategy-free (public repo).

## Where things stand

- **Branch:** `feat/underwriter-cma` · **Draft PR:** [#1](https://github.com/briacSck/yield-arc-programmable-money/pull/1) into `main` (not merged — nothing auto-merges).
- **The underwriter is LIVE** in Anthropic's Claude Managed Agents (CMA), in Briac's **General** workspace. It ran, graded `satisfied`, and is on a **daily schedule**.
- This folder (`underwriter/`) is the complete build kit + the first real run's outputs. It is **not** an npm workspace (not in root `package.json`) — a plain artifact folder; `npm install` at the repo root ignores it.

## Live objects (in `IDS.env`, committed — handles only, useless without the API key)

| Primitive | ID | Notes |
|---|---|---|
| 🤖 Agent | `agent_01CyAge5BGszCsVv7Q1Xkr62` (v1) | model `claude-opus-4-8`; base toolset, `web_fetch`/`web_search` disabled |
| 📦 Environment | `env_01CmB3dEvqSiqDoN9uVr47JF` | cloud, `networking: limited` (2 hosts), `npm: viem` |
| 🧠 Memory store | `memstore_01Wz8h7HcwWcUaqqPK2RYxgn` | `underwriting-history` — premium trend across runs |
| 🗓️ Deployment | `depl_01BJhJXeT2EKbqbd53yAaZnX` | daily `0 7 * * *` America/Los_Angeles |
| ▶️ First run | `sesn_011VLTmTzjj1fNKRMRCEchsT` | graded satisfied, premium 0.0851 USDC/30d |

Console: `https://platform.claude.com/workspaces/default/agents/agent_01CyAge5BGszCsVv7Q1Xkr62` (switch to the key's workspace with the picker if `default` doesn't resolve).

## To operate it again (from this folder)

The API key is **not** in the repo (gitignored). Recreate `underwriter/.env` first:

```bash
cd underwriter
printf 'ANTHROPIC_API_KEY=<your key>\n' > .env    # never commit this
set -a; source .env; source IDS.env; set +a        # IDS.env already has the live IDs
```

Then:
- **Full re-launch / re-create from scratch:** follow `LAUNCH.md` (resumable — skips objects already in `IDS.env`).
- **Fire the daily deployment now (manual test run):** `curl -sS -X POST --ssl-no-revoke "$BASE/deployments/$DEPLOYMENT_ID/run?beta=true" "${H[@]}" -d '{}'` (see `LAUNCH.md` §8 for `$BASE`/`$H`).
- **Refresh the results viewer** (picks up any new scheduled-run certificates): `bash viewer/build-viewer.sh` → open `viewer/results-viewer.html`.
- **v1 flip proof (offline):** `bash proof/simulate-verifier.sh`.
- **v2 bind flow (on-demand, gated):** `bash bind/bind.sh` → then `bash bind/bind-approve.sh` or `bind/bind-deny.sh`.
- **Evals:** `bash evals/run-evals.sh <agent-version>` (case-01 baseline is `evals/case-01/expected.*`).

> The daily deployment fires at 07:00 PT and appends a certificate + a memory-trend line each run. Re-running `viewer/build-viewer.sh` any day pulls the newer runs in.

## Windows gotchas already solved this session (don't rediscover them)

- **curl:** always pass `--ssl-no-revoke` (schannel revocation check fails otherwise). **Never** `2>/dev/null` a curl on this machine — it flips the exit code even on HTTP 200.
- **Python:** set `export PYTHONIOENCODING=utf-8` (emoji/console); Windows `print` emits `\r\n`, so **strip `\r`** from any captured line (`SID="${SID%$'\r'}"`), and read API JSON with `open(path, encoding='utf-8')`.
- **Parse API responses with `python3` + `json.JSONDecoder(strict=False)`, not `jq`** — the embedded system prompt has control chars that break jq.
- **Temp files:** Git Bash `/tmp` ≠ Windows Python `/tmp`; use relative paths so both tools agree.

## Done vs. next

**Shipped:** the assessor agent (daily, graded), memory trend, v1 machine-verify flip proof, v2 human-gated bind, results viewer, submission copy (`SUBMISSION.md`), pitch page (`pitch.html`).

**Next (full detail in `NEXT-DIRECTIONS.md`):**
1. **Machine-verified mode** flips automatically the day `@yield-cfo/mandate-verify` publishes (already wired — nothing to build; the `verifier/` package is the W2 lane).
2. **v3 — ERC-8004 registry cross-check** (needs the registry ABI to become a real check).
3. **Real bind connector** — replace the demo custom tool with an MCP connector gated `always_ask`, once a binding counterparty/ledger exists. Keep it off the daily schedule (or pin the deployment's agent version) — an approval gate hangs an unattended run.
4. **Real actuarial premium pricing** — the stub-v0 formula is disclosed by design; `TODOS.md` tracks this.
5. **The trend becomes real** as the daily deployment accumulates runs — the viewer's premium line fills in over days.

## Important notes

- **`docs/PLAN.md` advance edits are LOCAL ONLY.** `docs/PLAN.md` is gitignored (it's the strategy source-of-truth). The §18/§6/§8 "SHIPPED 2026-07-22" annotations exist only in *this* working copy — they are **not** in the branch and a fresh clone won't have them. The pushed advance record is `docs/NOW.md` + `README.md` + `AGENTS.md` + `TODOS.md`.
- **Rotate the Anthropic API key.** It surfaced into the build session's context and this repo is public. It was never committed, but rotate it (platform.claude.com → API keys) as hygiene.
- **Untouchable boundary (AGENTS.md invariants):** the underwriter only *reads* public surfaces (`/events`, the `AgentMandate` getters). Do not modify the money-moving path (`agent/src/scheduler.ts`, `agent/src/decision/engine.ts`, `agent/src/chain/circle-chain-executor.ts`, `contracts/contracts/AgentMandate.sol`).
- This file can be deleted before the PR merges if you'd rather it not land on `main`.
