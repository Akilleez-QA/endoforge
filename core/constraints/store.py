import hashlib
import json

from .port import RecordCorrupt


def _digest(event: dict) -> str:
    body = {k: v for k, v in event.items() if k != "hash"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def chain(events: list[dict], prior: str) -> list[dict]:
    linked = []
    for event in events:
        item = dict(event, prev=prior)
        item["hash"] = prior = _digest(item)
        linked.append(item)
    return linked


def verify(events: list[dict]) -> None:
    prior = ""
    for index, event in enumerate(events):
        if event.get("prev") != prior or event.get("hash") != _digest(event):
            raise RecordCorrupt(f"constraint record chain breaks at event {index}")
        prior = event["hash"]


class MemoryStore:
    def __init__(self):
        self.events, self.crossings = [], 0

    def read(self):
        return list(self.events)

    def append(self, events):
        self.crossings += 1
        self.events.extend(chain(events, self.events[-1]["hash"] if self.events else ""))
