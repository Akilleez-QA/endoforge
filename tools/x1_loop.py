import base64
import hashlib
import json
import math
import os
from pathlib import Path

from core.ledger.frozen import digest, frozen_record, snapshot
from core.ledger.ledger import encode

REPOSITORY = Path(__file__).resolve().parents[1]
ROUND_CHECKS = ["schema", "interface", "bounds", "determinism", "forbidden_effects", "residual"]
GATES = {"G1_frozen", "G2_compiles", "G3_exports", "G4_tests", "G5_deterministic", "G6_bounded", "G7_glue", "G8_nonfinite"}
ORACLE_FILES = ("CONTRACT.md", "tests.json", "frozen.sha256")
IMPLEMENTATION_FILES = ("host.mjs", "gates.mjs", "glue.schema.json", "measure.mjs", "meter.mjs", "contract.mjs", "loop-port.mjs", "agent.mjs")


FREEZE_FACTS = dict(confirmed_by="none: frozen by the host with no reviewer",
                    qualification="none: structural test checks only, no qualification receipt",
                    synthesis_context=dict(id="need", candidate_blind="not_established", inputs=["input"]))


def decide(records, tip, stored_hash, request):
    decision = dict(version=1, issuer="endoforge.local.x1", policy="X1-G1-G8/v1", scope="qualification",
                    candidate=request["candidate"], frozen_evaluator=request["reference"]["identity"],
                    receipt=request["receipt"])
    try:
        candidate, receipt = records[request["candidate"]], records[request["receipt"]["id"]]
        data = receipt["data"]
        if (data["outcome_state"] == "inconclusive" and data["delivery_state"] == "outcome_unknown"
                and candidate["kind"] == "candidate" and receipt["kind"] == "receipt"
                and stored_hash == request["receipt"]["hash"] and data["candidate"] == candidate["id"]
                and data["frozen_evaluator"] == request["reference"]["identity"]):
            decision.update(decision="inconclusive", reason="the evaluation did not reach an outcome; nothing was decided about the candidate")
            return sealed(decision)
        if (candidate["kind"] != "candidate"
                or hashlib.sha256(candidate["data"]["content"].encode()).hexdigest() != candidate["id"]
                or receipt["kind"] != "receipt" or stored_hash != request["receipt"]["hash"]
                or data["candidate"] != candidate["id"] or data["frozen_evaluator"] != request["reference"]["identity"]
                or data["delivery_state"] != "finished" or data["outcome_state"] != "passed"):
            raise ValueError("candidate or passing receipt binding differs")
        observation, = data["observations"]
        report = observation["report"]
        attempts = report["attempts"]
        if (observation["status"] != "completed" or report["stage"] != "completed"
                or report["frontier"] != [candidate["id"]] or len(attempts) != 2
                or report["frozen_evaluator"] != data["frozen_evaluator"]
                or report["evaluator_digest"] != data["precommit"]["oracle_version"]):
            raise ValueError("complete pool finalist evidence required")
        for round_number, attempt in enumerate(attempts):
            if (attempt["candidate"] != candidate["id"] or attempt["round"] != round_number
                    or attempt["stage"] != "passed" or attempt["firstFailure"] is not None
                    or attempt["frozen_evaluator"] != data["frozen_evaluator"]
                    or attempt["evaluator_digest"] != report["evaluator_digest"]
                    or [x["check"] for x in attempt["results"]] != ROUND_CHECKS
                    or not all(check["passed"] is True for check in attempt["results"])):
                raise ValueError("failed or incomplete evaluator round")
            residual, = [check for check in attempt["results"] if check["check"] == "residual"]
            x1 = json.loads(residual["reason"])
            if (x1["promotable"] is not True or set(x1["gates"]) != GATES
                    or not all(g["ok"] is True for g in x1["gates"].values())):
                raise ValueError("all seven gates must pass")
        decision.update(decision="promote", chain_tip=tip, evaluator_digest=report["evaluator_digest"])
    except (ValueError, KeyError, TypeError):
        return refusal(decision)
    return sealed(decision)


def refusal(decision):
    decision.update(decision="refuse", reason="unverified chain or incomplete passing pool evidence")
    return sealed(decision)


def sealed(decision):
    decision["sha256"] = hashlib.sha256(json.dumps(decision, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return decision


def store_decision(decision, path):
    with Path(path).open("x") as output:
        json.dump(decision, output, sort_keys=True)
        output.flush()
        os.fsync(output.fileno())
    directory = os.open(Path(path).parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def write_decision(result):
    if isinstance(result, dict) and "decisionPath" in result:
        store_decision(result["decision"], result.pop("decisionPath"))


def durable_promotion(record, prior, db):
    db.execute(DECISIONS)
    for receipt, candidate, body in db.execute("SELECT receipt, candidate, body FROM x1_decisions ORDER BY rowid"):
        stored = db.execute("SELECT hash FROM records WHERE id=?", (receipt,)).fetchone()
        decision = json.loads(body)
        if stored is None or decision["decision"] != "promote":
            continue
        checked = decide(prior, stored[0], stored[0], dict(reference=dict(identity=record["id"]), candidate=candidate,
                                                           receipt=dict(id=receipt, hash=stored[0])))
        if checked["decision"] == "promote":
            return decision
    return None


def admit(request, prior, append, _process, db):
    reference, payload = request["job"]["reference"], request["result"]
    if payload.get("resume"):
        frozen = [r for r in prior.values() if r["kind"] == "frozen_evaluator" and "freeze" in r["data"]]
        if not frozen:
            return dict(fresh=True)
        record = frozen[-1]
        if payload.get("need") is not None and prior["task"]["data"]["intent"] != payload["need"]:
            raise ValueError("need differs from the task in this ledger")
        if frozen_drift(record, reference.get("root")):
            raise ValueError("running evaluator tree digest differs from frozen record")
    elif "identity" not in reference:
        need = payload["need"]
        append(dict(version=0, kind="task", id="task", data=dict(intent=need, acceptance="X1 G1-G7")))
        append(dict(version=0, kind="admitted_input", id="input", data=dict(task="task", content=need, origin="caller")))
        record = frozen_record(reference.get("root"), files=payload.get("files"), task="task", admitted_input="input",
                               **FREEZE_FACTS, configuration=payload["configuration"], residual="X1 G1-G7", invariant_version="1")
        append(record)
    else:
        record = prior.get(reference["identity"])
        if record is None or record["kind"] != "frozen_evaluator" or "freeze" not in record["data"]:
            raise ValueError("content-hashed frozen evaluator required")
        if frozen_drift(record, reference.get("root")):
            raise ValueError("running evaluator tree digest differs from frozen record")
    return dict(identity=record["id"], digest=record["data"]["freeze"]["digest"], encoded=encode(record["data"]),
                decision=durable_promotion(record, prior, db))


DECISIONS = "CREATE TABLE IF NOT EXISTS x1_decisions (receipt TEXT PRIMARY KEY, candidate TEXT NOT NULL, body TEXT NOT NULL)"


def frozen_drift(record, root):
    stored = json.loads(record["data"]["content"])
    if root is not None:
        try:
            content = snapshot(root, stored["configuration"], stored["residual"], stored["invariant_version"])
        except (OSError, ValueError):
            return True
        if digest(content) != record["data"]["freeze"]["digest"]:
            return True
    return any(name in stored["files"] and (REPOSITORY / "core/runtime/x1" / name).read_bytes().hex() != stored["files"][name]
               for name in IMPLEMENTATION_FILES)


def value_meets(frozen, seen):
    got = seen.get("got")
    if frozen.get("expectError"):
        return isinstance(got, str) and seen.get("trap") is True
    expect = frozen.get("expect")
    if isinstance(expect, bool):
        return bool(got) == expect or got == (1 if expect else 0)
    if isinstance(expect, (int, float)):
        if isinstance(got, bool) or not isinstance(got, (int, float, str)):
            return False
        try:
            value = float(got)
        except ValueError:
            return False
        tolerance = frozen.get("tol")
        if isinstance(tolerance, (int, float)) and not isinstance(tolerance, bool) and math.isfinite(tolerance):
            return abs(value - expect) <= tolerance
        return value == expect
    return str(got) == str(expect)


def report_problem(record, candidate, result, sources):
    bundle = json.loads(record["data"]["content"])
    for name in ORACLE_FILES:
        if candidate["files"][name].encode().hex() != bundle["files"][name]:
            return "candidate oracle files differ from the frozen bundle"
    kernel = candidate["files"]["kernel.ts"]
    if candidate["compiled"].get("source") != hashlib.sha256(kernel.encode()).hexdigest():
        return "compile binding differs from the candidate source"
    if sources is not None and any(hashlib.sha256(candidate["files"][name].encode()).hexdigest() != sources[name] for name in sources):
        return "candidate differs from the submitted source"
    report = result["report"]
    if report["frozen_evaluator"] != record["id"] or report["evaluator_digest"] != record["data"]["freeze"]["digest"]:
        return "report binds a different frozen evaluator"
    tests = json.loads(bytes.fromhex(bundle["files"]["tests.json"]))
    wasm = candidate["compiled"].get("wasm")
    wasm_digest = wasm and hashlib.sha256(base64.b64decode(wasm)).hexdigest()
    for attempt in report["attempts"]:
        if attempt["stage"] != "passed":
            continue
        if attempt["frozen_evaluator"] != record["id"] or attempt["evaluator_digest"] != record["data"]["freeze"]["digest"]:
            return "attempt binds a different frozen evaluator"
        residual, = [check for check in attempt["results"] if check["check"] == "residual"]
        x1 = json.loads(residual["reason"])
        if x1["gates"]["G2_compiles"]["wasmSha256"] != wasm_digest:
            return "gate evidence names a different module"
        if len(x1["tests"]) != len(tests):
            return "report does not cover the frozen tests"
        for frozen, seen in zip(tests, x1["tests"]):
            if (seen["fn"] != frozen["fn"] or seen["args"] != frozen["args"] or seen["pass"] is not True
                    or not value_meets(frozen, seen)):
                return "reported test result does not meet the frozen test"
    return None


def evidence_problem(record, root, content, result, sources):
    if result.get("status") == "outcome_unknown":
        return None
    if frozen_drift(record, root):
        return "frozen_drift"
    if result.get("status") != "completed":
        return None
    try:
        return report_problem(record, json.loads(content), result, sources)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        return f"invalid report evidence: {type(error).__name__}"


def commit(request, prior, append, process, db):
    job, payload = request["job"], request["result"]
    content, result = payload["content"], dict(payload["result"])
    identity = hashlib.sha256(content.encode()).hexdigest()
    reference = job["reference"]
    if job["candidates"] != [identity]:
        raise ValueError("candidate identity differs from its content")
    record = prior.get(reference["identity"])
    if record is None or record["kind"] != "frozen_evaluator" or "freeze" not in record["data"]:
        raise ValueError("content-hashed frozen evaluator required")
    if identity not in prior:
        append(dict(version=0, kind="candidate", id=identity,
                    data=dict(task="task", admitted_input="input", content=content, proposer="configured generator")))
    if payload.get("nextReceipt"):
        attempt = 1 + sum(1 for r in prior.values() if r["kind"] == "receipt")
        job["receipts"][0]["id"] = "receipt" if attempt == 1 else f"receipt-{attempt}"
    problem = evidence_problem(record, reference.get("root"), content, result, payload.get("sources"))
    if problem:
        result.update(status="rejected", reason=problem)
    receipts = process(dict(action="append", job=job, result=result), prior, append)
    written = receipts[0]
    decision = decide(prior, written["hash"], written["hash"],
                      dict(reference=reference, candidate=identity, receipt=dict(id=written["record"]["id"], hash=written["hash"])))
    answer = dict(receipts=receipts, decision=decision, problem=problem)
    if payload.get("decisionPath"):
        answer["decisionPath"] = payload["decisionPath"]
    db.execute(DECISIONS)
    db.execute("INSERT INTO x1_decisions (receipt, candidate, body) VALUES (?, ?, ?)",
               (written["record"]["id"], identity, json.dumps(decision, sort_keys=True)))
    return answer


LOOP = dict(admit=admit, commit=commit)
