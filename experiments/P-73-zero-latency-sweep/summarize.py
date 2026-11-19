import glob
import json
import os
import sys

here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "receipt", sys.argv[1] if len(sys.argv) > 1 else "accept")
keys = ["spawnInit", "model", "freeze", "compile", "gate", "crossing", "ledger", "promote", "setup", "unattributed"]


def load(name):
    path = os.path.join(here, name)
    return json.load(open(path)) if os.path.exists(path) else None


def rows(plan):
    data = load(f"{plan}.json")
    return data["rows"] if data else []


def line(row):
    b = row["buckets"]
    v = row["verdict"]
    return (f"| {row['label']} | {row['throughput']:.2f} | {row['completed']} | {b['wall']:.1f} | "
            + " | ".join(f"{b[k]:.1f}" for k in keys)
            + f" | {100 * row['nonModelShare']:.1f}% | {100 * row['reconciliation']:.2f}% | {100 * row['littleResidual']:.1f}% | {v['bottleneck']} ({v['kind']}) | {row['rss']['treeMb']:.0f} | {row['perGb']:.2f} | {row['cpuMsPerCandidate']:.0f} | {row['loadStart']:.1f}/{row['loadEnd']:.1f} | {row['wrongVerdicts']}/{row['errors']} |")


head = "| Row | /s | n | wall ms | " + " | ".join(keys) + " | non-model | recon | Little | verdict | RSS MB | /s per GB | CPU ms/cand | load | wrong/err |"
print(head)
print("|" + "---|" * (head.count("|") - 1))
for plan in ["predict", "sweep", "qos", "qos-clamp-clamp-utility", "qos-clamp-clamp-background", "isolation"]:
    for row in rows(plan):
        print(line(row))
floors = load("floors.json")
if floors:
    print(json.dumps({k: (v.get("p50") if isinstance(v, dict) and "p50" in v else v) for k, v in floors["floors"].items()}, indent=1)[:4000])
    d = floors["disk"]
    for k, v in d["sync"].items():
        print(k, round(v["p50"], 4), round(v["p95"], 4))
    for g in d["sqliteGroups"]:
        print(g["journal"], g["fullfsync"], g["group"], round(g["commitsPerS"]), round(g["rowsPerS"]), round(g["commitMs"]["p50"], 3))
for path in sorted(glob.glob(os.path.join(here, "memory-*.json"))):
    data = json.load(open(path))
    for row in data["rows"]:
        if row.get("kind") == "pool":
            print(os.path.basename(path), row["isolation"], row["size"], round(row["treeMb"]), round(row["perCellMb"]), round(row["parentMb"]), round(row["writerMb"]), round(row["throughput"], 1), round(row["perGb"], 2), row["errors"])
        elif row.get("kind") == "composition":
            print("composition", json.dumps({k: round(v["rssMb"]) for k, v in row["steps"].items()}), json.dumps({k: round(v["heapUsedMb"]) for k, v in row["steps"].items()}))
        else:
            s = row["state"]
            print("tier", row["label"], row["ballastCells"], round(row["treeRssMb"]), round(row["hot"]["throughput"], 1), round(row["hot"]["wallP50"]), round(row["hot"]["wallP95"]), s["swapUsedMb"], round(s["compressorMb"]), s["freePercent"], s["pressureLevel"], row["hot"]["errors"], round(row["load"], 1))
    if "pageIn" in data:
        for p in data["pageIn"]["pools"]:
            print("pagein", p["pool"], round(p["cold"]["p50"]), round(p["cold"]["max"]), round(p["warm"]["p50"]), p["swapins"], p["decompressions"])
        print("stopped", data.get("stopped"), "released", [s["swapUsedMb"] for s in data.get("released", [])], "fullPool", [round(r["throughput"], 1) for r in data.get("fullPool", [])])
