import json
import os
from pathlib import Path
import subprocess
import sys

from core.ledger.ledger import encode
from tools.kernel.conformance import task as frozen_task, task_sha256
from tools.kernel.journal import DenialJournal
from tools.rust_lane.build import REPOSITORY, build, prefer_checkout_wasm_tools


TASKS = Path(__file__).resolve().parent / "tasks"


class AdmissionRejected(ValueError):
    def __init__(self, record):
        self.record = record
        super().__init__(record["reason"])


def kernel_python():
    local = REPOSITORY / ".tools/venv/bin/python"
    return str(local) if local.exists() else sys.executable


def load_task(path):
    return frozen_task(json.loads(Path(path).read_text()))


def conform(component_path, task, journal_path):
    prefer_checkout_wasm_tools()
    request = {"component": str(Path(component_path).resolve()), "task": task,
               "journal": str(Path(journal_path).resolve())}
    env = dict(os.environ)
    tools = REPOSITORY / ".tools/bin"
    if tools.is_dir():
        env["PATH"] = str(tools) + os.pathsep + env.get("PATH", os.defpath)
    result = subprocess.run([kernel_python(), "-B", "-m", "tools.kernel.conformance"],
                            input=json.dumps(request), capture_output=True, text=True,
                            timeout=300, cwd=REPOSITORY, env=env)
    if result.returncode:
        raise ValueError(f"kernel host failed: {result.stderr[-512:]}")
    return json.loads(result.stdout)


def _reject(journal, task, reason, **details):
    record = {"kind": "admission", "lane": "rust-native", "task": task["id"],
              "task_sha256": task_sha256(task), "reason": reason, **details}
    journal.append(record)
    raise AdmissionRejected(record)


def admit(crate, task_path, destination, journal_path):
    task = load_task(task_path)
    journal = DenialJournal(journal_path)
    destination = Path(destination).resolve()
    try:
        receipt = build(destination, crate)
    except (OSError, ValueError) as error:
        _reject(journal, task, "build-failed", error=str(error)[-512:])
    try:
        report = conform(destination / "kernel.wasm", task, journal_path)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        _reject(journal, task, "kernel-host-failed", artifact_id=receipt["artifact"]["id"],
                error=str(error)[-512:])
    if not report["passed"] or report.get("artifact") != receipt["artifact"]:
        failed = [row["name"] for row in report["cases"] if row["outcome"] != "passed"]
        _reject(journal, task, "conformance-failed", artifact_id=receipt["artifact"]["id"],
                failed_cases=failed[:64], refused=report.get("refused"))
    record = {"lane": "rust-native", "status": "admitted", "task": task["id"],
              "task_sha256": report["task_sha256"], "build_key": receipt["build_key"],
              "artifact": receipt["artifact"],
              "effect_declaration_sha256": report["effect_declaration_sha256"],
              "cases": [row["name"] for row in report["cases"]],
              "qualification": "required"}
    (destination / "admission.json").write_text(encode(record) + "\n")
    return record


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("crate", type=Path)
    parser.add_argument("task", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--journal", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(encode(admit(args.crate, args.task, args.destination, args.journal)))
    except AdmissionRejected as error:
        parser.exit(1, encode(error.record) + "\n")
