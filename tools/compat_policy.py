import hashlib
import json
import math
import re
import sqlite3
import sys
from contextlib import closing

from core.ledger.frozen import frozen_record
from core.ledger.ledger import Ledger, encode
from tools.x1_loop import store_decision

POLICY = "COMPAT-TS-CHECK-RUN2-TESTS/v1"
LANE = "compatibility"
ROUTE = "typescript"
ISSUER = "endoforge.local.compat"
ACCEPTANCE = "compatibility lane: type checks clean, two identical contained runs, every frozen test passes"
USAGE = "usage: python3 -m tools.compat_policy freeze|register|receipt|promote < request.json"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
DECISIONS = ("CREATE TABLE IF NOT EXISTS compat_decisions (receipt TEXT PRIMARY KEY, candidate TEXT NOT NULL, "
             "policy TEXT NOT NULL, body TEXT NOT NULL)")


def sha256(text):
    return hashlib.sha256(text.encode()).hexdigest()


def sealed(decision):
    decision["sha256"] = sha256(json.dumps(decision, sort_keys=True, separators=(",", ":")))
    return decision


def frozen_of(records, identity):
    record = records.get(identity)
    if record is None or record["kind"] != "frozen_evaluator" or "freeze" not in record["data"]:
        raise ValueError("a content-hashed compatibility evaluator is required")
    bundle = json.loads(record["data"]["content"])
    configuration = bundle["configuration"]
    if (configuration.get("policy") != POLICY or configuration.get("lane") != LANE
            or configuration.get("route") != ROUTE or bundle["residual"] != POLICY):
        raise ValueError("the evaluator was not frozen under the compatibility policy")
    tests = bytes.fromhex(bundle["files"]["tests.json"]).decode()
    compiler = configuration["compiler"]
    if not isinstance(compiler, str) or not HEX64.match(compiler):
        raise ValueError("the evaluator names no pinned compiler")
    return record, tests, compiler


def freeze(request):
    ledger = Ledger(request["ledger"])
    tests, compiler = request["tests"], request["compiler"]
    if not isinstance(tests, str) or not isinstance(json.loads(tests), list) or not json.loads(tests):
        raise ValueError("frozen tests must be a non-empty JSON array")
    if not isinstance(compiler, str) or not HEX64.match(compiler):
        raise ValueError("compiler must be a SHA-256 digest")
    records = {r["id"]: r for r in ledger.records()}
    if "task" not in records:
        ledger.append(dict(version=0, kind="task", id="task", data=dict(intent=request["need"], acceptance=ACCEPTANCE)))
        ledger.append(dict(version=0, kind="admitted_input", id="input",
                           data=dict(task="task", content=request["need"], origin="caller")))
    elif records["task"]["data"] != dict(intent=request["need"], acceptance=ACCEPTANCE):
        raise ValueError("need differs from the task in this ledger")
    record = frozen_record(None, files={"tests.json": tests.encode().hex()}, task="task", admitted_input="input",
                           confirmed_by="none: frozen by the host before any candidate",
                           qualification="none: compatibility route evidence only",
                           synthesis_context=dict(id="need", candidate_blind="confirmed", inputs=["input"]),
                           configuration=dict(lane=LANE, route=ROUTE, policy=POLICY, compiler=compiler),
                           residual=POLICY, invariant_version="1")
    if record["id"] not in records:
        ledger.append(record)
    return dict(identity=record["id"], digest=record["data"]["freeze"]["digest"])


def register(request):
    ledger = Ledger(request["ledger"])
    files = request["files"]
    if set(files) != {"kernel.ts", "tests.json"} or not all(isinstance(v, str) for v in files.values()):
        raise ValueError("a compatibility candidate is kernel.ts and tests.json")
    content = encode(dict(files))
    identity = sha256(content)
    if identity not in {r["id"] for r in ledger.records()}:
        ledger.append(dict(version=0, kind="candidate", id=identity,
                           data=dict(task="task", admitted_input="input", content=content, proposer="configured generator")))
    return identity


def receipt(request):
    ledger = Ledger(request["ledger"])
    report, candidate, frozen = request["report"], request["candidate"], request["frozen_evaluator"]
    records = {r["id"]: r for r in ledger.records()}
    record, _, _ = frozen_of(records, frozen)
    status = report.get("status")
    delivery, outcome = (("finished", "passed") if status == "completed" else ("finished", "failed") if status == "refused"
                         else ("outcome_unknown", "inconclusive"))
    identity = request.get("id") or "rcpt:" + sha256(candidate + encode(report))
    data = dict(task="task", candidate=candidate, frozen_evaluator=frozen,
                precommit=dict(observable="compatibility route report", acceptance_boundary=POLICY, oracle=frozen,
                               oracle_version=record["data"]["freeze"]["digest"], artifact_identity=candidate,
                               environment=dict(lane=LANE, route=ROUTE, node=str(report.get("node", "unrecorded"))),
                               failure_meaning="candidate not promoted", stop_condition="one route report"),
                delivery_state=delivery, outcome_state=outcome, observations=[dict(status=status, report=report)])
    return dict(id=identity, hash=ledger.append(dict(version=0, kind="receipt", id=identity, data=data)))


def truthy(value):
    if value is None or value is False:
        return False
    if isinstance(value, (int, float)):
        return value != 0 and not math.isnan(value)
    if isinstance(value, str):
        return value != ""
    return True


def number(value):
    if isinstance(value, bool):
        return float(value)
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip()
        if text == "":
            return 0.0
        if re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?|[+-]?Infinity", text) is None:
            return math.nan
        return float(text.replace("Infinity", "inf"))
    return math.nan


def text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e21:
        return str(int(value))
    if isinstance(value, float):
        return repr(value)
    return None


def passes(test, result):
    if not isinstance(test, dict) or not isinstance(result, dict):
        return False
    if test.get("expectError"):
        return "err" in result
    if "err" in result:
        return False
    expect = test.get("expect")
    out = result.get("out") if "out" in result else math.nan
    if isinstance(expect, bool):
        return truthy(out) == expect or (not isinstance(out, bool) and isinstance(out, (int, float)) and out == (1 if expect else 0))
    if isinstance(expect, (int, float)):
        tol = test.get("tol")
        got = number(out)
        if isinstance(tol, (int, float)) and not isinstance(tol, bool) and math.isfinite(tol):
            return abs(got - expect) <= tol
        return got == expect
    want, have = text(expect), text(out)
    return want is not None and have is not None and want == have


def judge(records, candidate_id, receipt_record, frozen_tests, compiler):
    candidate = records[candidate_id]
    if candidate["kind"] != "candidate" or sha256(candidate["data"]["content"]) != candidate["id"]:
        raise ValueError("candidate content differs from its identity")
    files = json.loads(candidate["data"]["content"])
    if set(files) != {"kernel.ts", "tests.json"} or files["tests.json"] != frozen_tests:
        raise ValueError("the candidate's tests differ from the frozen tests")
    data = receipt_record["data"]
    if data["delivery_state"] != "finished" or data["outcome_state"] != "passed":
        raise ValueError("no passing route outcome")
    observation, = data["observations"]
    report = observation["report"]
    tests = json.loads(frozen_tests)
    artifact = report.get("artifact")
    if (observation["status"] != "completed" or report.get("lane") != LANE or report.get("route") != ROUTE
            or report.get("status") != "completed" or report.get("reason") is not None
            or report.get("diagnostics") or report.get("comparedRuns") != 2
            or not isinstance(report.get("compiler"), dict) or report["compiler"].get("sha256") != compiler
            or not isinstance(artifact, dict) or "/proj/kernel.js" not in artifact
            or not all(isinstance(v, str) and HEX64.match(v) for v in artifact.values())
            or not isinstance(report.get("adapter"), str) or not HEX64.match(report["adapter"])
            or report.get("total") != len(tests) or report.get("passed") != len(tests) or report.get("failed") != []):
        raise ValueError("the route report is not a clean check, two identical runs and a full pass")
    output = report.get("output")
    if not isinstance(output, str) or sha256(output) != report.get("outputSha256"):
        raise ValueError("the recorded output differs from its digest")
    outcomes = json.loads(output)
    if not isinstance(outcomes, list) or len(outcomes) != len(tests) or not all(map(passes, tests, outcomes)):
        raise ValueError("the recorded output does not pass the frozen tests")
    return artifact


def decide(db, ledger, request):
    records, tip = ledger._read(db)
    decision = dict(version=1, issuer=ISSUER, policy=POLICY, lane=LANE, scope="qualification",
                    candidate=request["candidate"], receipt=request["receipt"])
    identity, claimed = request["receipt"]["id"], request["receipt"]["hash"]
    stored = db.execute("SELECT hash FROM records WHERE id=?", (identity,)).fetchone()
    receipt_record = records.get(identity)
    if stored is None or stored[0] != claimed or receipt_record is None or receipt_record["kind"] != "receipt":
        raise ValueError("receipt binding differs")
    data = receipt_record["data"]
    if data["candidate"] != request["candidate"]:
        raise ValueError("receipt is for another candidate")
    frozen, frozen_tests, compiler = frozen_of(records, data["frozen_evaluator"])
    decision.update(frozen_evaluator=frozen["id"], evaluator_digest=frozen["data"]["freeze"]["digest"], compiler=compiler)
    db.execute(DECISIONS)
    prior = db.execute("SELECT body FROM compat_decisions WHERE receipt=?", (identity,)).fetchone()
    if prior is not None:
        return json.loads(prior[0])
    if data["delivery_state"] == "outcome_unknown" and data["outcome_state"] == "inconclusive":
        decision.update(decision="inconclusive", reason="the route did not reach an outcome; nothing was decided about the candidate")
        return sealed(decision)
    artifact = judge(records, request["candidate"], receipt_record, frozen_tests, compiler)
    decision.update(decision="promote", chain_tip=tip, artifact=artifact)
    decision = sealed(decision)
    db.execute("INSERT INTO compat_decisions (receipt, candidate, policy, body) VALUES (?, ?, ?, ?)",
               (identity, request["candidate"], POLICY, json.dumps(decision, sort_keys=True)))
    return decision


def promote(request):
    base = dict(version=1, issuer=ISSUER, policy=POLICY, lane=LANE, scope="qualification",
                candidate=request.get("candidate"), receipt=request.get("receipt"))
    try:
        ledger = Ledger(request["ledger"])
        with closing(sqlite3.connect(ledger.path, timeout=5)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            decision = decide(db, ledger, request)
    except sqlite3.OperationalError:
        decision = sealed(dict(base, decision="inconclusive", reason="the ledger was unavailable; nothing was decided about the candidate"))
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, sqlite3.Error):
        decision = sealed(dict(base, decision="refuse", reason="unverified chain or incomplete compatibility evidence"))
    if request.get("decisionPath"):
        store_decision(decision, request["decisionPath"])
    return decision


ACTIONS = dict(freeze=freeze, register=register, receipt=receipt, promote=promote)


def main(argv):
    if len(argv) != 1 or argv[0] not in ACTIONS:
        print(USAGE, file=sys.stderr)
        return 2
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("the request must be a JSON object")
        print(json.dumps(ACTIONS[argv[0]](request)))
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error) as error:
        print(f"compat_policy {argv[0]} refused: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
