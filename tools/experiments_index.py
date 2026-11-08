import argparse
import posixpath
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BEGIN = "<!-- experiments-index:begin -->"
END = "<!-- experiments-index:end -->"
HEADER = "| Probe | Question | Result |\n|---|---|---|"
DIRECTORY = re.compile(r"P-(\d+)-[a-z0-9][a-z0-9-]*")
LINK = re.compile(r"\]\(([^)\s]+)\)")


def rebase(row, folder):
    def move(match):
        target = match.group(1)
        if target.startswith(("https://", "http://", "mailto:", "#")):
            return match.group(0)
        path, hash_, anchor = target.partition("#")
        joined = posixpath.normpath(posixpath.join(folder, path))
        if path.endswith("/") or path in ("", "."):
            joined += "/"
        return f"]({joined}{hash_}{anchor})"

    return LINK.sub(move, row)


def fragment_rows(path):
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line.startswith("|") or line.startswith("|---") or line == HEADER.splitlines()[0]:
            continue
        rows.append(line)
    return rows


def fragments(experiments):
    found = []
    for folder in experiments.iterdir():
        match = DIRECTORY.fullmatch(folder.name)
        index = folder / "INDEX.md"
        if folder.is_dir() and match and index.is_file():
            found.append((int(match.group(1)), folder.name, index))
    return sorted(found)


def table(experiments):
    lines = [HEADER]
    for _, name, index in fragments(experiments):
        rows = fragment_rows(index)
        if not rows:
            raise ValueError(f"{index.relative_to(experiments.parent)}: no table row")
        lines.extend(rebase(row, name) for row in rows)
    return "\n".join(lines)


def render(readme, experiments):
    text = readme.read_text()
    head, begin, rest = text.partition(BEGIN)
    _, end, tail = rest.partition(END)
    if not begin or not end:
        raise ValueError(f"{readme.name}: missing {BEGIN} or {END}")
    return f"{head}{BEGIN}\n{table(experiments)}\n{END}{tail}"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build experiments/README.md's index from experiments/P-NN-*/INDEX.md.")
    parser.add_argument("--check", action="store_true", help="fail if the committed index is stale")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args(argv)
    experiments = args.root / "experiments"
    readme = experiments / "README.md"
    try:
        wanted = render(readme, experiments)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    if args.check:
        if readme.read_text() != wanted:
            print("experiments/README.md: index is stale; run make index", file=sys.stderr)
            return 1
        return 0
    if readme.read_text() != wanted:
        readme.write_text(wanted)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
