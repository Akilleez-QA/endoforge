import argparse
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEDGER = "experiments/ALLOCATED"
TAGS = "refs/tags/experiment-id/"
LINE = re.compile(r"P-(\d+)  ([a-z0-9][a-z0-9-]*)(  legacy-duplicate)?")
DIRECTORY = re.compile(r"P-(\d+)-([a-z0-9][a-z0-9-]*)")
SLUG = re.compile(r"[a-z0-9][a-z0-9-]*")


def read(root):
    entries, header = [], []
    for number, line in enumerate((root / LEDGER).read_text().splitlines(), 1):
        if not line or line.startswith("#"):
            if not entries:
                header.append(line)
                continue
            raise ValueError(f"{LEDGER}:{number}: comments belong at the top")
        match = LINE.fullmatch(line)
        if not match:
            raise ValueError(f"{LEDGER}:{number}: expected 'P-NN  slug'")
        entries.append((int(match.group(1)), match.group(2), bool(match.group(3))))
    return header, entries


def write(root, header, entries):
    lines = header + [f"P-{n:02d}  {slug}" + ("  legacy-duplicate" if legacy else "") for n, slug, legacy in sorted(entries)]
    (root / LEDGER).write_text("\n".join(lines) + "\n")


def problems(root):
    header, entries = read(root)
    found = []
    if entries != sorted(entries):
        found.append(f"{LEDGER}: entries are not sorted")
    by_number = {}
    for n, slug, legacy in entries:
        by_number.setdefault(n, []).append((slug, legacy))
    for n, owners in sorted(by_number.items()):
        if len(owners) > 1 and not all(legacy for _, legacy in owners):
            found.append(f"{LEDGER}: P-{n:02d} is allocated more than once: {', '.join(s for s, _ in owners)}")
        if len(owners) == 1 and owners[0][1]:
            found.append(f"{LEDGER}: P-{n:02d} is marked legacy-duplicate but has one owner")
    names = {(n, slug) for n, slug, _ in entries}
    for folder in sorted((root / "experiments").iterdir()):
        match = DIRECTORY.fullmatch(folder.name)
        if folder.is_dir() and match and (int(match.group(1)), match.group(2)) not in names:
            found.append(f"experiments/{folder.name}: not in {LEDGER}; reserve it with tools/experiment_id.py reserve")
    return found


def git(root, *args, check=True):
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=check)


def remote_numbers(root, remote):
    listing = git(root, "ls-remote", remote, f"{TAGS}*").stdout
    return {int(m.group(1)) for m in re.finditer(r"experiment-id/P-(\d+)$", listing, re.MULTILINE)}


def claim(root, remote, number, slug):
    git(root, "fetch", "--quiet", remote, "refs/heads/main")
    message = f"experiment-id: reserve P-{number:02d}-{slug} ({socket.gethostname()} {os.getpid()} {time.time_ns()})"
    marker = git(root, "commit-tree", "FETCH_HEAD^{tree}", "-p", "FETCH_HEAD", "-m", message).stdout.strip()
    pushed = git(root, "push", "--quiet", remote, f"{marker}:{TAGS}P-{number:02d}", check=False)
    return pushed.returncode == 0


def reserve(root, slug, remote, local, commit, attempts=50):
    if not SLUG.fullmatch(slug):
        raise ValueError(f"slug {slug!r} must be lowercase letters, digits and hyphens")
    header, entries = read(root)
    used = {n for n, _, _ in entries}
    used |= {int(m.group(1)) for f in (root / "experiments").iterdir() if (m := DIRECTORY.fullmatch(f.name))}
    if not local:
        used |= remote_numbers(root, remote)
    number = max(used, default=0) + 1
    for _ in range(attempts):
        if number not in used and (local or claim(root, remote, number, slug)):
            break
        used.add(number)
        number += 1
    else:
        raise RuntimeError(f"no free experiment number after {attempts} attempts")
    entries.append((number, slug, False))
    write(root, header, entries)
    if commit:
        git(root, "add", "--", LEDGER)
        git(root, "commit", "--quiet", "-m", f"experiments: reserve P-{number:02d}-{slug}", "--", LEDGER)
    return number


def main(argv=None):
    parser = argparse.ArgumentParser(description="Reserve experiment numbers from one sequence and check experiments/ALLOCATED.")
    parser.add_argument("--root", type=Path, default=ROOT)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("check", help="fail on duplicate or missing allocations")
    take = commands.add_parser("reserve", help="reserve the next P-number and commit it")
    take.add_argument("slug")
    take.add_argument("--remote", default="origin")
    take.add_argument("--local", action="store_true", help="skip the remote tag claim (not safe across machines)")
    take.add_argument("--no-commit", dest="commit", action="store_false")
    args = parser.parse_args(argv)
    try:
        if args.command == "check":
            found = problems(args.root)
            for line in found:
                print(line, file=sys.stderr)
            return 1 if found else 0
        number = reserve(args.root, args.slug, args.remote, args.local, args.commit)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", "") or ""
        print(f"experiment_id: {error} {detail}".strip(), file=sys.stderr)
        return 1
    print(f"P-{number:02d}-{args.slug}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
