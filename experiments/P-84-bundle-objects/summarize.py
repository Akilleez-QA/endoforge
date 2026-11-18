import json
import math
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARMS = ("accept-p83", "accept-p84")
SINGLE = ()


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
                        ledger_util=round(stage(row, "ledger", "utilisation"), 3), rss_gb=round(row["rss"]["treeMb"] / 1024, 3), peak_gb=round(row["rss"]["peakTreeMb"] / 1024, 3),
                        all_cpu=round(sum(v for k, v in row["cpuMsPerNeedByRole"].items() if k != "other"), 1), all_cores=round(sum(v for k, v in row["coresByRole"].items() if k != "other"), 2), wrong=row["wrongVerdicts"], errors=row["errors"],
                        recon=round(100 * row["reconciliation"], 2), outcomes=row["outcomes"], all=row["all"], verdict=row["verdict"]["bottleneck"]))
    return out


def means(table):
    out = {}
    for arm, arm_rows in table.items():
        if not arm_rows:
            continue
        mean = lambda f: statistics.mean(f(r) for r in arm_rows)
        out[arm] = dict(thr=mean(lambda r: r["thr"]), wall=mean(lambda r: r["wall"]), rss_gb=mean(lambda r: r["rss_gb"]), peak_gb=mean(lambda r: r["peak_gb"]),
                        per_gb=mean(lambda r: r["thr"]) / mean(lambda r: r["rss_gb"]), cell_net=mean(lambda r: r["cell_net"]), cell_gross=mean(lambda r: r["cell_gross"]),
                        cell_wait=mean(lambda r: r["cell_wait"]), ledger_util=mean(lambda r: r["ledger_util"]), ledger_util_range=[min(r["ledger_util"] for r in arm_rows), max(r["ledger_util"] for r in arm_rows)],
                        all_cpu=mean(lambda r: r["all_cpu"]), all_cores=mean(lambda r: r["all_cores"]),
                        cpu_ms={k: mean(lambda r: r["cpu_ms"].get(k, 0)) for k in arm_rows[0]["cpu_ms"]}, cores={k: mean(lambda r: r["cores"].get(k, 0)) for k in arm_rows[0]["cores"]},
                        buckets={k: mean(lambda r: r[k]) for k in ("compile", "gate", "crossing", "freeze", "ledger")}, spawns=mean(lambda r: r["spawns"] or 0),
                        verdicts=sorted({r["verdict"] for r in arm_rows}), wrong=sum(r["wrong"] for r in arm_rows), errors=sum(r["errors"] for r in arm_rows))
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
                             cell_cpu_ms=[statistics.mean(r["cpu_ms"]["cells"] for r in table[arm]) for arm in ARMS], means_by_arm=means(table))
        if width == "w64":
            single = {arm: describe(arm, width) for arm in SINGLE}
            report[width]["single"] = dict(rows=single, means_by_arm=means(single))
            base = [r["thr"] for r in table[ARMS[0]]]
            gains = {}
            for arm, arm_rows in [(ARMS[1], table[ARMS[1]])] + list(single.items()):
                x = [r["thr"] for r in arm_rows]
                if len(x) > 1:
                    t, df = welch(base, x)
                    gains[arm] = dict(mean=statistics.mean(x), change=statistics.mean(x) / statistics.mean(base) - 1, welch_t=t, df=df, p=two_sided_p(t, df))
            report[width]["gains"] = gains
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
