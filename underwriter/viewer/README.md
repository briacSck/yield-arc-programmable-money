# Results viewer

A self-contained snapshot page: the premium trend across every underwriting run + per-run cards (verdict mode, PASS/PENDING/UNVERIFIED tally, closest-approach-to-floor).

```bash
bash viewer/build-viewer.sh     # pulls certificates via the API, bakes results-viewer.html
```

Then open `viewer/results-viewer.html`. The data is inlined, so it renders **with no network** — safe to present even if the wifi drops. Re-run the script any time to refresh (e.g. after the daily 7 AM run adds a new point).

- Data source: the certificates themselves (one trend point per run) + the seeded baseline. Machine-verified runs render green on the chart; degraded-heuristic runs render in the accent color.
- No API key is ever placed in the page — the script holds the key locally and bakes only the resulting numbers.
