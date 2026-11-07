import hashlib
import json
from pathlib import Path


FAMILIES = {
    "swapped_units": {"path", "other"},
    "dropped_rows": {"path", "index"},
    "off_by_one": {"path", "delta"},
    "reversed_inputs": {"path", "other"},
    "stale_binding": {"path", "stale"},
}
MAX_EVALUATIONS = 100_000
GENERATOR_DIGEST = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def canonical(value):
    if type(value) is dict:
        if any(type(key) is not str for key in value):
            raise ValueError("JSON object keys must be strings")
        for child in value.values():
            canonical(child)
    elif type(value) is list:
        for child in value:
            canonical(child)
    elif type(value) not in (str, int, float, bool, type(None)):
        raise ValueError("plain JSON values required")
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("ascii")).hexdigest()


def clone(value):
    return json.loads(canonical(value))


def validate(spec):
    if type(spec) is not dict or type(spec.get("family")) is not str:
        raise ValueError("fault requires a family")
    family = spec["family"]
    if family not in FAMILIES or set(spec) != {"family"} | FAMILIES[family]:
        raise ValueError("unknown family or invalid fault fields")
    for name in ("path", "other"):
        if name not in spec:
            continue
        path = spec[name]
        if type(path) is not list or not path or any(
                type(key) not in (str, int) or type(key) is int and key < 0 for key in path):
            raise ValueError("paths require nonempty lists of keys or nonnegative indices")
    if "other" in spec:
        left, right = spec["path"], spec["other"]
        if left == right[:len(left)] or right == left[:len(right)]:
            raise ValueError("swap paths must be disjoint")
    if family == "dropped_rows" and (type(spec["index"]) is not int or spec["index"] < 0):
        raise ValueError("row index must be a nonnegative integer")
    if family == "off_by_one" and (type(spec["delta"]) is not int or spec["delta"] not in (-1, 1)):
        raise ValueError("off-by-one delta must be -1 or 1")
    if family == "stale_binding" and (type(spec["stale"]) is not str or not spec["stale"]):
        raise ValueError("stale binding must name a revision")


def slot(value, path):
    for key in path:
        parent = value
        if not ((type(parent) is dict and type(key) is str and key in parent)
                or (type(parent) is list and type(key) is int and 0 <= key < len(parent))):
            raise ValueError("fault path does not resolve")
        value = parent[key]
    return parent, key, value


def mutate(value, spec):
    parent, key, current = slot(value, spec["path"])
    family = spec["family"]
    if family in ("swapped_units", "reversed_inputs"):
        other_parent, other_key, other = slot(value, spec["other"])
        if family == "swapped_units" and not (type(current) is str and type(other) is str):
            raise ValueError("units must be strings")
        parent[key], other_parent[other_key] = other, current
    elif family == "dropped_rows":
        if type(current) is not list:
            raise ValueError("rows must be a list")
        if spec["index"] < len(current):
            current.pop(spec["index"])
    elif family == "off_by_one":
        if type(current) is not int:
            raise ValueError("off-by-one target must be an integer")
        parent[key] += spec["delta"]
    else:
        if type(current) is not str or not current:
            raise ValueError("binding must name a revision")
        parent[key] = spec["stale"]
    return value


def run_candidate(known_good, spec, value):
    validate(spec)
    value = clone(value)
    if spec["family"] == "reversed_inputs":
        return clone(known_good(mutate(value, spec)))
    return mutate(clone(known_good(value)), spec)


def generate(known_good, *, anchor_id, inputs, faults, seed):
    if type(seed) is not int or type(anchor_id) is not str or not anchor_id:
        raise ValueError("integer seed and frozen anchor identity required")
    inputs, faults = clone(inputs), clone(faults)
    if type(inputs) is not list or not inputs or type(faults) is not list or not faults:
        raise ValueError("nonempty extended input set and fault list required")
    if 2 * len(inputs) * (1 + len(faults)) > MAX_EVALUATIONS:
        raise ValueError("differential evaluation budget exceeded")
    for spec in faults:
        validate(spec)
    if len({digest(spec) for spec in faults}) != len(faults):
        raise ValueError("duplicate fault specifications")
    expected = []
    for value in inputs:
        first = clone(known_good(clone(value)))
        if canonical(first) != canonical(known_good(clone(value))):
            raise ValueError("known-good implementation is nondeterministic")
        expected.append(first)
    context = dict(generator_digest=GENERATOR_DIGEST, seed=seed, anchor_id=anchor_id,
                   inputs_digest=digest(inputs), anchor_outputs_digest=digest(expected))
    emitted, filtered = [], []
    for spec in sorted(faults, key=lambda item: digest([seed, item])):
        record = dict(id=digest([context, spec]), stratum="S2", fault=spec)
        witness = None
        for index, value in enumerate(inputs):
            actual = run_candidate(known_good, spec, value)
            if canonical(actual) != canonical(run_candidate(known_good, spec, value)):
                raise ValueError("mutant implementation is nondeterministic")
            if witness is None and canonical(actual) != canonical(expected[index]):
                witness = dict(input_index=index, input=value, expected=expected[index], actual=actual)
        if witness is None:
            filtered.append(record | {"reason": "equivalent_on_extended_set"})
        else:
            emitted.append(record | {"witness": witness})
    return context | dict(faults=emitted, filtered=filtered, strata={"S2": dict(
        proposed=len(faults), emitted=len(emitted), equivalent=len(filtered),
        equivalent_fraction=len(filtered) / len(faults))})
