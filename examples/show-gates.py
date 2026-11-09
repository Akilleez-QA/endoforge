import base64
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from core.ledger.ledger import Ledger

path = sys.argv[1]
records = Ledger(path).records()
print("ledger records:", ", ".join(record["kind"] for record in records))
receipt = next(record for record in records if record["kind"] == "receipt")
attempt = receipt["data"]["observations"][0]["report"]["attempts"][0]
gates = json.loads(next(r for r in attempt["results"] if r["check"] == "residual")["reason"])["gates"]
for name, gate in sorted(gates.items()):
    detail = {key: value for key, value in gate.items() if key not in ("ok", "wasmSha256")}
    print(f"  {name:17} {'pass' if gate['ok'] else 'FAIL'}  {json.dumps(detail) if detail else ''}".rstrip())
with sqlite3.connect(path) as db:
    decision = json.loads(db.execute("SELECT body FROM x1_decisions").fetchone()[0])
print("decision:", decision["decision"])
if decision["decision"] == "promote":
    candidate = next(record for record in records if record["kind"] == "candidate")
    module = Path(path).with_name("kernel.wasm")
    module.write_bytes(base64.b64decode(json.loads(candidate["data"]["content"])["compiled"]["wasm"]))
    print(f"kernel: {module} ({module.stat().st_size} bytes)")
