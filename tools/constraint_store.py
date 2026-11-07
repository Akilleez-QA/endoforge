import json
import os

from core.constraints.port import RecordCorrupt
from core.constraints.store import chain, verify


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
