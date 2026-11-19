import hashlib
import importlib
import io
import json
import os
import shutil
import sqlite3
import sys
import time

root, capture, dest, limit = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
sys.path.insert(0, root)
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.join(dest, "journal"))
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
scope = {}
exec("import json\nfrom core.ledger.ledger import Ledger, validate\n" + operation, scope)
from tools.ledger_writer import Journal, Writer

lines, prefix = [], None
with open(capture, "rb") as source:
    for line in source:
        path = json.loads(line)["job"]["reference"]["ledger"]
        prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
        lines.append(line.replace(prefix.encode(), dest.encode()))
        if len(lines) >= limit:
            break
writer = Writer(scope["process"], importlib.import_module("tools.x1_loop"), Journal(os.path.join(dest, "journal")), io.StringIO())
began, cpu = time.perf_counter(), time.process_time()
for line in lines:
    writer.batch([line])
wall, cpu = time.perf_counter() - began, time.process_time() - cpu
writer.close()
responses = writer.output.getvalue()
rows = hashlib.sha256()
ledgers = sorted({json.loads(line)["job"]["reference"]["ledger"] for line in lines})
for path in ledgers:
    db = sqlite3.connect(path)
    for table in ("records", "x1_continuations", "x1_decisions", "ledger_journal"):
        try:
            for row in db.execute(f"SELECT * FROM {table} ORDER BY rowid"):
                rows.update(json.dumps([path[len(dest):], table, row]).encode())
        except sqlite3.OperationalError:
            pass
    db.close()
print(json.dumps(dict(requests=len(lines), ledgers=len(ledgers), errors=responses.count('"error"'),
                      responses=hashlib.sha256(responses.encode()).hexdigest(), rows=rows.hexdigest(),
                      wall_ms=1000 * wall / len(lines), cpu_ms=1000 * cpu / len(lines))))
