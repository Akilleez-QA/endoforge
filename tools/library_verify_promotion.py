import hashlib
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

from core.ledger.ledger import Ledger

GATES = {"G1_frozen", "G2_compiles", "G3_exports", "G4_tests", "G5_deterministic", "G6_bounded", "G7_glue", "G8_nonfinite"}
CHECKS = ["schema", "interface", "bounds", "determinism", "forbidden_effects", "residual"]


def sha(text):
    return hashlib.sha256(text if isinstance(text, bytes) else text.encode()).hexdigest()


def refuse(condition, why):
    if condition:
        raise ValueError(why)


def verify(ledger_path, promotion_path):
    decision = json.loads(Path(promotion_path).read_text())
    claimed = decision.pop("sha256", None)
    refuse(sha(json.dumps(decision, sort_keys=True, separators=(",", ":"))) != claimed, "decision hash differs")
    refuse(decision.get("decision") != "promote", "decision is not promote")
    refuse(decision.get("scope") != "qualification", "decision scope differs")
    reader = Ledger.__new__(Ledger)
    with closing(sqlite3.connect(f"file:{ledger_path}?mode=ro", uri=True)) as db:
        records, _ = reader._read(db)
        hashes = {row[0]: row[1] for row in db.execute("SELECT id, hash FROM records")}
    refuse(decision["chain_tip"] not in hashes.values(), "chain tip is not in the ledger")
    candidate = records[decision["candidate"]]
    receipt = records[decision["receipt"]["id"]]
    evaluator = records[decision["frozen_evaluator"]]
    refuse(candidate["kind"] != "candidate" or sha(candidate["data"]["content"]) != candidate["id"], "candidate hash differs")
    refuse(receipt["kind"] != "receipt" or hashes[receipt["id"]] != decision["receipt"]["hash"], "receipt hash differs")
    data = receipt["data"]
    refuse(data["candidate"] != candidate["id"] or data["frozen_evaluator"] != evaluator["id"], "receipt binding differs")
    refuse(data["delivery_state"] != "finished" or data["outcome_state"] != "passed", "receipt did not pass")
    refuse(evaluator["kind"] != "frozen_evaluator", "frozen evaluator missing")
    digest = evaluator["data"]["freeze"]["digest"]
    refuse(digest != decision["evaluator_digest"] or digest != sha(evaluator["data"]["content"]), "evaluator digest differs")
    observation, = data["observations"]
    report = observation["report"]
    refuse(observation["status"] != "completed" or report["stage"] != "completed", "pool evidence incomplete")
    refuse(report["frontier"] != [candidate["id"]] or len(report["attempts"]) != 2, "pool evidence incomplete")
    for attempt in report["attempts"]:
        refuse(attempt["stage"] != "passed" or attempt["candidate"] != candidate["id"], "failed evaluator round")
        refuse([x["check"] for x in attempt["results"]] != CHECKS or not all(x["passed"] is True for x in attempt["results"]), "failed evaluator round")
        residual = next(x for x in attempt["results"] if x["check"] == "residual")
        x1 = json.loads(residual["reason"])
        refuse(x1["promotable"] is not True or set(x1["gates"]) != GATES or not all(g["ok"] is True for g in x1["gates"].values()), "gates did not all pass")
    content = json.loads(candidate["data"]["content"])
    frozen = json.loads(evaluator["data"]["content"])["files"]
    for name in ("CONTRACT.md", "tests.json", "frozen.sha256"):
        refuse(bytes.fromhex(frozen[name]).decode() != content["files"][name], "frozen evaluator and candidate differ")
    return dict(decision=claimed, candidate=candidate["id"], content=candidate["data"]["content"],
                frozenEvaluator=evaluator["id"], evaluatorDigest=digest, chainTip=decision["chain_tip"],
                receipt=decision["receipt"]["hash"], gates=sha(bytes.fromhex(frozen["gates.mjs"])), host=sha(bytes.fromhex(frozen["host.mjs"])))


def main():
    for row in json.load(sys.stdin):
        try:
            print(json.dumps(dict(ok=True, **verify(row["ledger"], row["promotion"]))))
        except (ValueError, KeyError, TypeError, IndexError, StopIteration, OSError, sqlite3.Error) as error:
            print(json.dumps(dict(ok=False, reason=f"{type(error).__name__}: {error}")))


if __name__ == "__main__":
    main()
