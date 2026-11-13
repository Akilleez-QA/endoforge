"""Fold unreleased fragments into the changelog and archive their source files."""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import re
import shutil
import sys


HEADINGS = {f"### {name}" for name in (
    "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"
)}


def parse_fragment(path):
    sections = {}
    heading = None
    has_bullet = False
    for line in path.read_text(encoding="utf-8").splitlines(keepends=True):
        text = line.rstrip("\r\n")
        if text in HEADINGS:
            if heading is not None and not has_bullet:
                raise ValueError(f"{path.name}: heading without bullets")
            heading = text
            sections.setdefault(heading, [])
            has_bullet = False
        elif not text.strip():
            continue
        elif heading and re.match(r"^- \S", text):
            sections[heading].append(line if line.endswith("\n") else line + "\n")
            has_bullet = True
        elif heading and has_bullet and text.startswith(("  ", "\t")):
            sections[heading].append(line if line.endswith("\n") else line + "\n")
        else:
            raise ValueError(f"{path.name}: expected a section heading or bullet")
    if not heading or not has_bullet:
        raise ValueError(f"{path.name}: empty fragment or section")
    return sections


def fold(root, dest):
    fragments = sorted(path for path in (root / "changes/unreleased").glob("*.md")
                       if path.name != "README.md")
    if not fragments:
        return
    archive = root / "changes/released" / dest
    sections = {}
    for path in fragments:
        target = archive / path.name
        if target.exists() or target.is_symlink():
            raise ValueError(f"destination exists: {target}")
        for heading, bullets in parse_fragment(path).items():
            sections.setdefault(heading, []).extend(bullets)
    changelog = root / "CHANGELOG.md"
    lines = changelog.read_text(encoding="utf-8").splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines)
                  if line.rstrip("\r\n") == "## [Unreleased]"), None)
    if start is None:
        raise ValueError("CHANGELOG.md: missing ## [Unreleased]")
    end = next((i for i in range(start + 1, len(lines))
                if lines[i].startswith("## ")), len(lines))
    body = lines[start + 1:end]
    for heading, bullets in sections.items():
        index = next((i for i, line in enumerate(body)
                      if line.rstrip("\r\n") == heading), None)
        if index is None:
            if body and not body[-1].endswith("\n"):
                body[-1] += "\n"
            if body and body[-1].strip():
                body.append("\n")
            body.extend([heading + "\n", *bullets, "\n"])
        else:
            if not body[index].endswith("\n"):
                body[index] += "\n"
            body[index + 1:index + 1] = bullets
    archive.mkdir(parents=True, exist_ok=True)
    changelog.write_text("".join(lines[:start + 1] + body + lines[end:]), encoding="utf-8")
    for path in fragments:
        shutil.move(str(path), str(archive / path.name))


def main():
    parser = argparse.ArgumentParser(usage="%(prog)s [--root DIR] [--dest NAME]",
                                     description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--dest", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    args = parser.parse_args()
    if args.dest in (".", "..") or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.dest):
        parser.error("--dest must be a single directory name")
    try:
        fold(args.root, args.dest)
    except (OSError, ValueError, shutil.Error) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
