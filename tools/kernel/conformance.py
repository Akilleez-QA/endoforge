import hashlib
import json
from pathlib import Path
import sys

from core.ledger.ledger import encode
from tools.kernel.broker import BrokerDenied
from tools.kernel.contract import MAX_COMPONENT_BYTES
from tools.kernel.effects import EffectDenied, declaration
from tools.kernel.journal import DenialJournal


MAX_CASES = 256
CASE_FUEL = 1000000


def _hex(value, field):
    if type(value) is not str:
        raise ValueError(f"{field} must be hex")
    try:
        return bytes.fromhex(value)
    except ValueError:
        raise ValueError(f"{field} must be hex") from None


def task(value):
    if type(value) is not dict or set(value) != {"id", "schemas", "effects", "cases"}:
        raise ValueError("task needs exactly id, schemas, effects and cases")
    schemas = value["schemas"]
    if type(schemas) is not dict or set(schemas) != {"state", "event", "effect"}:
        raise ValueError("task schemas name state, event and effect")
    if any(type(s) is not str or not 1 <= len(s) <= 256 for s in schemas.values()):
        raise ValueError("task schema identities must be bounded strings")
    if declaration(value["effects"])["id"] != schemas["effect"]:
        raise ValueError("task effect declaration differs from its effect schema")
    cases = value["cases"]
    if type(cases) is not list or not 1 <= len(cases) <= MAX_CASES:
        raise ValueError(f"task needs between 1 and {MAX_CASES} cases")
    for case in cases:
        if type(case) is not dict or set(case) != {"name", "state", "event", "inputs", "expect"}:
            raise ValueError("each case needs name, state, event, inputs and expect")
        _hex(case["state"], "state")
        _hex(case["event"], "event")
        if type(case["inputs"]) is not list:
            raise ValueError("case inputs must be a list")
        for item in case["inputs"]:
            _hex(item, "input")
        expect = case["expect"]
        if type(expect) is not dict or set(expect) != {"state", "effects"} or type(expect["effects"]) is not list:
            raise ValueError("case expect needs state and effects")
        _hex(expect["state"], "expected state")
        for effect in expect["effects"]:
            if type(effect) is not dict or set(effect) != {"capability", "operation", "payload"}:
                raise ValueError("expected effects need capability, operation and payload")
            _hex(effect["payload"], "expected payload")
    if len({case["name"] for case in cases}) != len(cases):
        raise ValueError("case names must be unique")
    return value


def task_sha256(value):
    return hashlib.sha256(encode(value).encode("ascii")).hexdigest()


def check(component, value, journal=None):
    from wasmtime import WasmtimeError
    from tools.kernel.workcell import Workcell

    value = task(value)
    schemas = value["schemas"]
    report = {"task": value["id"], "task_sha256": task_sha256(value), "cases": [], "passed": False}
    try:
        cell = Workcell(component, (schemas["state"], schemas["event"], schemas["effect"]),
                        effects=value["effects"], journal=journal)
    except ValueError as error:
        report["refused"] = str(error)[-512:]
        return report
    report["artifact"] = cell.artifact
    report["effect_declaration_sha256"] = cell.effects["sha256"]
    for case in value["cases"]:
        row = {"name": case["name"]}
        try:
            result = cell.run(bytes.fromhex(case["state"]), bytes.fromhex(case["event"]),
                              [bytes.fromhex(item) for item in case["inputs"]], fuel=CASE_FUEL)
            actual = {"state": result["state"].hex(),
                      "effects": [{**effect, "payload": effect["payload"].hex()} for effect in result["effects"]]}
            row["outcome"] = "passed" if actual == case["expect"] else "wrong"
            if row["outcome"] == "wrong":
                row["actual"] = actual
        except EffectDenied as error:
            row.update(outcome="denied", denials=error.denials)
        except BrokerDenied as error:
            row.update(outcome="denied", denials=error.report["denials"])
        except WasmtimeError as error:
            row.update(outcome="trapped", error=str(error)[-256:])
        except ValueError as error:
            row.update(outcome="refused", error=str(error)[-256:])
        report["cases"].append(row)
    report["passed"] = all(row["outcome"] == "passed" for row in report["cases"])
    return report


def main():
    request = json.loads(sys.stdin.buffer.read(4 * 1024 * 1024))
    with Path(request["component"]).open("rb") as source:
        component = source.read(MAX_COMPONENT_BYTES + 1)
    journal = None if request.get("journal") is None else DenialJournal(request["journal"])
    print(encode(check(component, request["task"], journal)))


if __name__ == "__main__":
    main()
