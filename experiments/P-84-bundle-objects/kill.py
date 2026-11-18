import glob
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time

root, capture, scratch, limit, points = sys.argv[1], sys.argv[2], os.path.abspath(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
translate = "--objects" in sys.argv[6:]
sys.path.insert(0, root)
from core.ledger.ledger import Ledger
DELAYS = (0, 0.001, 0.003, 0.006)
HEX = re.compile("[0-9a-f]{64}")
source = open(os.path.join(root, "core/runtime/isolate-ledger.mjs")).read()
operation = source.split("const operation = `", 1)[1].split("`;", 1)[0]
bridge = ("import importlib, json, sys\nfrom core.ledger.ledger import Ledger, validate\nfrom tools.ledger_writer import serve\n"
          + operation + "\nserve(process, importlib.import_module('tools.x1_loop'))\n")


def substituted(text, table):
    return HEX.sub(lambda match: table.get(match.group(), match.group()), text) if table else text


def requests(dest):
    lines, prefix = [], None
    with open(capture, "rb") as handle:
        for line in handle:
            path = json.loads(line)["job"]["reference"]["ledger"]
            prefix = prefix or path[:path.rindex("/", 0, path.rindex("/"))]
            lines.append(line.decode().replace(prefix, dest))
            if len(lines) >= limit:
                break
    return lines


def run(point, lose):
    dest = os.path.join(scratch, f"k{point}-{lose}")
    shutil.rmtree(dest, ignore_errors=True)
    os.makedirs(os.path.join(dest, "journal"))
    env = dict(os.environ, ENDOFORGE_LEDGER_JOURNAL=os.path.join(dest, "journal"))
    os.environ["ENDOFORGE_LEDGER_JOURNAL"] = env["ENDOFORGE_LEDGER_JOURNAL"]
    import tools.x1_loop as x1_loop
    child = subprocess.Popen(["python3", "-B", "-c", bridge], cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    assert json.loads(child.stdout.readline())["result"] == "ready"
    forward, acknowledged = {}, []
    lines = requests(dest)
    for index, line in enumerate(lines):
        request = json.loads(line)
        path = request["job"]["reference"]["ledger"]
        line = substituted(line, forward.get(path)) if translate else line
        child.stdin.write(line if line.endswith("\n") else line + "\n")
        child.stdin.flush()
        if index == point:
            time.sleep(DELAYS[point % len(DELAYS)])
            child.send_signal(signal.SIGKILL)
            break
        answer = json.loads(child.stdout.readline())
        acknowledged.append((request, answer))
        result = answer.get("result")
        if translate and request["action"] == "admit" and isinstance(result, dict) and "frame" in result:
            data = json.loads(result["frame"])
            old = x1_loop.inflated(dict(version=0, kind="frozen_evaluator", id=result["identity"], data=data))
            forward.setdefault(path, {}).update({old["id"][4:]: result["identity"][4:], old["data"]["freeze"]["digest"]: result["digest"]})
    child.wait()
    if lose:
        for wal in glob.glob(os.path.join(dest, "*", "ledger.sqlite-wal")):
            os.unlink(wal)
    if lose == "torn":
        segment, = glob.glob(os.path.join(dest, "journal", "*.journal"))
        data = open(segment, "rb").read()
        with open(segment, "ab") as output:
            output.write(data[:max(40, len(data) // (2 * max(1, point)))])
    from tools.ledger_writer import Journal
    journal = Journal(os.path.join(dest, "journal"))
    journal.close()
    checked, missing = 0, []
    for request, answer in acknowledged:
        if "error" in answer:
            continue
        path, result = request["job"]["reference"]["ledger"], answer["result"]
        records = {record["id"]: record for record in Ledger(path).records()}
        if request["action"] == "admit":
            record = records.get(result["identity"])
            whole = x1_loop.inflated(record) if record and translate else record
            if record is None or (translate and not json.loads(record["data"]["content"]).get("implementation")) or whole is None:
                missing.append((request["id"], "admit"))
        elif request["action"] == "commit":
            if any(records.get(receipt["record"]["id"]) != receipt["record"] for receipt in result["receipts"]):
                missing.append((request["id"], "commit"))
        elif request["action"] == "park":
            import sqlite3
            found = sqlite3.connect(path).execute("SELECT state FROM x1_continuations WHERE seq=?", (result["seq"],)).fetchone()
            if found is None:
                missing.append((request["id"], "park"))
        checked += 1
    replayed = journal.counts["frames_replayed"]
    shutil.rmtree(dest, ignore_errors=True)
    return dict(point=point, delay_ms=1000 * DELAYS[point % len(DELAYS)], lost_wal=lose, acknowledged=len(acknowledged), checked=checked, missing=missing, frames_replayed=replayed,
                conflicts=journal.counts["conflicts"], torn=journal.counts["torn_tails"])


results = [run(point, lose) for point in range(1, limit, points) for lose in (False, True, "torn")]
print(json.dumps(dict(root=root, objects=translate, kill_points=len(range(1, limit, points)), step=points, runs=len(results), checked=sum(r["checked"] for r in results),
                      missing=sum(len(r["missing"]) for r in results), frames_replayed=sum(r["frames_replayed"] for r in results),
                      conflicts=sum(r["conflicts"] for r in results), torn=sum(r["torn"] for r in results), detail=results)))
