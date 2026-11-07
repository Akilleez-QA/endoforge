from dataclasses import dataclass
from enum import Enum
from typing import Protocol


class Origin(str, Enum):
    HUMAN = "human"
    QUOTED = "quoted"
    TOOL = "tool"
    AGENT = "agent"
    ASSISTANT = "assistant"
    SYSTEM = "system"


@dataclass(frozen=True)
class Message:
    id: str
    origin: Origin
    text: str


@dataclass(frozen=True)
class Segment:
    message_id: str
    origin: Origin
    start: int
    text: str


@dataclass(frozen=True)
class Candidate:
    message_id: str
    start: int
    text: str
    kind: str
    scope: str


class ExtractionFailed(RuntimeError):
    pass


class PromotionRefused(RuntimeError):
    pass


class RecordCorrupt(RuntimeError):
    pass


class Extractor(Protocol):
    name: str

    def extract(self, segments: list[Segment]) -> list[Candidate]: ...


class Store(Protocol):
    def read(self) -> list[dict]: ...

    def append(self, events: list[dict]) -> None: ...


class ConstraintPort(Protocol):
    def observe(self, message: Message) -> None: ...

    def cross(self) -> dict: ...

    def resume_block(self) -> str: ...
