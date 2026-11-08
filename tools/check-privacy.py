import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ("PRECOMMIT.md", "AMENDMENT.md", "RESULT.md")
PATTERNS = (
    ("home path", re.compile(r"(?<![\w.-])/(?:home|Users)/[^/\s`'\"]+/")),
    ("Claude projects path", re.compile(r"\.claude/projects\b")),
    ("Claude scratch workspace id", re.compile(r"workspaces[-/][0-9a-f]{8}", re.IGNORECASE)),
    ("email address", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")),
)


def records(root):
    return sorted(path for name in RECORDS for path in root.glob(f"experiments/*/{name}") if path.is_file())


def allowlist(root, failures):
    allowed = {}
    for entry in json.loads((root / "tools/privacy-allowlist.json").read_text()):
        relative = entry.get("path", "")
        if not str(entry.get("reason", "")).strip():
            failures.append(f"{relative}: allowlist entry needs a reason")
            continue
        if not (root / relative).is_file():
            failures.append(f"{relative}: allowlisted file missing")
            continue
        allowed[relative] = entry.get("sha256")
    return allowed


def main(root=ROOT):
    root = Path(root)
    failures = []
    allowed = allowlist(root, failures)
    files = records(root)
    for path in files:
        relative = path.relative_to(root).as_posix()
        data = path.read_bytes()
        if allowed.get(relative) == hashlib.sha256(data).hexdigest():
            continue
        for number, line in enumerate(data.decode(errors="replace").splitlines(), 1):
            for kind, pattern in PATTERNS:
                if pattern.search(line):
                    failures.append(f"{relative}:{number}: {kind}")
    for failure in failures:
        print(failure)
    print(f"{len(failures)} failure(s) over {len(files)} records")
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main(*sys.argv[1:2]))
