import hashlib
import importlib
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import time

root, capture, dest, limit = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
translate = "--objects" in sys.argv[5:]
synced = "--sync" in sys.argv[5:]
sys.path.insert(0, root)
shutil.rmtree(dest, ignore_errors=True)
os.makedirs(os.path.join(dest, "journal"))
os.environ["ENDOFORGE_LEDGER_JOURNAL"] = os.path.join(dest, "journal")
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
scope = {}
exec("import json\nfrom core.ledger.ledger import Ledger, validate\n" + operation, scope)
from core.ledger.ledger import encode, event_hash
from tools.ledger_writer import Journal, Writer
x1_loop = importlib.import_module("tools.x1_loop")
HEX = re.compile("[0-9a-f]{64}")
IMPLEMENTATION = x1_loop.IMPLEMENTATION_FILES


def substituted(text, table):
    return HEX.sub(lambda match: table.get(match.group(), match.group()), text) if table else text


def whole(record):
    return x1_loop.inflated(record) if hasattr(x1_loop, "inflated") else record


def mapped_rows(path):
    db = sqlite3.connect(path)
    table, previous, rows = {}, "0" * 64, []
    for seq, identity, body, _, digest in db.execute("SELECT seq, id, body, previous, hash FROM records ORDER BY seq"):
        record = json.loads(body)
        if record["kind"] == "frozen_evaluator":
            old = whole(record)
            table[record["id"][4:]], table[record["data"]["freeze"]["digest"]] = old["id"][4:], old["data"]["freeze"]["digest"]
            body = encode(old)
        else:
            body = substituted(body, table)
        mapped = event_hash(seq, previous, body)
        table[digest] = mapped
        rows.append(["records", seq, json.loads(body)["id"], body, previous, mapped])
        previous = mapped
    for name, query in (("x1_continuations", "SELECT * FROM x1_continuations ORDER BY rowid"),
                        ("x1_decisions", "SELECT * FROM x1_decisions ORDER BY rowid")):
        try:
            found = list(db.execute(query))
        except sqlite3.OperationalError:
            continue
        for row in found:
            row = [substituted(value, table) if isinstance(value, str) else value for value in row]
            if name == "x1_decisions":
                decision = json.loads(row[2])
                decision.pop("sha256")
                row[2] = json.dumps(x1_loop.sealed(decision), sort_keys=True)
            rows.append([name, *row])
    journal = db.execute("SELECT count(*) FROM ledger_journal").fetchone()[0]
    db.close()
    return rows, journal, table


def assembled(result):
    data = json.loads(result["frame"])
    if result["elided"]:
        content = data["content"]
        for name in result["elided"]:
            text = open(os.path.join(root, "core/runtime/x1", name), "rb").read().hex()
            assert content.count(f'"{name}":""') == 1
            content = content.replace(f'"{name}":""', f'"{name}":"{text}"')
        data = dict(data, content=content)
        record = dict(version=0, kind="frozen_evaluator", id="evr:" + hashlib.sha256(encode(data).encode()).hexdigest(), data=data)
    else:
        record = whole(dict(version=0, kind="frozen_evaluator", id=result["identity"], data=data))
    rest = {key: value for key, value in result.items() if key not in ("identity", "digest", "frame", "elided")}
    return dict(identity=record["id"], digest=record["data"]["freeze"]["digest"], encoded=encode(record["data"]), **rest)


lines, prefix = [], None
with open(capture, "rb") as handle:
    for line in handle:
        path = json.loads(line)["job"]["reference"]["ledger"]
        prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
        lines.append(line.replace(prefix.encode(), dest.encode()))
        if len(lines) >= limit:
            break
journal = Journal(os.path.join(dest, "journal"))
if not synced:
    journal.sync = lambda: None
output = io.StringIO()
writer = Writer(scope["process"], x1_loop, journal, output)
forward, ledger_of, answers, cpu, by_action = {}, {}, [], 0.0, {}
for line in lines:
    request = json.loads(line)
    path = request["job"]["reference"]["ledger"]
    if translate and path in forward:
        line = substituted(line.decode(), forward[path]).encode()
    ledger_of[request["id"]] = path
    mark = len(output.getvalue())
    begin = time.process_time()
    writer.batch([line])
    spent = time.process_time() - begin
    cpu += spent
    by_action.setdefault(request["action"], []).append(spent)
    answer = json.loads(output.getvalue()[mark:])
    answers.append(answer)
    result = answer.get("result")
    if translate and request["action"] == "admit" and isinstance(result, dict) and "frame" in result:
        old = assembled(result)
        forward.setdefault(path, {})
        forward[path][old["identity"][4:]], forward[path][old["digest"]] = result["identity"][4:], result["digest"]
writer.close()
rows, journals, tables = hashlib.sha256(), 0, {}
ledgers = sorted({json.loads(line)["job"]["reference"]["ledger"] for line in lines})
for path in ledgers:
    found, count, tables[path] = mapped_rows(path)
    journals += count
    for row in found:
        rows.update(json.dumps([path[len(dest):], *row]).encode())
normalized = hashlib.sha256()
for answer in answers:
    result = answer.get("result")
    if isinstance(result, dict) and "frame" in result:
        result = assembled(result)
    text = substituted(json.dumps(dict(answer, result=result) if result is not None else answer, sort_keys=True), tables[ledger_of[answer["id"]]])
    response = json.loads(text)
    decision = (response.get("result") or {}).get("decision") if isinstance(response.get("result"), dict) else None
    if isinstance(decision, dict) and "sha256" in decision:
        decision.pop("sha256")
        response["result"]["decision"] = x1_loop.sealed(decision)
    normalized.update(json.dumps(response, sort_keys=True).encode())
stored = os.path.join(dest, "journal", "objects")
objects = sorted(os.listdir(stored)) if os.path.isdir(stored) else []
frozen_bytes = []
for path in ledgers:
    db = sqlite3.connect(path)
    frozen_bytes += [len(body) for (body,) in db.execute("SELECT body FROM records WHERE body LIKE '%\"kind\":\"frozen_evaluator\"%'")]
    db.close()
print(json.dumps(dict(requests=len(lines), ledgers=len(ledgers), errors=sum("error" in answer for answer in answers), translated=translate,
                      rows=rows.hexdigest(), answers=normalized.hexdigest(), journal_versions=journals,
                      journal_bytes=journal.counts["journal_bytes"], frames=journal.counts["frames"],
                      objects=len(objects), objects_verified=all(hashlib.sha256(open(os.path.join(stored, name), "rb").read()).hexdigest() == name for name in objects),
                      frozen_record_bytes=sum(frozen_bytes) / max(1, len(frozen_bytes)), cpu_ms=1000 * cpu / len(lines),
                      by_action={action: dict(n=len(spent), cpu_ms=1000 * sum(spent) / len(spent)) for action, spent in by_action.items()})))
