import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def main():
    failures = []
    files = sorted(ROOT.rglob("*.md"))
    for path in files:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            for target in LINK.findall(line):
                if target.startswith(("https://", "http://", "mailto:", "#")):
                    continue
                target = target.split("#", 1)[0]
                if target and not (path.parent / target).exists():
                    failures.append(f"{path.relative_to(ROOT)}:{number}: broken link {target}")
    manifest = ROOT / "sources/SHA256SUMS"
    if not manifest.exists():
        failures.append("sources/SHA256SUMS: missing")
    else:
        for line in manifest.read_text().splitlines():
            digest, separator, relative = line.partition("  ")
            source = manifest.parent / relative
            if not separator or not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != digest:
                failures.append(f"sources/SHA256SUMS: invalid source {relative}")
    for failure in failures:
        print(failure)
    print(f"{len(failures)} failure(s) over {len(files)} documents")
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
