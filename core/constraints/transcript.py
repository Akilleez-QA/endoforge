import json

from .port import Message, Origin


def _text(content) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")


def to_message(record: dict) -> Message | None:
    kind = record.get("type")
    if kind not in ("user", "assistant") or "message" not in record:
        return None
    content = record["message"].get("content", "")
    identity = record.get("uuid", "")
    if kind == "assistant":
        return Message(identity, Origin.ASSISTANT, _text(content))
    if isinstance(content, list) and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
        return Message(identity, Origin.TOOL, json.dumps(content))
    if record.get("isCompactSummary") or record.get("isMeta"):
        return Message(identity, Origin.SYSTEM, _text(content))
    if record.get("isSidechain"):
        return Message(identity, Origin.AGENT, _text(content))
    origin = record.get("origin")
    if isinstance(origin, dict) and origin.get("kind") == "human" and record.get("turnOrigin", "human") == "human":
        return Message(identity, Origin.HUMAN, _text(content))
    return Message(identity, Origin.SYSTEM, _text(content))
