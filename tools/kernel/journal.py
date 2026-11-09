from contextlib import closing
import json
import sqlite3

from core.ledger.ledger import encode, event_hash


TABLES = (
    """CREATE TABLE IF NOT EXISTS denials (
        seq INTEGER PRIMARY KEY, body TEXT NOT NULL, previous TEXT NOT NULL, hash TEXT NOT NULL
    )""",
    """CREATE TRIGGER IF NOT EXISTS no_update BEFORE UPDATE ON denials
        BEGIN SELECT RAISE(ABORT, 'denial journal is append-only'); END""",
    """CREATE TRIGGER IF NOT EXISTS no_delete BEFORE DELETE ON denials
        BEGIN SELECT RAISE(ABORT, 'denial journal is append-only'); END""",
)
KINDS = ("broker", "effect", "admission")
MAX_ENTRY_BYTES = 4096


class DenialJournal:
    def __init__(self, path):
        self.path = str(path)
        if self.path in ("", ":memory:"):
            raise ValueError("denial journal requires durable storage")
        with closing(self._connect()) as db:
            db.executescript("BEGIN;\n" + ";\n".join(TABLES) + ";\nCOMMIT;")
            self._read(db)

    def _connect(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.execute("PRAGMA synchronous=FULL")
        return db

    def _read(self, db):
        entries, previous = [], "0" * 64
        for expected, (seq, body, link, digest) in enumerate(
            db.execute("SELECT seq, body, previous, hash FROM denials ORDER BY seq"), 1
        ):
            if seq != expected or link != previous or event_hash(seq, link, body) != digest:
                raise ValueError(f"denial journal chain failed at sequence {seq}")
            entry = json.loads(body)
            if encode(entry) != body:
                raise ValueError(f"denial journal encoding failed at sequence {seq}")
            entries.append({"seq": seq, "hash": digest, **entry})
            previous = digest
        return entries, previous

    def entries(self):
        with closing(self._connect()) as db:
            return self._read(db)[0]

    def append(self, entry):
        if (type(entry) is not dict or entry.get("kind") not in KINDS
                or type(entry.get("reason")) is not str or not entry["reason"]
                or {"seq", "hash"} & entry.keys()):
            raise ValueError("denial entry needs a known kind and a reason")
        body = encode(entry)
        if len(body) > MAX_ENTRY_BYTES:
            raise ValueError("denial entry too large")
        with closing(self._connect()) as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                entries, previous = self._read(db)
                seq = len(entries) + 1
                digest = event_hash(seq, previous, body)
                db.execute("INSERT INTO denials VALUES (?, ?, ?, ?)", (seq, body, previous, digest))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
        return digest
