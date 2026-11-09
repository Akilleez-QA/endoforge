import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRS = "docs/requirements/requirements.md"
SDD = "docs/architecture/architecture.md"
VM = "docs/verification/verification-matrix.md"
CONFIG = "docs/configuration/configuration-reference.md"
REQ = re.compile(r"REQ-[A-Z0-9]+-\d{3}")
GAP = re.compile(r"GAP-EF-\d{3}")
FIELDS = ("Rationale", "Derivation", "Allocated to", "Verification", "Status")
METHODS = {"T", "A", "I", "D"}
SUPPORTING = "## Tests without a requirement"
LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)\s]+)\)")
ANCHOR_SCOPE = ("docs/", "core/", "tools/")
ENV_READ = re.compile(
    r"process\.env\.([A-Z][A-Z0-9_]+)|process\.env\[['\"]([A-Z][A-Z0-9_]+)['\"]\]"
    r"|environ(?:\.get)?\(\s*['\"]([A-Z][A-Z0-9_]+)['\"]|environ\[['\"]([A-Z][A-Z0-9_]+)['\"]\]"
    r"|getenv\(\s*['\"]([A-Z][A-Z0-9_]+)['\"]"
)


def text(root, relative):
    return (Path(root) / relative).read_text(encoding="utf-8")


def git_files(root, *patterns):
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *patterns],
            capture_output=True, check=True,
        ).stdout.decode()
        names = [name for name in out.split("\0") if name]
    except (OSError, subprocess.CalledProcessError):
        names = [p.relative_to(root).as_posix() for pattern in patterns for p in Path(root).rglob(pattern)]
    return sorted({n for n in names if "node_modules" not in Path(n).parts and (Path(root) / n).is_file()})


def discovered_tests(root):
    spec = importlib.util.spec_from_file_location("reachability", Path(root) / "tests/test_reachability.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.discover(Path(root))


def requirements(root):
    body = text(root, SRS)
    records = {}
    for part in re.split(r"^### ", body, flags=re.M)[1:]:
        heading, _, rest = part.partition("\n")
        match = re.match(r"(REQ-[A-Z0-9]+-\d{3}) — \S", heading)
        if not match:
            continue
        rest = re.split(r"^##? ", rest, flags=re.M)[0]
        fields = dict(re.findall(r"^- ([A-Za-z ]+): (.+)$", rest, flags=re.M))
        statement = rest.split("\n- ", 1)[0].strip()
        records.setdefault(match.group(1), []).append({"statement": statement, "fields": fields})
    gap_rows = re.findall(r"^\| (GAP-EF-\d{3}) \|", body, flags=re.M)
    return records, gap_rows


def table_rows(body):
    rows = []
    for line in body.splitlines():
        if line.startswith("|") and not re.match(r"^\|\s*:?-", line):
            cells = re.split(r"(?<!\\)\|", line.strip().strip("|"))
            rows.append([cell.strip().replace("\\|", "|") for cell in cells])
    return rows


def references(cell):
    found = []
    for token in re.findall(r"`([^`]+)`", cell):
        path, _, name = token.partition("::")
        found.append((path, name))
    return found


def matrix(root):
    body = text(root, VM)
    traced_part, _, rest = body.partition(SUPPORTING)
    supporting_part = rest.split("\n## ", 1)[0]
    traced = {}
    for row in table_rows(traced_part):
        if row and REQ.fullmatch(row[0]):
            traced.setdefault(row[0], []).append(row)
    supporting = {}
    for row in table_rows(supporting_part):
        for path, name in references(row[0] if row else ""):
            supporting[path] = row[1] if len(row) > 1 else ""
    return traced, supporting


def design(root):
    body = text(root, SDD)
    section = body.split("## 4. Components", 1)[1].split("\n## ", 1)[0] if "## 4. Components" in body else ""
    allocated, infrastructure, gaps, unallocated = set(), [], [], []
    for row in table_rows(section):
        if len(row) < 3 or row[-1] == "Requirements":
            continue
        name = " ".join(row[:2])
        ids = REQ.findall(row[-1])
        if ids:
            allocated.update(ids)
        elif GAP.search(row[-1]):
            gaps.append((name, GAP.findall(row[-1])))
        elif "infrastructure" in row[-1].lower():
            infrastructure.append(name)
        else:
            unallocated.append(name)
    return allocated, infrastructure, gaps, unallocated


def slug(heading):
    heading = re.sub(r"[^\w\- ]", "", heading.strip().lower())
    return heading.replace(" ", "-")


def anchors(path):
    seen, found, fenced = {}, set(), False
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("```"):
            fenced = not fenced
        if fenced or not re.match(r"#{1,6} ", line):
            continue
        name = slug(line.lstrip("#"))
        count = seen.get(name, 0)
        seen[name] = count + 1
        found.add(name if count == 0 else f"{name}-{count}")
    return found


def link_problems(root):
    root = Path(root)
    problems = []
    for relative in git_files(root, "*.md"):
        scoped = "/" not in relative or relative.startswith(ANCHOR_SCOPE)
        path = root / relative
        fenced = False
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.startswith("```"):
                fenced = not fenced
            if fenced:
                continue
            for target in LINK.findall(re.sub(r"`[^`]*`", "", line)):
                if re.match(r"[a-z]+:", target):
                    continue
                file_part, _, anchor = target.partition("#")
                resolved = (path.parent / file_part).resolve() if file_part else path
                where = f"{relative}:{number}: {target}"
                if not resolved.exists():
                    problems.append("dead link: " + where)
                elif scoped and anchor and resolved.suffix == ".md" and anchor not in anchors(resolved):
                    problems.append("dead anchor: " + where)
    return problems


def environment_names(root):
    names = set()
    for relative in git_files(root, "core/*", "tools/*"):
        parts = Path(relative).parts
        if any(p in ("test", "tests", "fixtures") for p in parts) or Path(relative).name.startswith("test_"):
            continue
        if ".test." in relative or Path(relative).suffix not in (".mjs", ".cjs", ".js", ".py", ".ts"):
            continue
        for match in ENV_READ.finditer((Path(root) / relative).read_text(encoding="utf-8", errors="replace")):
            names.add(next(group for group in match.groups() if group))
    return names


def check(root=ROOT):
    root = Path(root)
    problems = []
    records, gap_rows = requirements(root)
    traced, supporting = matrix(root)
    tests = discovered_tests(root)
    allocated, infrastructure, gap_components, unallocated = design(root)
    for rid, items in sorted(records.items()):
        if len(items) != 1:
            problems.append(f"{rid}: defined {len(items)} times")
            continue
        item = items[0]
        if len(re.findall(r"\bshall\b", item["statement"])) != 1:
            problems.append(f'{rid}: statement must contain exactly one "shall"')
        for field in FIELDS:
            if field not in item["fields"]:
                problems.append(f"{rid}: missing field {field}")
        for path in re.findall(r"`([^`]+)`", item["fields"].get("Derivation", "")):
            if not (root / path).exists():
                problems.append(f"{rid}: derivation path does not exist: {path}")
        if item["fields"].get("Status", "").startswith("Deleted"):
            continue
        if rid not in traced:
            problems.append(f"{rid}: no verification-matrix row")
        if rid not in allocated:
            problems.append(f"{rid}: not allocated to any design component")
    referenced = set()
    for rid, rows in sorted(traced.items()):
        if rid not in records:
            problems.append(f"{rid}: matrix row for an undefined requirement")
        for row in rows:
            methods = set(re.split(r"[/, ]+", row[1])) - {""} if len(row) > 1 else set()
            if not methods or not methods <= METHODS:
                problems.append(f"{rid}: method must be T, A, I or D: {row[1] if len(row) > 1 else ''}")
            refs = [r for cell in row[2:3] for r in references(cell)]
            tested = [(p, n) for p, n in refs if p in tests]
            if "T" in methods and not tested:
                problems.append(f"{rid}: method T names no discovered test file")
            if methods & {"I", "A", "D"} and not refs:
                problems.append(f"{rid}: inspection, analysis or demonstration names nothing to inspect")
            for path, name in refs:
                if not (root / path).exists():
                    problems.append(f"{rid}: referenced path does not exist: {path}")
                elif name and name not in text(root, path):
                    problems.append(f"{rid}: test name not found in {path}: {name}")
                if path in tests:
                    referenced.add(path)
    for rid in sorted(allocated - set(records)):
        problems.append(f"{rid}: allocated in design but undefined")
    for name, ids in gap_components:
        for gap in ids:
            if gap not in gap_rows:
                problems.append(f"{name}: design names an unregistered gap {gap}")
    for name in unallocated:
        problems.append(f"design component implements no requirement and is not infrastructure: {name}")
    for path in sorted(set(supporting) - tests):
        problems.append(f"supporting entry is not a discovered test file: {path}")
    for path, reason in sorted(supporting.items()):
        if not reason:
            problems.append(f"supporting entry needs a reason: {path}")
    for path in sorted(tests - referenced - set(supporting)):
        problems.append(f"test file traces to no requirement and is not listed as supporting: {path}")
    if len(gap_rows) != len(set(gap_rows)):
        problems.append("duplicate GAP-EF identifier in requirements")
    for row in table_rows(text(root, VM).partition(SUPPORTING)[0]):
        if row and GAP.fullmatch(row[0]):
            problems.append(f"{row[0]}: an untested gap appears as a traced matrix row")
    config = text(root, CONFIG)
    for name in sorted(environment_names(root)):
        if f"`{name}`" not in config:
            problems.append(f"environment variable read by code is not in the configuration reference: {name}")
    problems.extend(link_problems(root))
    summary = {
        "requirements": len(records),
        "traced_requirements": len(set(records) & set(traced)),
        "untested_gaps": len(set(gap_rows)),
        "test_files": len(tests),
        "test_files_traced": len(tests & referenced),
        "test_files_supporting": len(tests & set(supporting) - referenced),
        "design_infrastructure_components": len(infrastructure),
        "design_gap_components": len(gap_components),
        "environment_variables": len(environment_names(root)),
        "problems": len(problems),
    }
    return problems, summary


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    problems, summary = check(Path(argv[0]) if argv else ROOT)
    for problem in problems:
        print(problem)
    print(json.dumps(summary, sort_keys=True))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
