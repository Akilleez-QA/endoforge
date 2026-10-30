from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3


SCHEMA = json.loads(Path(__file__).with_name("record.schema.json").read_text())
TYPES = {"object": dict, "array": list, "string": str, "integer": int}
REFERENCES = {"task", "admitted_input", "candidate", "frozen_evaluator"}


def conforms(value, schema):
    if "$ref" in schema:
        return conforms(value, SCHEMA["$defs"][schema["$ref"].split("/")[-1]])
    if "type" in schema and type(value) is not TYPES[schema["type"]]:
        return False
    if "enum" in schema and value not in schema["enum"]:
        return False
    if "minLength" in schema and len(value) < schema["minLength"]:
        return False
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        if not set(schema.get("required", [])).issubset(value):
            return False
        if schema.get("additionalProperties") is False and value.keys() - properties.keys():
            return False
        if any(not conforms(value[k], s) for k, s in properties.items() if k in value):
            return False
    if "items" in schema and any(not conforms(v, schema["items"]) for v in value):
        return False
    return "oneOf" not in schema or sum(conforms(value, s) for s in schema["oneOf"]) == 1


def encode(record):
    return json.dumps(record, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def event_hash(seq, previous, body):
    return hashlib.sha256(f"{seq}:{previous}:{body}".encode("ascii")).hexdigest()


def validate(record, prior):
    if not conforms(record, SCHEMA):
        raise ValueError("record does not conform to Ledger v0 schema")
    if record["id"] in prior:
        raise ValueError("record identity already exists; rewrites are forbidden")
    data = record["data"]
    for field in REFERENCES & data.keys():
        target = prior.get(data[field])
        if target is None or target["kind"] != field:
            raise ValueError(f"{field} must reference an already durable {field} record")
        if field != "task" and target["data"]["task"] != data["task"]:
            raise ValueError(f"{field} belongs to a different task")
    if record["kind"] == "receipt":
        candidate = prior[data["candidate"]]["data"]
        evaluator = prior[data["frozen_evaluator"]]["data"]
        if candidate["admitted_input"] != evaluator["admitted_input"]:
            raise ValueError("candidate and evaluator must use the same admitted input")
        if data["precommit"]["artifact_identity"] != data["candidate"]:
            raise ValueError("precommit must identify the candidate")
        if data["precommit"]["oracle"] != data["frozen_evaluator"]:
            raise ValueError("precommit must identify the frozen evaluator")
        if data["outcome_state"] != "unobserved" and not data["observations"]:
            raise ValueError("an outcome requires observations")


class Ledger:
    def __init__(self, path):
        self.path = str(path)
        if self.path in ("", ":memory:"):
            raise ValueError("ledger requires durable storage")
        with closing(self._connect()) as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS records (
                    seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL,
                    body TEXT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL
                );
                CREATE TRIGGER IF NOT EXISTS no_update BEFORE UPDATE ON records
                    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS no_delete BEFORE DELETE ON records
                    BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
                CREATE TRIGGER IF NOT EXISTS no_replace BEFORE INSERT ON records
                    WHEN EXISTS (SELECT 1 FROM records WHERE id = NEW.id OR seq = NEW.seq)
                    BEGIN SELECT RAISE(ABORT, 'ledger identity already exists'); END;
            """)
            self._read(db)

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.execute("PRAGMA synchronous=FULL")
        return db

    def _read(self, db):
        prior, previous = {}, "0" * 64
        for expected, (seq, identity, body, link, digest) in enumerate(
            db.execute("SELECT seq, id, body, previous, hash FROM records ORDER BY seq"), 1
        ):
            if seq != expected or link != previous or event_hash(seq, link, body) != digest:
                raise ValueError(f"ledger chain failed at sequence {seq}")
            record = json.loads(body)
            if record["id"] != identity or encode(record) != body:
                raise ValueError(f"ledger identity or encoding failed at sequence {seq}")
            validate(record, prior)
            prior[identity], previous = record, digest
        return prior, previous

    def records(self):
        with closing(self._connect()) as db:
            return list(self._read(db)[0].values())

    def append(self, record):
        body = encode(record)
        record = json.loads(body)
        with closing(self._connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            prior, previous = self._read(db)
            validate(record, prior)
            seq = len(prior) + 1
            digest = event_hash(seq, previous, body)
            db.execute("INSERT INTO records VALUES (?, ?, ?, ?, ?)",
                       (seq, record["id"], body, previous, digest))
        return digest
