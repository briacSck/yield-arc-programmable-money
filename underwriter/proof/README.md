# v1 — Machine-verified flip proof

The agent's machine-verification upgrade is **already wired** in its system prompt: every run first tries `npx -y @yield-cfo/mandate-verify --json` and silently falls back to degraded-heuristic mode when the package 404s (its state today). Nothing needs to be built for the flip to happen — the day that package publishes to npm, the very next scheduled run flips `verification.mode` to `machine-verified` with **zero code change**.

This folder proves that flip **offline**, so you can show the before/after on stage without waiting for the package:

```bash
bash proof/simulate-verifier.sh            # uses ../certificate.json + verifier-stub.json
```

It reads today's real certificate + a simulated verifier success payload (`verifier-stub.json`) and writes `certificate.machine-verified.json`, printing the `verification` block before/after and every check the verifier upgraded to `PASS`. Purely local — no API calls, the live agent is never touched.

**Want to prove it through the real agent instead?** Kick off a fresh on-demand session whose `user.message` supplies the verifier output as authoritative ("the verifier is now published; its output for this run is: …"). The agent will produce a `machine-verified` certificate through its actual reasoning path. That variant hits the API; the script above is the offline, deterministic version.
