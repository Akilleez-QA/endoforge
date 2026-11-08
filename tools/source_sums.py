import argparse
import hashlib
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def listed(manifest):
    paths = []
    for number, line in enumerate(manifest.read_text().splitlines(), 1):
        if not line.strip():
            continue
        digest, separator, relative = line.partition("  ")
        if not separator or not relative:
            raise ValueError(f"{manifest.name}:{number}: expected '<sha256>  <path>'")
        paths.append(relative)
    return paths


def relative_to_sources(root, path):
    absolute = Path(path) if Path(path).is_absolute() else root / path
    return Path(os.path.relpath(absolute.resolve(), (root / "sources").resolve())).as_posix()


def render(root, paths):
    lines, missing = [], []
    for relative in sorted(set(paths)):
        source = root / "sources" / relative
        if not source.is_file():
            missing.append(relative)
            continue
        lines.append(f"{hashlib.sha256(source.read_bytes()).hexdigest()}  {relative}")
    if missing:
        raise ValueError("listed sources missing: " + ", ".join(missing))
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Regenerate the digests in sources/SHA256SUMS for its curated path list.")
    parser.add_argument("--check", action="store_true", help="fail if the committed file differs")
    parser.add_argument("--add", nargs="+", default=[], metavar="PATH", help="add repository paths to the list")
    parser.add_argument("--remove", nargs="+", default=[], metavar="PATH", help="drop repository paths from the list")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    manifest = args.root / "sources/SHA256SUMS"
    try:
        paths = listed(manifest)
        drop = {relative_to_sources(args.root, p) for p in args.remove}
        paths = [p for p in paths if p not in drop] + [relative_to_sources(args.root, p) for p in args.add]
        wanted = render(args.root, paths)
    except (OSError, ValueError) as error:
        print(f"sources/SHA256SUMS: {error}", file=sys.stderr)
        return 1
    current = manifest.read_text()
    if args.check:
        if current != wanted:
            print("sources/SHA256SUMS: stale digests or order; run make sums", file=sys.stderr)
            return 1
        return 0
    if current != wanted:
        manifest.write_text(wanted)
    print(f"sources/SHA256SUMS: {wanted.count(chr(10))} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
