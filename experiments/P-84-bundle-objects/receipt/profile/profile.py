# Exploratory: replay a writer capture with per-action CPU, a cProfile by function, and the journal sync's wall time.
import collections
import cProfile
import importlib
import io
import json
import os
import pstats
import shutil
import sys
import time

root, capture, dest, limit = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
profiled = "--profile" in sys.argv[5:]
sys.path.insert(0, root)
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.join(dest, "journal"))
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
scope = {}
exec("import json\nfrom core.ledger.ledger import Ledger, validate\n" + operation, scope)
import tools.ledger_writer as lw

lines, prefix = [], None
with open(capture, "rb") as handle:
    for line in handle:
        path = json.loads(line)["job"]["reference"]["ledger"]
        prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
        lines.append(line.replace(prefix.encode(), dest.encode()))
        if len(lines) >= limit:
            break
journal = lw.Journal(os.path.join(dest, "journal"))
syncs = []
inner = journal.sync
def timed():
    begin = time.perf_counter()
    inner()
    syncs.append(time.perf_counter() - begin)
journal.sync = timed
if "--nosync" in sys.argv[5:]:
    journal.sync = lambda: None  # exploratory: keeps the F_FULLFSYNC wait out of the profile
writer = lw.Writer(scope["process"], importlib.import_module("tools.x1_loop"), journal, io.StringIO())
cpu, count = collections.Counter(), collections.Counter()
profile = cProfile.Profile() if profiled else None
for line in lines:
    action = json.loads(line)["action"]
    start = time.process_time()
    if profile:
        profile.enable()
    writer.batch([line])
    if profile:
        profile.disable()
    cpu[action] += time.process_time() - start
    count[action] += 1
writer.close()
total = sum(cpu.values())
print(json.dumps(dict(requests=len(lines), cpu_ms=1000 * total / len(lines),
                      by_action={a: dict(n=count[a], cpu_ms=round(1000 * cpu[a] / count[a], 3), share=round(cpu[a] / total, 3)) for a in count},
                      sync_ms=syncs and dict(mean=1000 * sum(syncs) / len(syncs), p50=1000 * sorted(syncs)[len(syncs) // 2]))))
if profile:
    out = io.StringIO()
    pstats.Stats(profile, stream=out).sort_stats(os.environ.get("SORT", "tottime")).print_stats(60)
    print(out.getvalue())
