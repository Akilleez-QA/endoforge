import hashlib
import json

from core.ledger.ledger import conforms, encode


MAX_EFFECTS = 64
MAX_PAYLOAD = 1024 * 1024
ENCODINGS = ("bytes", "utf8", "json")
SPEC_KEYS = {"encoding", "min_bytes", "max_bytes", "schema"}


class EffectDenied(PermissionError):
    def __init__(self, denials):
        self.denials = [dict(entry) for entry in denials]
        super().__init__(self.denials[0]["reason"])


def _no_refs(value):
    if isinstance(value, dict):
        return "$ref" not in value and all(_no_refs(item) for item in value.values())
    if isinstance(value, list):
        return all(_no_refs(item) for item in value)
    return True


def _name(value):
    return type(value) is str and 1 <= len(value) <= 64 and value.isprintable()


def declaration(value):
    if type(value) is not dict or not value.keys() <= {"id", "max_effects", "effects"}:
        raise ValueError("effect declaration needs id, effects and optional max_effects")
    if type(value.get("id")) is not str or not 1 <= len(value["id"]) <= 256:
        raise ValueError("effect declaration id must be the frozen effect-schema identity")
    limit = value.get("max_effects", MAX_EFFECTS)
    if type(limit) is not int or not 0 <= limit <= MAX_EFFECTS:
        raise ValueError(f"max_effects must be between 0 and {MAX_EFFECTS}")
    effects = value.get("effects")
    if type(effects) is not list or len(effects) > MAX_EFFECTS:
        raise ValueError("effects must be a list of declared effects")
    permitted = {}
    for effect in effects:
        if type(effect) is not dict or set(effect) != {"capability", "operation", "payload"}:
            raise ValueError("each effect declares capability, operation and payload")
        key = (effect["capability"], effect["operation"])
        if not all(map(_name, key)) or key in permitted:
            raise ValueError("effect names must be short, printable and unique")
        spec = effect["payload"]
        if type(spec) is not dict or not spec.keys() <= SPEC_KEYS or spec.get("encoding") not in ENCODINGS:
            raise ValueError(f"payload encoding must be one of {', '.join(ENCODINGS)}")
        low, high = spec.get("min_bytes", 0), spec.get("max_bytes", MAX_PAYLOAD)
        if any(type(n) is not int for n in (low, high)) or not 0 <= low <= high <= MAX_PAYLOAD:
            raise ValueError("payload byte bounds must satisfy 0 <= min_bytes <= max_bytes <= 1 MiB")
        if "schema" in spec and (spec["encoding"] != "json" or type(spec["schema"]) is not dict
                                 or not _no_refs(spec["schema"])):
            raise ValueError("a payload schema needs json encoding and no $ref")
        permitted[key] = spec
    frozen = {"id": value["id"], "max_effects": limit, "effects": effects}
    return {**frozen, "sha256": hashlib.sha256(encode(frozen).encode("ascii")).hexdigest(),
            "permitted": permitted}


def _reject_constant(name):
    raise ValueError(f"non-finite JSON constant {name}")


def _payload_reason(spec, payload):
    if type(payload) is not bytes:
        return "payload-not-bytes"
    if len(payload) < spec.get("min_bytes", 0):
        return "payload-too-short"
    if len(payload) > spec.get("max_bytes", MAX_PAYLOAD):
        return "payload-too-long"
    if spec["encoding"] == "bytes":
        return None
    try:
        text = payload.decode("utf-8")
    except UnicodeDecodeError:
        return "payload-not-utf8"
    if spec["encoding"] == "utf8":
        return None
    try:
        document = json.loads(text, parse_constant=_reject_constant)
    except ValueError:
        return "payload-not-json"
    if "schema" in spec and not conforms(document, spec["schema"]):
        return "payload-schema-mismatch"
    return None


def check(frozen, effects):
    denials = []
    if len(effects) > frozen["max_effects"]:
        denials.append({"index": frozen["max_effects"], "capability": None, "operation": None,
                        "reason": "too-many-effects"})
    for index, effect in enumerate(effects[:frozen["max_effects"]]):
        key = (effect["capability"], effect["operation"])
        spec = frozen["permitted"].get(key)
        reason = "undeclared-effect" if spec is None else _payload_reason(spec, effect["payload"])
        if reason is not None:
            denials.append({"index": index, "capability": key[0][:64], "operation": key[1][:64],
                            "reason": reason})
    return denials
