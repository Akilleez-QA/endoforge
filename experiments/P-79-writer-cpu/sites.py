# Exploratory: CPU and bytes of json.dumps, json.loads, sha256, bytes.fromhex/.hex and SQLite by calling site, over a writer replay (sync off).
import collections, hashlib, importlib, io, json, os, shutil, sqlite3, sys, time

root, capture, dest, limit = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
sys.path.insert(0, root)
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.join(dest, "journal"))
cost = collections.defaultdict(lambda: [0, 0.0, 0])
recording = [True]

def site(depth=2):
    frame = sys._getframe(depth)
    where = f"{os.path.basename(frame.f_code.co_filename)}:{frame.f_code.co_name}:{frame.f_lineno}"
    if frame.f_code.co_name in ("encode", "digest", "event_hash", "conforms", "<genexpr>"):
        while frame.f_code.co_name in ("encode", "digest", "event_hash", "conforms", "<genexpr>"):
            frame = frame.f_back
        where += f"<{frame.f_code.co_name}:{frame.f_lineno}"
    return where

def wrap(name, fn, size):
    def inner(*args, **kwargs):
        begin = time.process_time()
        out = fn(*args, **kwargs)
        if not recording[0]:
            return out
        entry = cost[(name, site())]
        entry[0] += 1; entry[1] += time.process_time() - begin; entry[2] += size(args, out)
        return out
    return inner

json.dumps = wrap("dumps", json.dumps, lambda a, o: len(o))
json.loads = wrap("loads", json.loads, lambda a, o: len(a[0]))
real_sha = hashlib.sha256
hashlib.sha256 = wrap("sha256", real_sha, lambda a, o: len(a[0]) if a else 0)
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
scope = {}
exec("import json\nfrom core.ledger.ledger import Ledger, validate\n" + operation, scope)
import core.ledger.ledger as L, core.ledger.frozen as F, tools.x1_loop as X, tools.ledger_writer as W
for module in (L, F, X, W):
    if hasattr(module, "hashlib"):
        pass
W.hashlib = hashlib; L.hashlib = hashlib; F.hashlib = hashlib; X.hashlib = hashlib
X.repository_files = wrap("repository_files", X.repository_files, lambda a, o: sum(map(len, o.values())))
F.snapshot = wrap("snapshot", F.snapshot, lambda a, o: len(o)); X.snapshot = F.snapshot
L.conforms_top = None
real_validate = L.validate
L.validate = wrap("validate", real_validate, lambda a, o: 0); scope["validate"] = L.validate
F.validate_frozen = wrap("validate_frozen", F.validate_frozen, lambda a, o: 0)

class Conn:
    def __init__(self, db): self.db = db
    def execute(self, sql, p=()):
        begin = time.process_time(); out = self.db.execute(sql, p)
        if not recording[0]: return out
        entry = cost[("sql", sql.split("(")[0][:60])]; entry[0] += 1; entry[1] += time.process_time() - begin
        return out
    def commit(self):
        begin = time.process_time(); self.db.commit()
        if not recording[0]: return
        entry = cost[("sql", "COMMIT")]; entry[0] += 1; entry[1] += time.process_time() - begin
    def __getattr__(self, n): return getattr(self.db, n)
real_conn = W.ledger_connection
W.ledger_connection = lambda path: (lambda l, d: (l, Conn(d)))(*real_conn(path))

lines, prefix = [], None
with open(capture, "rb") as handle:
    for line in handle:
        path = json.loads(line)["job"]["reference"]["ledger"]
        prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
        lines.append(line.replace(prefix.encode(), dest.encode()))
        if len(lines) >= limit:
            break
cost.clear()
journal = W.Journal(os.path.join(dest, "journal"))
journal.sync = lambda: None
writer = W.Writer(scope["process"], X, journal, io.StringIO())
only = os.environ.get("ONLY")
total, n = 0.0, 0
for line in lines:
    recording[0] = not only or json.loads(line)["action"] == only
    begin = time.process_time()
    writer.batch([line])
    if recording[0]:
        total += time.process_time() - begin
        n += 1
print(f"requests {n}{' ' + only if only else ''}, CPU {1000 * total / n:.3f} ms per request (instrumented)")
by = collections.Counter()
for (kind, where), (calls, seconds, size) in sorted(cost.items(), key=lambda kv: -kv[1][1]):
    by[kind] += seconds
    if seconds / n * 1000 >= 0.02:
        print(f"{kind:16} {where:70} calls/req {calls / n:6.2f}  ms/req {1000 * seconds / n:6.3f}  KB/req {size / n / 1024:8.1f}")
print({k: round(1000 * v / n, 3) for k, v in by.items()})
