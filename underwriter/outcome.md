# Outcome — definition of done for a run

1. `certificate.json` is written to outputs and contains every required field (`certificate_id`, `issued_at`, `verification.mode`, `subject`, `checks[]`, `risk_stats`, `premium` with `formula_version` + `disclosure`, `trend`, `disclaimers`) populated with real fetched/computed values — no placeholders.
2. Every entry in `checks[]` has `status` strictly one of `PASS`, `PENDING`, or `UNVERIFIED` — never `FAILED` or any other value, even when a data source is missing or a call fails.
3. No check treats a missing/null dashboard field or a failed/reverted on-chain call as evidence of a mandate violation — those are marked `UNVERIFIED`/`PENDING` with a plain explanation, never framed as a breach.
4. `premium.formula_version` is `"stub-v0"` and `premium.inputs` shows the actual `max_loss_per_window_usdc` / `hazard` / `surcharge` / `compliant_days` values used to reach `premium_30d_usdc`.
5. `memo.md` exists alongside the certificate as a ~1-page human-readable summary covering the same checks, risk stats, premium, and trend, ending with the preliminary/pending-machine-verification disclaimer.
6. `trend` reflects the underwriting-history memory store (states the comparison to the most recent prior assessment, seeded or real), and the memory store is updated with this run's record before the run ends.
