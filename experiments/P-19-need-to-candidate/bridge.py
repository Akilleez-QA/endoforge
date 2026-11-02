import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT), str(ROOT.parent / "cstack")]
from core.ledger.ledger import Ledger
from core.ledger.frozen import FrozenEvaluators
from adapters.endoforge_ledger import EndoforgeLedger

action, directory = sys.argv[1], Path(sys.argv[2])
request = json.load(sys.stdin)
ledger_path = directory / "engine.sqlite"
oracle_root = directory / "oracle"


def append(kind, identity, data):
    Ledger(ledger_path).append(dict(version=0, kind=kind, id=identity, data=data))


if action == "intake":
    from cli import run_document
    document = json.loads((ROOT.parent / "cstack/examples/scalar-and-negative.json").read_text())
    template = document["calls"][0]
    document["goal"]["objective"] = "Implement pure integer add(a,b) on [-10,10]."
    document["goal"]["acceptance_criteria"] = ["Six exact addition examples; software checks remain external."]
    document["calls"] = []
    tests = []
    for index, (a, b) in enumerate([(0, 0), (2, 3), (-4, 3), (10, -10), (-10, -10), (10, 10)]):
        call = json.loads(json.dumps(template))
        call["request"].update(request_id=f"request-{index}", decision_id=f"decision-{index}")
        call["request"]["arguments"]["operands"] = [dict(numerator=n, denominator=1) for n in (a, b)]
        call["precommitment"]["expected_observation"] = f"Exact integer {a + b}"
        document["calls"].append(call)
        tests.append(dict(id=f"case-{index}", inputs=dict(a=a, b=b), expected=a+b))
    config = directory / "host.json"
    config.write_text(json.dumps(dict(endoforge=dict(path="witness.jsonl"))))
    result = run_document(document, config=config)
    assert result["run_status"] == "completed" and result["endoforge_implemented"]
    outcomes = [e["data"]["outcome"] for e in result["events"] if e["kind"] == "outcome"]
    assert len(outcomes) == 6
    for test, outcome in zip(tests, outcomes):
        assert outcome["execution_status"] == "completed"
        observed = outcome["raw_result"]["structuredContent"]["receipt"]["result"]
        assert observed == dict(domain="Q", numerator=test["expected"], denominator=1)
        test["expected"] = observed["numerator"]
    (directory / "intake.json").write_text(json.dumps(dict(document=document, result=result)))
    print(json.dumps(dict(tests=tests, outcomes=outcomes)))
elif action == "freeze":
    oracle_root.mkdir()
    shutil.copyfile(Path(__file__).with_name("port.mjs"), oracle_root / "port.mjs")
    (oracle_root / "tests.json").write_text(json.dumps(request["tests"]))
    append("task", "task", dict(intent="Integer addition", acceptance="Six frozen exact tests"))
    append("admitted_input", "input", dict(task="task", content=json.dumps(request["tests"]), origin="cstack Math observations"))
    record = FrozenEvaluators(Ledger(ledger_path)).freeze(oracle_root, task="task", admitted_input="input",
        confirmed_by="P-19 precommit", qualification="Precommitted addition and subtraction controls; results not yet observed",
        synthesis_context=dict(id="context", candidate_blind="confirmed", inputs=["input"]),
        configuration=request["configuration"], residual="All six exact additions match", invariant_version="1")
    print(json.dumps(dict(reference=dict(ledger=str(ledger_path), root=str(oracle_root), identity=record["id"]),
                         digest=record["data"]["freeze"]["digest"])))
elif action == "register":
    for identity, content in request.items():
        assert hashlib.sha256(content.encode()).hexdigest() == identity
        append("candidate", identity, dict(task="task", admitted_input="input", content=content, proposer="synthetic preauthored stand-in"))
    print("{}")
elif action == "verify":
    records = Ledger(ledger_path).records()
    receipts = [r for r in records if r["kind"] == "receipt"]
    assert len(records) == 7 and len(receipts) == 2
    with sqlite3.connect(ledger_path) as db:
        hashes = dict(db.execute("SELECT id, hash FROM records"))
    assert [r["record"] for r in request["receipts"]] == receipts
    assert all(hashes[r["record"]["id"]] == r["hash"] for r in request["receipts"])
    assert [r["data"]["outcome_state"] for r in receipts] == ["passed", "failed"]
    assert all(r["data"]["frozen_evaluator"] == request["report"]["frozen_evaluator"] for r in receipts)
    for record in records:
        if record["kind"] == "candidate":
            content = (directory / record["id"]).read_text()
            assert content == record["data"]["content"] and hashlib.sha256(content.encode()).hexdigest() == record["id"]
    with EndoforgeLedger(directory / "witness.jsonl") as port:
        assert port.verify_chain() is True
        witnessed = [r.read() for r in port.read_records(goal_id="synthetic-math")]
    assert [r["kind"] for r in witnessed] == ["precommit"] * 6 + [kind for _ in range(6) for kind in ("precommit", "outcome")]
    original = json.loads((directory / "intake.json").read_text())
    assert [r["payload"] for r in witnessed if r["kind"] == "outcome"] == [e["data"]["outcome"] for e in original["result"]["events"] if e["kind"] == "outcome"]
    print(json.dumps(dict(engine_chain=True, cstack_chain=True, engine_records=records,
                         engine_hashes=hashes, witnessed_records=witnessed)))
else:
    raise ValueError("Unknown bridge action")
