import json
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARMS = ("accept-p78", "accept-p81")


def rows(arm, width):
    found = []
    for path in sorted((HERE / "receipt" / arm).glob(f"row-{width}-*.json")):
        receipt = json.loads(path.read_text())
        assert receipt["hostWasmGuard"] is False and receipt["corpusBuild"] == "child"
        found += receipt["rows"]
    return found


def welch(a, b):
    va, vb = statistics.variance(a) / len(a), statistics.variance(b) / len(b)
    t = (statistics.mean(b) - statistics.mean(a)) / math.sqrt(va + vb)
    df = (va + vb) ** 2 / (va ** 2 / (len(a) - 1) + vb ** 2 / (len(b) - 1))
    return t, df


def two_sided_p(t, df, steps=20000):
    # P(|T| > |t|) for Student's t with df degrees of freedom, by Simpson's rule on the density from 0 to |t|.
    c = math.gamma((df + 1) / 2) / (math.sqrt(df * math.pi) * math.gamma(df / 2))
    f = lambda x: c * (1 + x * x / df) ** (-(df + 1) / 2)
    h = abs(t) / steps
    area = h / 3 * (f(0) + f(abs(t)) + sum((4 if i % 2 else 2) * f(i * h) for i in range(1, steps)))
    return max(0.0, 1 - 2 * area)


def stage(row, name, key):
    return row["view"]["stages"][name].get(key)


def describe(arm, width):
    out = []
    for row in rows(arm, width):
        out.append(dict(label=row["label"], load=round(row.get("quietLoad") or row["loadStart"], 1), rerun=row.get("rerunOf"), thr=round(row["throughput"], 2),
                        wall=round(row["buckets"]["wall"], 1), compile=round(row["buckets"]["compile"], 1), gate=round(row["buckets"]["gate"], 1), crossing=round(row["buckets"]["crossing"], 1), spawns=row.get("cellSpawnsInWindow"), freeze=round(row["buckets"]["freeze"], 1), ledger=round(row["buckets"]["ledger"], 1),
                        elu=round(row["hostElu"], 3), cores={k: round(v, 2) for k, v in row["coresByRole"].items() if k != "other"},
                        cpu_ms={k: round(v, 1) for k, v in row["cpuMsPerNeedByRole"].items() if k != "other"},
                        cell_gross=round(stage(row, "cell", "utilisation"), 3), cell_net=round(stage(row, "cell", "netUtilisation"), 3), cell_wait=round(stage(row, "cell", "waitMs"), 1),
                        ledger_util=round(stage(row, "ledger", "utilisation"), 3), wrong=row["wrongVerdicts"], errors=row["errors"],
                        recon=round(100 * row["reconciliation"], 2), outcomes=row["outcomes"], all=row["all"], verdict=row["verdict"]["bottleneck"]))
    return out


def main():
    report = {}
    for width in ("w64", "w1"):
        table = {arm: describe(arm, width) for arm in ARMS}
        key = "thr" if width == "w64" else "wall"
        a, b = [r[key] for r in table[ARMS[0]]], [r[key] for r in table[ARMS[1]]]
        t, df = welch(a, b) if len(a) > 1 and len(b) > 1 else (None, None)
        report[width] = dict(rows=table, metric=key, means=[statistics.mean(a), statistics.mean(b)],
                             change=statistics.mean(b) / statistics.mean(a) - 1, welch_t=t, df=df, p=two_sided_p(t, df) if t is not None else None,
                             cell_cpu_ms=[statistics.mean(r["cpu_ms"]["cells"] for r in table[arm]) for arm in ARMS])
    for arm in ARMS:
        path = HERE / "receipt" / arm / "bytes.json"
        if path.exists():
            row = json.loads(path.read_text())["rows"][0]
            n = row["needs"]
            report.setdefault("bytes", {})[arm] = dict(
                needs=n, ledger_kb_per_need=round(sum(v["sent"] + v["answered"] for v in row["ledgerBytes"].values()) / n / 1024, 1),
                per_action={a: dict(requests=v["requests"], sent_kb=round(v["sent"] / v["requests"] / 1024, 1), answered_kb=round(v["answered"] / v["requests"] / 1024, 1))
                            for a, v in row["ledgerBytes"].items()},
                jobs_per_need=round(row["jobBytes"]["jobs"] / n, 2), job_sent_kb_per_need=round(row["jobBytes"]["sent"] / n / 1024, 1),
                admission_kb_per_need=round(row["jobBytes"]["admission"] / n / 1024, 1), job_answered_kb_per_need=round(row["jobBytes"]["answered"] / n / 1024, 1))
    json.dump(report, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
