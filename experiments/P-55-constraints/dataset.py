import hashlib
import json
import os
import sys
from pathlib import Path

from core.constraints.port import Origin
from core.constraints.segments import segments
from core.constraints.transcript import to_message

LIMIT, CUT, CAP = 500, 400, 80000


def action_lines(record):
    if record.get("type") != "assistant":
        return []
    lines = []
    content = record.get("message", {}).get("content", "")
    for block in content if isinstance(content, list) else []:
        if block.get("type") == "text":
            lines.append("TEXT " + block.get("text", "")[:CUT])
        elif block.get("type") == "tool_use":
            lines.append("CALL " + block.get("name", "") + " " + json.dumps(block.get("input", {}))[:CUT])
    return lines


def load(root, pattern, exclude):
    sessions, seen = [], set()
    for path in sorted(Path(root).glob(f"*{pattern}*/*.jsonl")):
        if path.stem in exclude:
            continue
        rows = []
        for line in open(path, errors="replace"):
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
        sessions.append((path.stem, rows))
    return sessions, seen


def build(sessions):
    messages, events, digests, seen = [], [], set(), set()
    for name, rows in sessions:
        current, boundary = None, None
        for index, row in enumerate(rows):
            if row.get("subtype") == "compact_boundary":
                boundary = row
                continue
            if row.get("isCompactSummary") and boundary is not None:
                content = row["message"]["content"]
                summary = content if isinstance(content, str) else json.dumps(content)
                digest = hashlib.sha256(summary.encode()).hexdigest()
                meta = boundary.get("compactMetadata", {})
                preserved = meta.get("preservedMessages", {}).get("allUuids", [])
                if digest not in digests:
                    digests.add(digest)
                    current = dict(session=name, index=index, digest=digest, summary=summary, preserved=preserved, actions=[])
                    events.append(current)
                else:
                    current = None
                boundary = None
                continue
            if current is not None:
                current["actions"].extend(action_lines(row))
            message = to_message(row)
            if message is None or message.origin is not Origin.HUMAN or message.id in seen:
                continue
            seen.add(message.id)
            parts = [s.text.strip() for s in segments(message) if s.origin is Origin.HUMAN]
            body = "\n".join(p for p in parts if p)
            if body:
                messages.append(dict(id=message.id, session=name, index=index, text=body))
    for event in events:
        lines = event["actions"]
        total, stride = sum(map(len, lines)), 1
        if total > CAP:
            stride = total // CAP + 1
        event["actions"] = "\n".join(lines[::stride])[:CAP]
    return messages, events


def main(root, out, pattern, *exclude):
    os.makedirs(out, exist_ok=True)
    messages, events = build(load(root, pattern, set(exclude))[0])
    order = sorted(messages, key=lambda m: hashlib.sha256(m["id"].encode()).hexdigest())[:LIMIT]
    for rank, message in enumerate(order):
        message["split"] = "A" if rank % 2 == 0 else "B"
    json.dump(dict(messages=messages, label_set=order, events=events), open(f"{out}/dataset.json", "w"))
    print(json.dumps(dict(human_messages=len(messages), label_set=len(order), events=len(events),
                          sessions=len({m["session"] for m in messages}), chars=sum(len(m["text"]) for m in order))))


if __name__ == "__main__":
    main(*sys.argv[1:])
