# Exploratory: where a live writer request's time goes, from the P-79 exploratory trace (one JSON file per writer).
# Each entry: action, batch start, batch end, batch size, decision-write seconds, flush start, journal synced, responded, responses in flush.
import collections, json, pathlib, statistics, sys

rows = [entry for path in pathlib.Path(sys.argv[1]).glob("*.json") for entry in json.loads(path.read_text())]
start = min(r[1] for r in rows); end = max(r[7] for r in rows)
rows = [r for r in rows if r[1] > start + 6]  # skip warm-up
by = collections.defaultdict(list)
for action, t0, t1, size, decide, t2, t3, t5, n in rows:
    by[action].append(dict(apply=t1 - t0, queued=t2 - t1, journal=t3 - t2, after_journal=t5 - t3, decide=decide, total=t5 - t0))
flushes = {(r[5], r[6]) for r in rows}
span = end - start - 6
print(f"requests {len(rows)}, flushes {len(flushes)}, journal sync mean {1000 * statistics.mean(b - a for a, b in flushes):.2f} ms, requests per flush {len(rows) / len(flushes):.2f}")
for action, items in by.items():
    print(action, len(items), {k: round(1000 * statistics.mean(i[k] for i in items), 2) for k in items[0]})
