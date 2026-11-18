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
handles = "--handles" in sys.argv[5:]
sys.path.insert(0, root)
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.join(dest, "journal"))
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
scope = {}
exec("import json\nfrom core.ledger.ledger import Ledger, validate\n" + operation, scope)
from tools.ledger_writer import Journal, Writer

IMPLEMENTATION = ("host.mjs", "gates.mjs", "glue.schema.json", "measure.mjs", "meter.mjs", "contract.mjs", "dimensions.mjs",
                  "generator.mjs", "ledger.mjs", "reference.mjs", "scalar.mjs", "loop-port.mjs", "agent.mjs", "oracle.mjs")


def to_handles(line):
    # A P-76 admit carried the 14 implementation files as hex; P-77's carries their SHA-256 instead.
    request = json.loads(line)
    files = (request.get("result") or {}).get("files")
    if request["action"] != "admit" or files is None:
        return line
    request["result"]["implementation"] = {name: hashlib.sha256(bytes.fromhex(files.pop(name))).hexdigest() for name in IMPLEMENTATION if name in files}
    return (json.dumps(request) + "\n").encode()


def assembled(result):
    # Recover P-76's `encoded` from P-77's frame: put each elided file back, re-encode, and check the identity hash.
    from core.ledger.ledger import encode
    data = json.loads(result.pop("frame"))
    content = data["content"]
    for name in result.pop("elided"):
        text = open(os.path.join(root, "core/runtime/x1", name), "rb").read().hex()
        assert content.count(f'"{name}":""') == 1
        content = content.replace(f'"{name}":""', f'"{name}":"{text}"')
    data["content"] = content
    encoded = encode(data)
    assert "evr:" + hashlib.sha256(encoded.encode()).hexdigest() == result["identity"]
    assert hashlib.sha256(content.encode()).hexdigest() == result["digest"]
    first = {key: result.pop(key) for key in ("identity", "digest")}
    return {**first, "encoded": encoded, **result}


def normalized(text):
    out = []
    for line in text.splitlines():
        response = json.loads(line)
        if isinstance(response.get("result"), dict) and "frame" in response["result"]:
            response["result"] = assembled(response["result"])
        out.append(json.dumps(response))
    return "\n".join(out)


lines, prefix = [], None
with open(capture, "rb") as source:
    for line in source:
        path = json.loads(line)["job"]["reference"]["ledger"]
        prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
        line = line.replace(prefix.encode(), dest.encode())
        lines.append(to_handles(line) if handles else line)
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
sent = sum(len(line) for line in lines)
print(json.dumps(dict(requests=len(lines), ledgers=len(ledgers), errors=responses.count('"error"'), handles=handles,
                      sent_bytes=sent, answered_bytes=len(responses),
                      responses=hashlib.sha256(responses.encode()).hexdigest(), normalized=hashlib.sha256(normalized(responses).encode()).hexdigest(), rows=rows.hexdigest(),
                      wall_ms=1000 * wall / len(lines), cpu_ms=1000 * cpu / len(lines))))
