import json
import sys
import time

sys.path.insert(0, ".")
from core.constraints.extract import ModelExtractor, RuleExtractor
from core.constraints.port import Message, Origin
from core.constraints.record import ConstraintRecord
from core.constraints.store import MemoryStore
from run import WORK, call_model, match, run_extractor, score, wilson


def main():
    data = json.load(open(f"{WORK}/dataset.json"))
    labels = json.load(open(f"{WORK}/labels.json"))
    last = json.load(open(f"{WORK}/last.json"))
    rule, _ = run_extractor(RuleExtractor(), data)
    model, _ = run_extractor(ModelExtractor(lambda prompt: call_model("haiku", prompt)), data)
    union = {key: rule.get(key, []) + model.get(key, []) for key in set(rule) | set(model)}
    split = {row["id"]: row["split"] for row in labels}
    report = {"union_B": score(union, labels, ("B",))["standing"]}
    rows = [(index, row) for index, row in enumerate(last["rows"]) if split[row["message"]] == "B"]
    summary = {index: bool(last["present"][str(index)]["present"]) for index, _ in rows}
    for name, found in (("rule", rule), ("model", model), ("union", union)):
        carried = {index: bool(match(found.get(row["message"], []), [row])) for index, row in rows}
        either = sum(summary[index] or carried[index] for index, _ in rows)
        report[name] = dict(pairs=len(rows), summary_only=sum(summary.values()), record_only=sum(carried.values()),
                            summary_or_record=either, ci=wilson(either, len(rows)))
    record = ConstraintRecord(MemoryStore(), RuleExtractor())
    started = time.perf_counter()
    for message in data["label_set"]:
        record.observe(Message(message["id"], Origin.HUMAN, message["text"]))
    observed = time.perf_counter()
    record.cross()
    finished = time.perf_counter()
    report["cost_ms"] = dict(messages=len(data["label_set"]), observe_all=round((observed - started) * 1000, 2),
                             crossing=round((finished - observed) * 1000, 2), crossings=record.store.crossings)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
