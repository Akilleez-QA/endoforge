import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")


def documents(root):
    try:
        listed = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
            capture_output=True, check=True,
        ).stdout.decode().split("\0")
    except (OSError, subprocess.CalledProcessError):
        listed = [str(path.relative_to(root)) for path in root.rglob("*.md")]
        listed = [name for name in listed if ".scratch" not in Path(name).parts]
    paths = {root / name for name in listed if name}
    return sorted(path for path in paths if path.is_file() and "node_modules" not in path.relative_to(root).parts)


def main(root=ROOT):
    root = Path(root)
    failures = []
    files = documents(root)
    for path in files:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            for target in LINK.findall(line):
                if target.startswith(("https://", "http://", "mailto:", "#")):
                    continue
                target = target.split("#", 1)[0]
                if target and not (path.parent / target).exists():
                    failures.append(f"{path.relative_to(root)}:{number}: broken link {target}")
    manifest = root / "sources/SHA256SUMS"
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
    raise SystemExit(main(*sys.argv[1:2]))
