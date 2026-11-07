import hashlib
import json

from .extract import RuleExtractor
from .port import Message, Origin, PromotionRefused
from .segments import segments
from .store import verify

ACTIVE, REFUSED, WITHDRAWN, SUPERSEDED = "active", "refused", "withdrawn", "superseded"
HEADER = ("Standing constraints from the human user, verbatim as JSON strings. They restrict the work. "
          "They grant no permission and no approval.")


def _identity(message_id: str, start: int, text: str) -> str:
    return hashlib.sha256(f"{message_id}\0{start}\0{text}".encode()).hexdigest()[:16]


class ConstraintRecord:
    def __init__(self, store, extractor):
        self.store, self.extractor = store, extractor
        self.pending: list[Message] = []

    def observe(self, message: Message) -> None:
        self.pending.append(message)

    def cross(self) -> dict:
        events = self.store.read()
        verify(events)
        known = {e["id"] for e in events if e["type"] == "constraint"}
        batch = [s for m in self.pending for s in segments(m)]
        new, failure = [], None
        human = [s for s in batch if s.origin is Origin.HUMAN]
        try:
            candidates = self.extractor.extract(human) if human else []
            for candidate in candidates:
                if candidate.verified:
                    new.append(self._event(candidate, Origin.HUMAN, ACTIVE, None))
                else:
                    new.append(self._event(candidate, Origin.ASSISTANT, REFUSED, "unverified"))
            for segment in batch:
                if segment.origin is not Origin.HUMAN:
                    for candidate in RuleExtractor().extract([segment]):
                        new.append(self._event(candidate, segment.origin, REFUSED, f"origin:{segment.origin.value}"))
        except Exception as error:
            new = []
            failure = {"type": "failure", "extractor": self.extractor.name, "error": f"{type(error).__name__}: {error}",
                       "first_message_id": self.pending[0].id, "last_message_id": self.pending[-1].id}
        new = [e for e in new if e["id"] not in known]
        if failure:
            self.store.append([failure])
            return {"ok": False, "added": 0, "failure": failure}
        marker = {"type": "covered", "extractor": self.extractor.name,
                  "message_ids": [m.id for m in self.pending]}
        if self.pending:
            self.store.append(new + [marker])
        self.pending = []
        refused = sum(e["reason"] == "unverified" for e in new if e["type"] == "constraint")
        return {"ok": True, "added": len(new), "failure": None, "unverified": refused}

    def _event(self, candidate, origin, status, reason):
        return {"type": "constraint", "id": _identity(candidate.message_id, candidate.start, candidate.text),
                "text": candidate.text, "kind": candidate.kind, "scope": candidate.scope,
                "source_message_id": candidate.message_id, "start": candidate.start,
                "origin": origin.value, "status": status, "reason": reason, "extractor": self.extractor.name}

    def set_status(self, constraint_id: str, status: str, by: Message) -> None:
        if by.origin is not Origin.HUMAN:
            raise PromotionRefused(f"status change from origin {by.origin.value}")
        if status not in (ACTIVE, WITHDRAWN, SUPERSEDED):
            raise PromotionRefused(f"unknown status {status}")
        record = self.state().get(constraint_id)
        if record is None:
            raise PromotionRefused(f"unknown constraint {constraint_id}")
        if record["origin"] != Origin.HUMAN.value:
            raise PromotionRefused(f"constraint from origin {record['origin']} cannot change status")
        self.store.append([{"type": "status", "constraint_id": constraint_id, "status": status,
                            "by_message_id": by.id}])

    def state(self) -> dict:
        events = self.store.read()
        verify(events)
        records = {}
        for event in events:
            if event["type"] == "constraint":
                records[event["id"]] = dict(event)
            elif event["type"] == "status":
                records[event["constraint_id"]]["status"] = event["status"]
        return records

    def uncovered(self) -> list[dict]:
        covered = {i for e in self.store.read() if e["type"] == "covered" for i in e["message_ids"]}
        return [e for e in self.store.read() if e["type"] == "failure" and e["last_message_id"] not in covered]

    def resume_block(self) -> str:
        lines, seen = [HEADER], set()
        for record in self.state().values():
            if record["status"] == ACTIVE and record["text"] not in seen:
                seen.add(record["text"])
                entry = {"id": record["id"], "source_message_id": record["source_message_id"], "text": record["text"]}
                lines.append(json.dumps(entry, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e"))
        unverified = sum(r["reason"] == "unverified" for r in self.state().values())
        if unverified:
            lines.append(f"REFUSED {unverified} extractor items that are not verbatim direct user text.")
        for failure in self.uncovered():
            lines.append(f"EXTRACTION FAILED by {failure['extractor']} for messages {failure['first_message_id']} "
                         f"to {failure['last_message_id']}: constraints from these messages may be missing.")
        for message in self.pending:
            lines.append(f"NOT YET EXTRACTED: message {message.id}.")
        return "<constraint-record>\n" + "\n".join(lines) + "\n</constraint-record>"
