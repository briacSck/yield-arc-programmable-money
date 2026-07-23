#!/usr/bin/env bash
# Results viewer builder — pulls every run's certificate via the API and bakes a
# self-contained, offline-capable HTML page (premium-trend chart + per-run cards).
# No key ever reaches the browser; re-run to refresh.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
set -a; source IDS.env 2>/dev/null; set +a
export PYTHONIOENCODING=utf-8
BASE=https://api.anthropic.com/v1
CURL="curl -sS --ssl-no-revoke"
H=(-H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" -H "anthropic-beta: managed-agents-2026-04-01" -H "content-type: application/json")

mkdir -p viewer/_certs

# 1. List all sessions for the agent.
$CURL "$BASE/sessions?agent_id=$AGENT_ID" "${H[@]}" -o viewer/_sessions.json -w 'sessions http=%{http_code}\n'

# 2. For each idle session, find + download certificate.json (re-list at read time; file_ids re-finalize).
#    Use mapfile+for (not while-read<file) to avoid curl consuming the loop's stdin. Do NOT 2>/dev/null
#    the curls — on Windows schannel that flips curl's exit code even on HTTP 200.
mapfile -t IDLE < <(python3 -c "
import json
d=json.JSONDecoder(strict=False).decode(open('viewer/_sessions.json',encoding='utf-8').read())
for s in d.get('data',[]):
    if s.get('status')=='idle': print(s['id'])
")

for SID in "${IDLE[@]}"; do
  SID="${SID%$'\r'}"   # strip trailing CR — Windows python print emits \r\n
  [ -z "$SID" ] && continue
  $CURL "$BASE/files?scope_id=$SID" "${H[@]}" -o viewer/_files.json -w '' || continue
  FID=$(python3 -c "
import json
try:
    d=json.JSONDecoder(strict=False).decode(open('viewer/_files.json',encoding='utf-8').read())
    for f in d.get('data',[]):
        if f.get('filename')=='certificate.json': print(f['id']); break
except Exception: pass
")
  [ -z "$FID" ] && continue
  $CURL "$BASE/files/$FID/content" "${H[@]}" -o "viewer/_certs/$SID.json" -w '' || true
  echo "  certificate from session $SID"
done

# 3. Assemble data.json (seeded baseline + one point per real certificate) and bake the HTML.
python3 <<'PY'
import json, glob, os

points = []

# seeded baseline
try:
    seed = json.load(open('memory_seed/seed-assessment.json', encoding='utf-8'))
    points.append({
        "label": "baseline (seed)", "session": None, "issued_at": seed.get("issued_at"),
        "premium": seed["premium"]["premium_30d_usdc"], "mode": "seed",
        "pass": None, "pending": None, "unverified": None,
        "closest_floor": None, "seeded": True,
    })
except Exception as e:
    pass

# real certificates
for path in glob.glob('viewer/_certs/*.json'):
    try:
        c = json.load(open(path, encoding='utf-8'))
    except Exception:
        continue
    if 'premium' not in c or 'certificate_id' not in c:
        continue
    from collections import Counter
    tally = Counter(chk.get('status') for chk in c.get('checks', []))
    rs = c.get('risk_stats', {})
    points.append({
        "label": c.get("certificate_id"),
        "session": os.path.splitext(os.path.basename(path))[0],
        "issued_at": c.get("issued_at"),
        "premium": c.get("premium", {}).get("premium_30d_usdc"),
        "mode": c.get("verification", {}).get("mode"),
        "pass": tally.get("PASS", 0), "pending": tally.get("PENDING", 0), "unverified": tally.get("UNVERIFIED", 0),
        "closest_floor": rs.get("closest_approach_to_floor_usdc"),
        "daily_cap_util": rs.get("daily_cap_utilization_pct"),
        "revoked": rs.get("revoked"),
        "seeded": False,
    })

# de-dupe real points by certificate_id, keep order by issued_at
seen=set(); uniq=[]
for p in points:
    k=(p["label"], p["issued_at"])
    if k in seen: continue
    seen.add(k); uniq.append(p)
uniq.sort(key=lambda p: (p.get("issued_at") or ""))
points = uniq

json.dump(points, open('viewer/data.json','w',encoding='utf-8'), indent=2)

# ---- build the SVG premium-trend chart (no external libs) ----
# Exclude the synthetic seed from the chart/scale — its $49 would crush the real ~$0.08 premiums.
real = [p for p in points if p["premium"] is not None and not p.get("seeded")]
W, Hh, PADL, PADR, PADT, PADB = 720, 260, 56, 24, 24, 44
def scale(vals, lo, hi, a, b):
    if hi==lo: return [ (a+b)/2 for _ in vals ]
    return [ a + (b-a)*(v-lo)/(hi-lo) for v in vals ]
svg = ""
if real:
    prems = [p["premium"] for p in real]
    pmin, pmax = min(prems), max(prems)
    # pad the range a touch
    span = (pmax-pmin) or (pmax or 1)
    lo, hi = max(0, pmin - 0.15*span), pmax + 0.15*span
    n = len(real)
    xs = [ PADL + (W-PADL-PADR)*(i/(max(1,n-1))) for i in range(n) ]
    ys = scale(prems, lo, hi, Hh-PADB, PADT)
    # gridlines + y labels (3)
    grid=""
    for g in range(3):
        yv = lo + (hi-lo)*g/2
        yy = scale([yv], lo, hi, Hh-PADB, PADT)[0]
        grid += f'<line x1="{PADL}" y1="{yy:.1f}" x2="{W-PADR}" y2="{yy:.1f}" class="grid"/>'
        grid += f'<text x="{PADL-8}" y="{yy+4:.1f}" class="ylab" text-anchor="end">{yv:.4f}</text>'
    poly = " ".join(f"{x:.1f},{y:.1f}" for x,y in zip(xs,ys))
    dots=""
    for i,(x,y,p) in enumerate(zip(xs,ys,real)):
        cls = "dot mv" if p["mode"]=="machine-verified" else "dot"
        dots += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" class="{cls}"><title>{p["label"]}: {p["premium"]:.4f} USDC ({p["mode"]})</title></circle>'
        lab = (p["issued_at"] or "")[:10]
        dots += f'<text x="{x:.1f}" y="{Hh-PADB+18:.1f}" class="xlab" text-anchor="middle">{lab}</text>'
    svg = f'<svg viewBox="0 0 {W} {Hh}" class="chart" role="img" aria-label="Premium trend">{grid}<polyline points="{poly}" class="line"/>{dots}</svg>'
else:
    svg = '<p class="muted">No priced runs yet.</p>'

# ---- cards ----
def card(p):
    if p.get("seeded"):
        return f'''<div class="card seed"><div class="chd"><b>Baseline</b><span class="pill seedpill">seed</span></div>
        <div class="prem">{p["premium"]:.4f} <span class="u">USDC/30d</span></div>
        <div class="meta">synthetic starting point — not a real assessment</div></div>'''
    mode = p["mode"] or "?"
    modecls = "good" if mode=="machine-verified" else "warn"
    rev = p.get("revoked")
    return f'''<div class="card"><div class="chd"><b>{p["label"]}</b><span class="pill {modecls}">{mode}</span></div>
      <div class="prem">{p["premium"]:.4f} <span class="u">USDC/30d</span></div>
      <div class="tally"><span class="t pass">{p["pass"]} PASS</span><span class="t pend">{p["pending"]} PENDING</span><span class="t unv">{p["unverified"]} UNVERIFIED</span></div>
      <div class="meta">{(p["issued_at"] or "")[:19].replace("T"," ")} · closest-to-floor {p.get("closest_floor")} USDC · cap util {p.get("daily_cap_util")}% · {"REVOKED" if rev else "not revoked"}</div></div>'''

cards = "".join(card(p) for p in reversed(points))
latest = real[-1] if real else None
hero = f'{latest["premium"]:.4f} USDC' if latest else "—"
heromode = latest["mode"] if latest else ""
nruns = len(real)

html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>The Underwriter — results</title>
<style>
:root{{--bg:#fbf7f0;--card:#fffdf8;--ink:#2b2620;--mut:#8a8072;--line:#e7ddcc;--accent:#c2410c;--good:#15803d;--warn:#b45309}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif}}
.wrap{{max-width:860px;margin:0 auto;padding:32px 20px 56px}}
h1{{font-size:24px;margin:0 0 2px}}.sub{{color:var(--mut);margin:0 0 24px}}
.hero{{display:flex;gap:24px;flex-wrap:wrap;align-items:baseline;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;margin-bottom:22px}}
.hero .big{{font-size:34px;font-weight:700;color:var(--accent)}}.hero .k{{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.04em}}
.panel{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:22px}}
.chart{{width:100%;height:auto}}
.line{{fill:none;stroke:var(--accent);stroke-width:2.5}}
.dot{{fill:var(--accent)}}.dot.mv{{fill:var(--good)}}
.grid{{stroke:var(--line);stroke-width:1}}.ylab,.xlab{{fill:var(--mut);font-size:11px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 15px}}
.card.seed{{opacity:.72;border-style:dashed}}
.chd{{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}}
.prem{{font-size:22px;font-weight:700;margin:6px 0 4px}}.prem .u{{font-size:12px;font-weight:400;color:var(--mut)}}
.pill{{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line)}}
.pill.good{{background:#e7f6ec;color:var(--good);border-color:#bfe3cb}}.pill.warn{{background:#fdf3e4;color:var(--warn);border-color:#f0dcbd}}
.seedpill{{background:#efe9dd;color:var(--mut)}}
.tally{{display:flex;gap:6px;margin:4px 0 6px;flex-wrap:wrap}}.t{{font-size:11px;padding:1px 7px;border-radius:6px}}
.t.pass{{background:#e7f6ec;color:var(--good)}}.t.pend{{background:#fdf3e4;color:var(--warn)}}.t.unv{{background:#f3ede2;color:var(--mut)}}
.meta{{font-size:11.5px;color:var(--mut)}}
.muted{{color:var(--mut)}}footer{{color:var(--mut);font-size:12px;margin-top:20px}}
.leg{{display:flex;gap:16px;font-size:12px;color:var(--mut);margin-top:8px}}.sw{{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:middle}}
</style></head><body><div class="wrap">
<h1>The Underwriter — underwriting results</h1>
<p class="sub">YIELD CFO agent · premium trend across assessments · self-contained snapshot (no live key)</p>
<div class="hero"><div><div class="k">Latest 30-day premium</div><div class="big">{hero}</div><div class="meta">{heromode}</div></div>
<div><div class="k">Priced runs</div><div class="big">{nruns}</div></div>
<div><div class="k">Thesis</div><div style="font-weight:600">bounded ⇒ insurable ⇒ scalable</div></div></div>
<div class="panel"><div class="k" style="color:var(--mut);font-size:13px;margin-bottom:6px">Premium (USDC / 30 days)</div>
{svg}
<div class="leg"><span><span class="sw" style="background:var(--accent)"></span>degraded-heuristic</span><span><span class="sw" style="background:var(--good)"></span>machine-verified</span></div></div>
<div class="cards">{cards}</div>
<footer>Generated by viewer/build-viewer.sh from live certificates via the Files/Sessions API · re-run to refresh · data baked in, opens offline.</footer>
</div></body></html>'''

open('viewer/results-viewer.html','w',encoding='utf-8').write(html)
print("wrote viewer/results-viewer.html  (%d priced run(s) + %s)" % (nruns, "1 seed" if points and points[0].get("seeded") else "no seed"))
PY

rm -f viewer/_sessions.json viewer/_idle_sessions.txt viewer/_files.json
rm -rf viewer/_certs
