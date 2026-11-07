import re

from .port import Message, Origin, Segment

_BLOCK = re.compile(
    r"<(?P<tag>[A-Za-z_][\w:-]*)(?:\s[^<>]*)?>.*?</(?P=tag)(?:\s[^<>]*)?>"
    r"|<(?:pasted_content|document|system-reminder)\b.*\Z"
    r"|```.*?(?:```|\Z)|~~~.*?(?:~~~|\Z)|(?m:^[ \t]*>.*$)",
    re.S,
)


MAX_TYPED = 100_000


def segments(message: Message) -> list[Segment]:
    if message.origin is not Origin.HUMAN:
        return [Segment(message.id, message.origin, 0, message.text)]
    if len(message.text) > MAX_TYPED:
        return [Segment(message.id, Origin.QUOTED, 0, message.text)]
    found, cursor = [], 0
    for match in _BLOCK.finditer(message.text):
        if message.text[cursor:match.start()].strip():
            found.append(Segment(message.id, Origin.HUMAN, cursor, message.text[cursor:match.start()]))
        found.append(Segment(message.id, Origin.QUOTED, match.start(), match.group(0)))
        cursor = match.end()
    if message.text[cursor:].strip():
        found.append(Segment(message.id, Origin.HUMAN, cursor, message.text[cursor:]))
    return found
