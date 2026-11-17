# Replay a writer capture in batches of N with the syncer running, as a live writer does; prints the row digest and the answers sorted by id.
import hashlib, importlib, io, json, os, shutil, sqlite3, sys, threading

root, capture, dest, size = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
sys.path.insert(0, root)
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.join(dest, "journal"))
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
scope = {}
exec("import json\nfrom core.ledger.ledger import Ledger, validate\n" + operation, scope)
from tools.ledger_writer import Journal, Writer

lines, prefix = [], None
with open(capture, "rb") as handle:
    for line in handle:
        path = json.loads(line)["job"]["reference"]["ledger"]
        prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
        lines.append(line.replace(prefix.encode(), dest.encode()))


class Output(io.StringIO):
    lock = threading.Lock()

    def write(self, text):
        with self.lock:
            return super().write(text)


writer = Writer(scope["process"], importlib.import_module("tools.x1_loop"), Journal(os.path.join(dest, "journal")), Output())
writer.start()
for start in range(0, len(lines), size):
    writer.batch(lines[start:start + size])
writer.close()
answers = sorted(writer.output.getvalue().splitlines(), key=lambda text: json.loads(text)["id"])
rows = hashlib.sha256()
for path in sorted({json.loads(line)["job"]["reference"]["ledger"] for line in lines}):
    db = sqlite3.connect(path)
    for table in ("records", "x1_continuations", "x1_decisions", "ledger_journal"):
        try:
            for row in db.execute(f"SELECT * FROM {table} ORDER BY rowid"):
                rows.update(json.dumps([path[len(dest):], table, row]).encode())
        except sqlite3.OperationalError:
            pass
    db.close()
print(json.dumps(dict(requests=len(lines), batch=size, answers=len(answers), errors=sum('"error"' in a for a in answers),
                      sorted_answers=hashlib.sha256("\n".join(answers).encode()).hexdigest(), rows=rows.hexdigest(),
                      frames=writer.journal.counts["frames"], journal_syncs=writer.journal.counts["journal_syncs"])))
