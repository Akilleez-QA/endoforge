import glob
import json
import math
import os
import statistics
import sys

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "receipt")
arms = sys.argv[1:] or ["accept-p75", "accept-p76"]


def rows(arm, plan):
    found = []
    for path in sorted(glob.glob(os.path.join(here, arm, f"{plan}-*.json"))):
        data = json.load(open(path))
        assert data["hostWasmGuard"] == (plan == "guard"), path
        found += data["rows"]
    return found


def welch(a, b):
    va, vb = statistics.variance(a) / len(a), statistics.variance(b) / len(b)
    return (statistics.mean(b) - statistics.mean(a)) / math.sqrt(va + vb) if va + vb else float("inf")


def cell(row, name="cell"):
    stage = row["view"]["stages"].get(name) or {}
    return stage.get("netUtilisation")


table = {}
for arm in arms:
    for plan, prefix in (("climb", "w64-"), ("climb", "w1-"), ("guard", "w64g-")):
        for row in rows(arm, plan):
            if row["label"].startswith(prefix) or row.get("rerunOf", "").startswith(prefix):
                table.setdefault((prefix, arm), []).append(row)
print("| row | arm | needs/s | host ELU | wall ms | freeze | crossing | ledger | compile+gate | cell net | verdict | tree MB | load start/quiet | wrong/err | outcomes |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for (prefix, arm), found in sorted(table.items()):
    for r in found:
        b = r["buckets"]
        print(f"| {r['label']} | {arm} | {r['throughput']:.2f} | {r['hostElu']:.3f} | {b['wall']:.1f} | {b['freeze']:.1f} | {b['crossing']:.1f} | {b['ledger']:.1f} | {b['compile'] + b['gate']:.1f} | "
              f"{(cell(r) or 0):.2f} | {r['verdict']['bottleneck']} ({r['verdict']['kind']}) | {r['rss']['treeMb']:.0f} | {r['loadStart']:.1f}/{(r.get('quietLoad') or 0):.1f} | {r['wrongVerdicts']}/{r['errors']} | {json.dumps(r['outcomes'], sort_keys=True)} |")
for prefix, key in (("w64-", "throughput"), ("w64-", "hostElu"), ("w1-", "wall"), ("w64g-", "throughput"), ("w64g-", "hostElu")):
    get = (lambda r: r["buckets"]["wall"]) if key == "wall" else (lambda r: r[key])
    a, b = [list(map(get, table.get((prefix, arm), []))) for arm in arms]
    if len(a) > 1 and len(b) > 1:
        ma, mb = statistics.mean(a), statistics.mean(b)
        print(f"{prefix}{key}: p75 {[round(x, 3) for x in a]} mean {ma:.3f}; p76 {[round(x, 3) for x in b]} mean {mb:.3f}; change {100 * (mb - ma) / ma:+.1f}%; Welch t {welch(a, b):.2f}")
for arm in arms:
    for path in glob.glob(os.path.join(here, arm, "bytes.json")):
        r = json.load(open(path))["rows"][0]
        per = sum(v["sent"] + v["answered"] for v in r["ledgerBytes"].values()) / r["needs"]
        print(arm, "ledger bytes per need", round(per), {k: (v["requests"], round(v["sent"] / v["requests"]), round(v["answered"] / v["requests"])) for k, v in r["ledgerBytes"].items()})
