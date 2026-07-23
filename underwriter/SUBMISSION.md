# My Claude Managed Agent — submission (Google Form)

Short, paste-ready answers. Pick one variant per field.

---

**Your name**
Briac Socklaingum

---

**Name of your agent (ideally descriptive)**

> The Underwriter — insurance for an autonomous CFO agent

(You had "The Underwriter CFO Agent" — fine too, but the above avoids sounding like it *is* the CFO agent.)

---

**A few lines describing what your agent does** *(pick one)*

**Short (2 sentences):**
> The Underwriter is an independent Claude agent that insures autonomous financial agents. It assesses YIELD — an autonomous CFO agent trading USDC on-chain under a bounding mandate contract — from public read-only data every day, verifies it stayed inside its floor/ticket/daily-cap limits, and prices an insurance premium. Thesis: a bounded agent is an insurable agent — bounded ⇒ insurable ⇒ scalable.

**Medium (add one line if the field allows):**
> It fetches the CFO's live dashboard, writes its own on-chain script to cross-check the mandate contract, computes risk stats, and issues a signed underwriting certificate + memo — remembering each run so it can report how the premium trended.

---

**Anything cool architecturally? Feature you most liked using?** *(pick one)*

**Short:**
> It's a *separate* agent from the one it judges — arm's-length underwriting. Locked to read-only by a `limited`-networking environment (two allowed hosts, web tools disabled) so it literally can't move money, and it writes its own viem script each run to read the chain. Outcome-graded (passed first try), memory for the premium trend, and a daily scheduled deployment.
>
> Favorite feature: **Outcomes** — handing the agent a rubric and getting an independent pass/fail is exactly right when the deliverable is a risk certificate.

**Ultra-short (one line):**
> Independent read-only agent (limited networking + web tools off = can't move money), writes its own on-chain checks, Outcome-graded, memory-backed premium trend, daily schedule. Favorite: Outcomes as an independent grader.

---

## Live details (if the form asks for links/IDs)
- Agent `agent_01CyAge5BGszCsVv7Q1Xkr62` v1 · `claude-opus-4-8`
- Deployment `depl_01BJhJXeT2EKbqbd53yAaZnX` — daily 07:00 America/Los_Angeles
- First run: `satisfied`, premium $0.0851/30d, degraded-heuristic (machine-verified path wired, awaiting `@yield-cfo/mandate-verify`)
