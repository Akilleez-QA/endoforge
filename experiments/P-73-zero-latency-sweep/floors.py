import fcntl
import json
import os
import sqlite3
import sys
import time

root = sys.argv[1]


def stats(values):
    s = sorted(values)
    pick = lambda p: s[min(len(s) - 1, int(p * len(s)))]
    return {"n": len(s), "min": s[0], "p50": pick(0.5), "p95": pick(0.95), "max": s[-1], "mean": sum(s) / len(s)}


def sync_latency(kind, size, n):
    path = os.path.join(root, f"sync-{kind}-{size}")
    fd = os.open(path, os.O_CREAT | os.O_WRONLY | os.O_APPEND, 0o600)
    block, samples = b"x" * size, []
    for _ in range(n):
        os.write(fd, block)
        begin = time.perf_counter()
        if kind == "fsync":
            os.fsync(fd)
        elif kind == "fullfsync":
            fcntl.fcntl(fd, fcntl.F_FULLFSYNC)
        else:
            fcntl.fcntl(fd, getattr(fcntl, "F_BARRIERFSYNC", 85))
        samples.append((time.perf_counter() - begin) * 1000)
    os.close(fd)
    os.unlink(path)
    return stats(samples)


def sqlite_group(journal, fullfsync, group, seconds=2.0):
    path = os.path.join(root, f"db-{journal}-{fullfsync}-{group}.sqlite")
    db = sqlite3.connect(path, isolation_level=None)
    db.execute(f"PRAGMA journal_mode={journal}")
    db.execute("PRAGMA synchronous=FULL")
    db.execute(f"PRAGMA fullfsync={'ON' if fullfsync else 'OFF'}")
    db.execute(f"PRAGMA checkpoint_fullfsync={'ON' if fullfsync else 'OFF'}")
    db.execute("CREATE TABLE records (seq INTEGER PRIMARY KEY, body BLOB)")
    body, commits, rows, latencies = os.urandom(2048), 0, 0, []
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        begin = time.perf_counter()
        db.execute("BEGIN")
        for _ in range(group):
            db.execute("INSERT INTO records (body) VALUES (?)", (body,))
        db.execute("COMMIT")
        latencies.append((time.perf_counter() - begin) * 1000)
        commits += 1
        rows += group
    db.close()
    for suffix in ("", "-wal", "-shm", "-journal"):
        if os.path.exists(path + suffix):
            os.unlink(path + suffix)
    return {"journal": journal, "fullfsync": fullfsync, "group": group, "commitsPerS": commits / seconds, "rowsPerS": rows / seconds, "commitMs": stats(latencies)}


out = {"sqlite": sqlite3.sqlite_version, "python": sys.version.split()[0], "sync": {}, "sqliteGroups": []}
for kind in ("fsync", "barrierfsync", "fullfsync"):
    out["sync"][f"{kind}_4k"] = sync_latency(kind, 4096, 300)
    big = sync_latency(kind, 1 << 20, 40)
    out["sync"][f"{kind}_1m"] = {**big, "mbPerS": 1000 / big["mean"]}
for journal, fullfsync in (("DELETE", False), ("DELETE", True), ("WAL", False), ("WAL", True)):
    for group in (1, 4, 16, 64, 256):
        out["sqliteGroups"].append(sqlite_group(journal, fullfsync, group))
print(json.dumps(out))
