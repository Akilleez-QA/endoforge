import glob
import json
import sys
from pathlib import Path
from statistics import mean

sweep, reference, accept = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
rows = {json.loads(p.read_text())["label"]: json.loads(p.read_text()) for p in sweep.glob("*.json")}
probes = {}
for label, row in rows.items():
    if "-ref-" in label:
        continue
    key = label.split("-", 1)[1]
    probes.setdefault(key, []).append(row["result"])
avg = {k: {f: mean(r[f] for r in v) for f in ("jobsPerS", "cpuMsPerJob", "probeCores", "loadCores", "compileMsPerJob", "gateMsPerJob")} | {"rows": len(v)} for k, v in probes.items()}
c1 = avg["n1"]["cpuMsPerJob"]
j1 = avg["n1"]["jobsPerS"]
table = {}
for k, a in avg.items():
    table[k] = dict(rows=a["rows"], jobsPerS=round(a["jobsPerS"], 1), probeCores=round(a["probeCores"], 2), loadCores=round(a["loadCores"], 2),
                    cpuMsPerJob=round(a["cpuMsPerJob"], 2), phi=round(a["cpuMsPerJob"] / c1, 3), effectiveCores=round(a["jobsPerS"] * c1 / 1000, 2),
                    streams=round(a["jobsPerS"] / j1, 2), compileMs=round(a["compileMsPerJob"], 2), gateMs=round(a["gateMsPerJob"], 2))

refs = {}
for path in sorted(glob.glob(str(reference / "row-*.json"))):
    for r in json.loads(Path(path).read_text())["rows"]:
        refs.setdefault(r["config"]["width"], []).append(r)
acc = json.loads(accept.read_text())


def metrics(r):
    roles = r["cpuMsPerNeedByRole"]
    return dict(thr=r["throughput"], cpu=sum(roles[k] for k in ("host", "cells", "writers")), host=roles["host"], cells=roles["cells"], writers=roles["writers"],
                cores=sum(r["coresByRole"][k] for k in ("host", "cells", "writers")), **{b: r["buckets"][b] for b in ("wall", "compile", "gate", "crossing", "freeze", "ledger", "promote")})


def from_summary(r):
    return dict(thr=r["thr"], cpu=r["all_cpu"], host=r["cpu_ms"]["host"], cells=r["cpu_ms"]["cells"], writers=r["cpu_ms"]["writers"], cores=r["all_cores"],
                wall=r["wall"], compile=r["compile"], gate=r["gate"], crossing=r["crossing"], freeze=r["freeze"], ledger=r["ledger"])


arms = {"accept": {w: [from_summary(r) for r in acc[w]["rows"]["accept-p84"]] for w in ("w64", "w1")},
        "session": {"w64": [metrics(r) for r in refs.get(64, [])], "w1": [metrics(r) for r in refs.get(1, [])]}}
both = {w: arms["accept"][w] + arms["session"][w] for w in ("w64", "w1")}
m = {arm: {w: {k: mean(x[k] for x in v) for k in v[0]} for w, v in d.items() if v} for arm, d in {**arms, "pooled": both}.items()}

C1 = m["pooled"]["w1"]["cpu"]
s_max_key = max((k for k in table if k.startswith("n")), key=lambda k: table[k]["effectiveCores"])
s_max = table[s_max_key]["effectiveCores"]
s_load = table["n12-load"]["effectiveCores"] + table["n12-load"]["loadCores"]
S = max(s_max, s_load)
ceiling = 1000 * S / C1
phi = table["n12-load"]["phi"]
out = dict(probe=table, c1_job=round(c1, 2), C1_need=round(C1, 2), S_max=dict(at=s_max_key, cores=s_max), S_with_load=round(s_load, 2), S=S, ceiling=round(ceiling, 1), phi_matching=phi,
           means={arm: {w: {k: round(v, 2) for k, v in d.items()} for w, d in x.items()} for arm, x in m.items()})
dist = {}
for arm in ("accept", "session", "pooled"):
    w64, w1 = m[arm]["w64"], m["pooled"]["w1"]
    d = dict(fraction=round(w64["thr"] / ceiling, 3), ceilingOverX=round(ceiling / w64["thr"], 3), occupancy=round(w64["cores"] / 12, 3),
             R=round(w64["cpu"] / (C1 * phi), 3))
    for role in ("cells", "writers", "host"):
        d[f"{role}_share"] = round(w64[role] / w64["cpu"], 3)
        d[f"{role}_distance"] = round(w64[role] / (w1[role] * phi), 3)
    littles = 64 / ceiling * 1000
    d["wall"] = dict(observed=round(w64["wall"], 1), floor=round(littles, 1), distance=round(w64["wall"] / littles, 3))
    d["compile"] = dict(observed=round(w64["compile"], 1), floor=table["n12-load"]["compileMs"], distance=round(w64["compile"] / table["n12-load"]["compileMs"], 3))
    d["gate"] = dict(observed=round(w64["gate"], 1), floor=table["n12-load"]["gateMs"], distance=round(w64["gate"] / table["n12-load"]["gateMs"], 3))
    for b in ("crossing", "freeze", "ledger"):
        floor = littles * w1[b] / w1["wall"]
        d[b] = dict(share=round(w64[b] / w64["wall"], 3), observed=round(w64[b], 1), floor=round(floor, 1), distance=round(w64[b] / floor, 3))
    dist[arm] = d
out["distances"] = dist
print(json.dumps(out, indent=1))
