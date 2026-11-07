import hashlib
import json
import os

from core.constraints.port import RecordCorrupt


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


class JsonlStore:
    def __init__(self, path):
        self.path = os.fspath(path)

    def read(self):
        if not os.path.exists(self.path):
            return []
        with open(self.path, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        try:
            return [json.loads(line) for line in lines]
        except ValueError as error:
            raise RecordCorrupt(f"constraint record is unreadable: {error}") from error

    def append(self, events):
        current = self.read()
        verify(current)
        linked = chain(events, current[-1]["hash"] if current else "")
        payload = "".join(json.dumps(e, sort_keys=True) + "\n" for e in linked)
        descriptor = os.open(self.path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
        try:
            os.write(descriptor, payload.encode())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
