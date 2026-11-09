import argparse
import datetime
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("check_trace", ROOT / "tools/check_trace.py")
check_trace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_trace)

DISCLAIMER = (
    "> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), "
    "[NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the "
    "[NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) "
    "documentation guidance. This is not a NASA compliance determination or certification. The software "
    "classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent "
    "verification and validation, or hazard analysis is asserted. The document describes the implementation "
    "inspected at the baseline commit."
)
PINNED = (
    "sources/SHA256SUMS",
    "tools/asc/pin.mjs",
    "tools/asc/package-lock.json",
    "tools/tscheck/pin.mjs",
    "tools/tscheck/package-lock.json",
    "tools/kernel/install_tools.py",
    "tools/kernel/requirements.txt",
    "core/ledger/record.schema.json",
    "tools/kernel/kernel.wit",
)


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_log(label, path):
    raw = Path(path).read_bytes()
    text = raw.decode("utf-8", errors="replace")
    totals = {"tests": 0, "pass": 0, "fail": 0, "skipped": 0}
    failures = []
    for key in ("tests", "pass", "fail", "skipped"):
        totals[key] += sum(int(n) for n in re.findall(rf"^(?:ℹ|#) {key} (\d+)$", text, flags=re.M))
    ran = [int(n) for n in re.findall(r"^Ran (\d+) tests? in", text, flags=re.M)]
    py_fail = sum(int(n) for n in re.findall(r"^FAILED \(.*?failures=(\d+)", text, flags=re.M))
    py_err = sum(int(n) for n in re.findall(r"^FAILED \(.*?errors=(\d+)", text, flags=re.M))
    py_skip = sum(int(n) for n in re.findall(r"^(?:OK|FAILED) \(.*?skipped=(\d+)", text, flags=re.M))
    totals["tests"] += sum(ran)
    totals["fail"] += py_fail + py_err
    totals["skipped"] += py_skip
    totals["pass"] += sum(ran) - py_fail - py_err - py_skip
    script_pass = len(re.findall(r"^PASS ", text, flags=re.M))
    script_fail = len(re.findall(r"^FAIL ", text, flags=re.M))
    totals["tests"] += script_pass + script_fail
    totals["pass"] += script_pass
    totals["fail"] += script_fail
    for line in text.splitlines():
        if (line.startswith("✖ ") and not line.startswith("✖ failing tests")) or re.match(r"^(FAIL|ERROR): |^FAIL |^not ok ", line):
            if line not in failures:
                failures.append(line)
    header = dict(re.findall(r"^# ([a-z-]+): (.+)$", text, flags=re.M))
    node_cov = [tuple(float(n) for n in m) for m in re.findall(
        r"^(?:ℹ|#) all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)", text, flags=re.M)]
    py_cov = [float(n) for n in re.findall(r"^TOTAL(?:\s+\d+)+\s+(\d+(?:\.\d+)?)%\s*$", text, flags=re.M)]
    exit_code = re.findall(r"^make-exit=(\d+)$", text, flags=re.M)
    return {
        "label": label,
        "file": Path(path).name,
        "sha256": sha256(raw),
        "header": header,
        "exit": int(exit_code[-1]) if exit_code else None,
        "totals": totals,
        "failures": failures,
        "unittest_runs": len(ran),
        "coverage": {"node": node_cov, "python": py_cov},
    }


def gh(*args):
    if not shutil.which("gh"):
        return None
    result = subprocess.run(["gh", *args], cwd=ROOT, capture_output=True, text=True)
    return json.loads(result.stdout) if result.returncode == 0 else None


def line_counts():
    counts = {}
    for relative in git("ls-files").splitlines():
        path = ROOT / relative
        suffix = path.suffix or path.name
        if suffix in (".png", ".wasm", ".sqlite", ".gz") or not path.is_file():
            continue
        entry = counts.setdefault(suffix, [0, 0])
        entry[0] += 1
        entry[1] += len(path.read_bytes().splitlines())
    top = sorted(counts.items(), key=lambda item: -item[1][1])[:8]
    return top


def gitleaks(binary):
    if not binary:
        return None
    result = subprocess.run([binary, "git", "--no-banner", "--redact", "--log-opts=HEAD", "."], cwd=ROOT,
                            capture_output=True, text=True)
    version = subprocess.run([binary, "version"], capture_output=True, text=True).stdout.strip()
    summary = [re.sub(r"\x1b\[[0-9;]*m", "", line) for line in result.stderr.splitlines()[-2:]]
    return {"command": "gitleaks git --no-banner --redact --log-opts=HEAD .", "version": version,
            "exit": result.returncode, "summary": "; ".join(re.sub(r"^\S+\s+\S+\s+", "", s).strip() for s in summary)}


def tooling():
    makefile = ROOT / "Makefile"
    make = makefile.read_text(encoding="utf-8") if makefile.is_file() else ""
    workflows = ROOT / ".github/workflows"
    ci = "\n".join(p.read_text(encoding="utf-8") for p in sorted(workflows.glob("*.y*ml"))) if workflows.is_dir() else ""
    targets = {m.group(1): m.group(2).split() for m in re.finditer(r"^([A-Za-z][\w-]*):(?!=)(.*)$", make, flags=re.M)}
    ci_targets = {t for line in re.findall(r"\bmake\b([^\n]*)", ci) for t in line.split() if not t.startswith("-")}
    lint = "lint" in targets
    return {
        "lint": lint,
        "lint_ci": lint and ("lint" in ci_targets or any("lint" in targets.get(t, []) for t in ci_targets)),
        "coverage": "coverage" in targets,
    }


def coverage_rows(d):
    rows = []
    for r in d["runs"]:
        cov = r.get("coverage") or {}
        parts = [f"Node all files: line {a:.2f}%, branch {b:.2f}%, funcs {c:.2f}%" for a, b, c in cov.get("node", [])]
        parts += [f"Python total: {p:g}%" for p in cov.get("python", [])]
        if parts:
            rows.append(f"| Code coverage ({r['label']}) | {'; '.join(parts)} | log `{r['file']}` |")
    if rows:
        return rows
    if d["tooling"]["coverage"]:
        return ["| Code coverage | not measured in the recorded runs; `make coverage` produces it | — |"]
    return ["| Code coverage | not measured: no coverage target is configured | — |"]


def static_analysis(d):
    t = d["tooling"]
    if not t["lint"]:
        return "- Static analysis: no linter is configured."
    if not t["lint_ci"]:
        return "- Static analysis: `make lint` is configured but CI does not run it."
    return "- Static analysis: `make lint` is configured and CI runs it."


def collect(args):
    if git("status", "--porcelain", "--untracked-files=no"):
        raise SystemExit("Working tree has uncommitted changes; commit before generating release records.")
    problems, summary = check_trace.check(ROOT)
    records, gap_rows = check_trace.requirements(ROOT)
    commit = git("rev-parse", "HEAD")
    runs = [parse_log(label, path) for label, path in args.log]
    archive = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=ROOT, capture_output=True, check=True).stdout
    return {
        "commit": commit,
        "tree": git("rev-parse", "HEAD^{tree}"),
        "commit_date": git("show", "-s", "--format=%cs", "HEAD"),
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "tags": [t for t in git("tag", "--list").split() if not t.startswith("experiment-id/")],
        "reservations": len([t for t in git("tag", "--list").split() if t.startswith("experiment-id/")]),
        "since": git("log", "--format=%h %cs %s", "--merges", f"{args.since}..HEAD").splitlines() if args.since else [],
        "commit_count": int(git("rev-list", "--count", "HEAD")),
        "runs": runs,
        "run_drift": {c: git("diff", "--name-only", c, "HEAD").splitlines()
                      for c in {r["header"].get("commit") for r in runs} if c and c != commit},
        "trace_problems": problems,
        "trace": summary,
        "gaps": gap_rows,
        "statuses": sorted({r[0]["fields"].get("Status", "missing") for r in records.values()}),
        "issues": gh("issue", "list", "-R", args.repo, "--state", "all", "--limit", "500", "--json", "number,state,title,labels"),
        "prs": gh("pr", "list", "-R", args.repo, "--state", "merged", "--limit", "1000", "--json", "number,reviews,comments"),
        "pinned": [(p, sha256((ROOT / p).read_bytes())) for p in PINNED if (ROOT / p).is_file()],
        "archive": {"sha256": sha256(archive), "bytes": len(archive), "files": len(git("ls-files").splitlines())},
        "lines": line_counts(),
        "gitleaks": gitleaks(args.gitleaks),
        "tooling": tooling(),
        "privacy": subprocess.run([sys.executable, "-I", "tools/check-privacy.py"], cwd=ROOT, capture_output=True,
                                  text=True).stdout.strip().splitlines()[-1:],
    }


def header(title, doc_id, d, pr):
    return "\n".join([
        f"# EndoForge {title}", "",
        "| Field | Value |", "|---|---|",
        f"| Document ID | {doc_id} |", "| Version | 1.0 |", "| Status | Baselined |",
        "| Owner | Akilleez-QA maintainer |", f"| Date | {d['commit_date']} |", f"| Baseline commit | {d['commit']} |",
        f"| Applies to | endoforge main at `{d['commit'][:7]}` (no release tag exists) |",
        "| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../../plan/software-management-plan.md#1-software-classification-self-assessed)) |",
        "", DISCLAIMER, "",
        f"Generated by `python3 -I tools/gen_release_docs.py` at commit `{d['commit']}` for PR #{pr}. Do not edit by hand; rerun the generator.", "",
    ])


def history(d, pr):
    return "\n".join(["## Change history", "", "| Version | Date | Commit | Change | Reviewed in |",
                      "|---|---|---|---|---|", f"| 1.0 | {d['commit_date']} | `{d['commit'][:7]}` | Generated record | PR #{pr} |", ""])


def severity(issues, state):
    counts = {}
    for issue in issues or []:
        if issue["state"] != state:
            continue
        labels = [label["name"] for label in issue["labels"] if re.fullmatch(r"S[1-4]", label["name"])]
        counts[labels[0] if labels else "unlabelled"] = counts.get(labels[0] if labels else "unlabelled", 0) + 1
    return counts


def str_report(d, name, pr):
    runs = d["runs"]
    ok = runs and all(r["exit"] == 0 and r["totals"]["fail"] == 0 for r in runs) and not d["trace_problems"]
    t = d["trace"]
    lines = [header(f"test report {name}", f"ENDOFORGE-{name}", d, pr)]
    lines += ["## 1. Summary", "",
              f"- Conclusion: {'every recorded run exited 0 with no failed test, and the trace check reported no problems' if ok else 'at least one recorded run or check failed; see section 4'}.",
              f"- Runs recorded: {len(runs)} (see section 2).",
              f"- Trace check: {t['traced_requirements']} of {t['requirements']} requirements traced; {t['test_files_traced']} of {t['test_files']} discovered test files traced and {t['test_files_supporting']} supporting; {t['untested_gaps']} untested gaps; {len(d['trace_problems'])} problems.",
              "- Remaining deficiencies: the untested gaps in [SRS §11](../../requirements/requirements.md#11-untested-behaviour-requirement-gaps) and the findings in the [assurance record](../../assurance/assurance-record.md).",
              "- Test-environment impact: one local Linux machine. GitHub CI runs the same targets on `ubuntu-latest` with Python 3.12 and Node 22 and 26; local runs used the Python shown below.",
              "", "## 2. Test log", "",
              f"Commit `{d['commit']}` (tree `{d['tree']}`). Generated {d['generated']}. Run by: operator, local `make` under `heavy-run`.", "",
              "| Run | Run commit | Node | Python | Command | Exit | Log | Log SHA-256 |", "|---|---|---|---|---|---|---|---|"]
    for r in runs:
        h = r["header"]
        lines.append(f"| {r['label']} | `{h.get('commit', '?')[:7]}` | {h.get('node', '?')} | {h.get('python', '?')} | `{h.get('command', '?')}` | {r['exit']} | `{r['file']}` | `{r['sha256']}` |")
    for run_commit, files in d["run_drift"].items():
        lines += ["", f"The runs at `{run_commit[:7]}` precede the record commit. Files changed between them: "
                  + (", ".join(f"`{f}`" for f in files) or "none") + ". Those changes are not covered by these runs unless listed in section 4."]
    lines += ["", "## 3. Results", "",
              "Totals are summed from each log: Node test runner summaries (`ℹ tests` with the spec reporter on Node 26, `# tests` with the TAP reporter Node 22 uses when output is not a terminal), Python `unittest` summaries (`Ran N tests`) and script checks (`PASS`/`FAIL` lines). Per-requirement coverage is in the [verification matrix](../verification-matrix.md).", "",
              "| Run | Tests | Passed | Failed | Skipped | unittest runs |", "|---|---|---|---|---|---|"]
    for r in runs:
        x = r["totals"]
        lines.append(f"| {r['label']} | {x['tests']} | {x['pass']} | {x['fail']} | {x['skipped']} | {r['unittest_runs']} |")
    lines += ["", "## 4. Problems and deviations", ""]
    problem_rows = []
    for r in runs:
        if r["exit"] != 0:
            problem_rows.append(f"| {r['label']} | make exit {r['exit']} |")
        problem_rows += [f"| {r['label']} | `{f}` |" for f in r["failures"]]
    problem_rows += [f"| trace check | {p} |" for p in d["trace_problems"]]
    lines += (["| Item | Description |", "|---|---|", *problem_rows] if problem_rows else
              ["None. No recorded run failed and the trace check reported no problems."])
    lines += ["", "Known deviation: assertions in `tools/factory_campaign/test_state.py`, `tools/factory_campaign/test_model_journal.py` and `tools/factory_portability/test_checkpoint.py` are `assert` statements, which the optimized runs strip (finding D-01 in the [assurance record](../../assurance/assurance-record.md)). Their optimized results are vacuous.", "", "Secret-scan matches are reviewed in the [assurance record](../../assurance/assurance-record.md); a match listed there as a false positive is not a leak."]
    issues, prs = d["issues"], d["prs"]
    reviewed = sum(1 for p in prs or [] if p["reviews"] or p["comments"])
    g = d["gitleaks"]
    lines += ["", "## 5. Metrics", "", "Every value below was produced by the generator at the commit above.", "",
              "| Measure | Value | Source |", "|---|---|---|"]
    for r in runs:
        x = r["totals"]
        lines.append(f"| Tests run / passed / failed / skipped ({r['label']}) | {x['tests']} / {x['pass']} / {x['fail']} / {x['skipped']} | log `{r['file']}` |")
    lines += [f"| Requirements total / traced / untested gaps / TBD | {t['requirements']} / {t['traced_requirements']} / {t['untested_gaps']} / 0 | `python3 -I tools/check_trace.py` |",
              f"| Requirement statuses | {', '.join(d['statuses'])} | SRS parse |",
              f"| Test files discovered / traced / supporting | {t['test_files']} / {t['test_files_traced']} / {t['test_files_supporting']} | `tests/test_reachability.py` discovery |",
              f"| Design components: infrastructure / gap only | {t['design_infrastructure_components']} / {t['design_gap_components']} | SDD §4 |",
              "| Requirement changes since previous tag | not applicable: no release tag | `git tag --list` |",
              f"| Issues open by severity | {json.dumps(severity(issues, 'OPEN'), sort_keys=True) if issues is not None else 'not queried'} | `gh issue list --state all` |",
              f"| Issues closed (all time) | {sum(1 for i in issues or [] if i['state'] == 'CLOSED') if issues is not None else 'not queried'} | `gh issue list --state all` |",
              f"| PRs merged / with a review or comment | {len(prs) if prs is not None else 'not queried'} / {reviewed if prs is not None else 'not queried'} | `gh pr list --state merged` |",
              f"| Privacy lint | {' '.join(d['privacy'])} | `python3 -I tools/check-privacy.py` |",
              f"| Secret scan | {g['summary'] + ' (exit ' + str(g['exit']) + ', ' + g['version'] + ')' if g else 'not run'} | `{g['command'] if g else 'gitleaks not supplied'}` |",
              f"| Commits reachable from the record commit | {d['commit_count']} | `git rev-list --count HEAD` |",
              f"| Tracked lines, largest file types | {'; '.join(f'{k} {v[0]} files {v[1]} lines' for k, v in d['lines'])} | `git ls-files` |",
              *coverage_rows(d),
              "", "## 6. Rationale for decisions", "",
              "No failure was accepted. Results apply only to the commit and environments above. Author tests with synthetic inputs and test doubles are not independent acceptance and do not qualify live model services.",
              "", history(d, pr)]
    return "\n".join(lines)


def vdd_report(d, name, str_name, pr):
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    unreleased = changelog.split("## [Unreleased]", 1)[1].split("\n## ", 1)[0].strip() if "## [Unreleased]" in changelog else "No Unreleased section."
    unreleased = re.sub(r"\]\((?![a-z]+:|#|/)([^)]+)\)", r"](../../\1)", unreleased)
    a = d["archive"]
    g = d["gitleaks"]
    lines = [header(f"version description {name}", f"ENDOFORGE-{name}", d, pr)]
    lines += ["## 1. Identification", "", "| Item | Value |", "|---|---|",
              "| Name | endoforge |", "| Version | unreleased; `main` at the commit below |",
              f"| Tag | {', '.join(d['tags']) or 'none; no release tag has been created'} |",
              f"| Commit | `{d['commit']}` |", f"| Commit date | {d['commit_date']} |",
              f"| `experiment-id/*` reservation tags | {d['reservations']} (P-number reservations, not releases) |",
              "", "## 2. Contents", "",
              "Source only; nothing is built or packaged. Top-level contents: `core/` (lifecycle, ledger, engine, constraints, library, runtime), `tools/` (workflow tools and repository scripts), `tests/`, `experiments/` (precommitted measurements), `docs/`, `sources/` (digest manifest), `TODELETE/` (archived placeholders).",
              "", "## 3. Build and install", "",
              "There is no build step for the core. Prerequisites and commands are in the [README quickstart](../../README.md#quickstart) and [local checks](../guides/how-to/local-checks.md): `make tools` installs pinned kernel tools into `.tools/`; `make loop-setup` and `make tscheck-setup` run `npm ci` for the pinned compilers.",
              "", "## 4. Integrity", "", "| Item | SHA-256 | Notes |", "|---|---|---|",
              f"| `git archive --format=tar {d['commit'][:7]}` | `{a['sha256']}` | {a['bytes']} bytes, {a['files']} tracked files |"]
    lines += [f"| `{p}` | `{h}` | pinned or controlled input |" for p, h in d["pinned"]]
    lines += ["", "## 5. Changes", "", "No previous tag exists. CHANGELOG `[Unreleased]` section at this commit:", "",
              *["> " + line if line else ">" for line in unreleased.splitlines()], ""]
    if d["since"]:
        lines += [f"Merges since the previous documentation baseline ({len(d['since'])}):", "", "```text", *d["since"], "```", ""]
    lines += ["## 6. Open problems and workarounds", ""]
    open_issues = [i for i in d["issues"] or [] if i["state"] == "OPEN"]
    if d["issues"] is None:
        lines.append("GitHub issues were not queried.")
    elif open_issues:
        lines += ["| Issue | Labels | Title |", "|---|---|---|"]
        lines += [f"| #{i['number']} | {', '.join(label['name'] for label in i['labels']) or 'unlabelled'} | {i['title']} |" for i in open_issues]
    lines += ["", "Known defects found by documentation review are in the [assurance record](../assurance/assurance-record.md); untested behaviour is in [SRS §11](../requirements/requirements.md#11-untested-behaviour-requirement-gaps).",
              "", "## 7. Documentation baseline", "",
              f"Control documents in `docs/` were checked against main at `4d692a41853045c4e013405d8e674528745a38b9` and are contained in commit `{d['commit'][:7]}`. See the [documentation index](../README.md).",
              "", "## 8. Verification and scans", "",
              f"- Test report: [{str_name}](../verification/reports/{str_name}.md) (same commit).",
              f"- Privacy lint: {' '.join(d['privacy'])}.",
              f"- Secret scan: {g['summary'] + ' (' + g['version'] + ')' if g else 'not run'}. CI has no secret-scanning job.",
              static_analysis(d) + " Findings are in the [assurance record](../assurance/assurance-record.md).",
              "", history(d, pr)]
    return "\n".join(lines).replace("](../../plan/software-management-plan.md", "](../plan/software-management-plan.md")


def index(path, name, d):
    row = f"| [{name}]({name}.md) | `{d['commit'][:7]}` | {d['commit_date']} |"
    text = path.read_text(encoding="utf-8")
    kept = [line for line in text.splitlines() if not line.startswith(f"| [{name}]")]
    path.write_text("\n".join(kept + [row]) + "\n", encoding="utf-8")


def labelled_log(value):
    label, sep, path = value.partition("=")
    if not sep or not label or not path:
        raise argparse.ArgumentTypeError(f"expected LABEL=PATH, got {value!r}")
    return label, path


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate the test report (STR) and version description (VDD) from recorded make runs.")
    parser.add_argument("--name", required=True, help="record suffix, for example main-20261108")
    parser.add_argument("--pr", required=True, help="pull request that reviews the records")
    parser.add_argument("--log", action="append", required=True, type=labelled_log,
                        help="LABEL=PATH of a recorded make run; repeatable, at least one")
    parser.add_argument("--since", help="previous documentation baseline commit, for the merge list")
    parser.add_argument("--repo", default="Akilleez-QA/endoforge")
    parser.add_argument("--gitleaks", default=shutil.which("gitleaks"))
    args = parser.parse_args(argv)
    d = collect(args)
    str_name, vdd_name = f"STR-{args.name}", f"VDD-{args.name}"
    reports, releases = ROOT / "docs/verification/reports", ROOT / "docs/releases"
    (reports / f"{str_name}.md").write_text(str_report(d, str_name, args.pr), encoding="utf-8")
    (releases / f"{vdd_name}.md").write_text(vdd_report(d, vdd_name, str_name, args.pr), encoding="utf-8")
    index(reports / "README.md", str_name, d)
    index(releases / "README.md", vdd_name, d)
    failed = [r["label"] for r in d["runs"] if r["exit"] != 0 or r["totals"]["fail"]]
    print(json.dumps({"str": str_name, "vdd": vdd_name, "failed_runs": failed, "trace_problems": len(d["trace_problems"])}, sort_keys=True))
    return 1 if failed or d["trace_problems"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
