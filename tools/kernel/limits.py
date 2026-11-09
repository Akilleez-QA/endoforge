import base64
from dataclasses import asdict, dataclass
import json
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import tempfile
import time

from tools.kernel.contract import MAX_COMPONENT_BYTES
from tools.kernel.effects import EffectDenied, declaration


@dataclass(frozen=True)
class Limits:
    fuel: int = 100000
    memory_bytes: int = 16 * 1024 * 1024
    output_bytes: int = 1024 * 1024
    wall_seconds: float = 5.0

    def __post_init__(self):
        for name, lower, upper in (("fuel", 1, 10000000), ("memory_bytes", 65536, 16777216),
                                   ("output_bytes", 1, 1048576)):
            value = getattr(self, name)
            if type(value) is not int or not lower <= value <= upper:
                raise ValueError(f"{name} must be between {lower} and {upper}")
        if (type(self.wall_seconds) not in (int, float) or not math.isfinite(self.wall_seconds)
                or not 0.01 <= self.wall_seconds <= 60):
            raise ValueError("wall_seconds must be finite and between 0.01 and 60")


def _encode(value):
    if isinstance(value, bytes):
        return {"$bytes": base64.b64encode(value).decode("ascii")}
    raise TypeError("unsupported transport value")


def _decode(value):
    return base64.b64decode(value["$bytes"], validate=True) if set(value) == {"$bytes"} else value


def _watch(command, source, limits):
    started = time.monotonic_ns()
    deadline = started + int(limits.wall_seconds * 1e9)
    data = {"stdout": bytearray(), "stderr": bytearray()}
    total = 0
    reason = None
    killed = None
    process = subprocess.Popen(command, stdin=source, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True, cwd=Path(__file__).resolve().parents[2])
    try:
        try:
            with selectors.DefaultSelector() as selector:
                for name in data:
                    selector.register(getattr(process, name), selectors.EVENT_READ, name)
                while selector.get_map() or process.poll() is None:
                    remaining = (deadline - time.monotonic_ns()) / 1e9
                    if remaining <= 0:
                        reason = "timeout"
                        break
                    for key, _ in selector.select(min(remaining, 0.01)):
                        chunk = os.read(key.fd, min(65536, limits.output_bytes - total + 1))
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        available = limits.output_bytes - total
                        data[key.data].extend(chunk[:available])
                        total += len(chunk)
                        if total > limits.output_bytes:
                            reason = "output_limit"
                            break
                    if reason:
                        break
        finally:
            killed = time.monotonic_ns()
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=1)
        stopped = time.monotonic_ns()
        try:
            os.killpg(process.pid, 0)
            group_empty = False
        except ProcessLookupError:
            group_empty = True
    finally:
        process.stdout.close()
        process.stderr.close()
    header, _, payload = data["stdout"].partition(b"\n")
    try:
        execution_started = json.loads(header)["execution_started_ns"]
        if type(execution_started) is not int or not started <= execution_started <= stopped:
            execution_started = None
    except (ValueError, KeyError, TypeError):
        execution_started = None
    receipt = {
        "outcome": reason or "host_failed", "limits": asdict(limits),
        "pid": process.pid, "exit_code": process.returncode, "group_empty": group_empty,
        "output_bytes_observed": total, "output_bytes_retained": sum(map(len, data.values())),
        "wall_ns": stopped - started,
        "time_to_stop_ns": stopped - execution_started if execution_started else None,
        "time_to_kill_ns": stopped - killed if reason else None,
    }
    if reason is None and process.returncode == 0:
        try:
            response = json.loads(payload, object_hook=_decode)
            if response["outcome"] not in ("passed", "trapped", "denied", "host_failed"):
                raise ValueError("invalid host outcome")
            if response["outcome"] != "host_failed" and execution_started is None:
                raise ValueError("missing execution timestamp")
            receipt["outcome"] = response["outcome"]
            if response["outcome"] == "passed":
                receipt["result"] = response["result"]
            elif response["outcome"] == "denied":
                receipt["denials"] = response["denials"]
            elif "error" in response:
                receipt["error"] = response["error"]
        except (ValueError, KeyError, TypeError):
            receipt["outcome"] = "host_failed"
    if not group_empty:
        receipt["outcome"] = "cleanup_failed"
        receipt.pop("result", None)
    return receipt


def run_candidate(component, schemas, state, event, inputs=(), *, limits=Limits(), effects=None):
    if type(component) is not bytes or not 8 <= len(component) <= MAX_COMPONENT_BYTES:
        raise ValueError("component bytes required within 16 MiB limit")
    snapshots = tuple(inputs)
    if (len(snapshots) > 64 or any(type(b) is not bytes for b in (state, event, *snapshots))
            or sum(map(len, (state, event, *snapshots))) > 1048576):
        raise ValueError("immutable inputs required within 1 MiB and 64 buffers")
    if len(schemas) != 3 or any(type(s) is not str or not 1 <= len(s) <= 256 for s in schemas):
        raise ValueError("three bounded schema identities required")
    if effects is not None:
        declaration(effects)
    request = dict(component=component, schemas=schemas, state=state, event=event,
                   inputs=snapshots, limits=asdict(limits), effects=effects)
    with tempfile.TemporaryFile() as source:
        source.write(json.dumps(request, default=_encode).encode("ascii"))
        source.seek(0)
        return _watch([sys.executable, "-B", "-m", "tools.kernel.limits"], source, limits)


def _host():
    from wasmtime import WasmtimeError
    from tools.kernel.workcell import Workcell

    execution_started = None
    try:
        request = json.loads(sys.stdin.buffer.read(24 * 1024 * 1024), object_hook=_decode)
        limits = Limits(**request.pop("limits"))
        cell = Workcell(request.pop("component"), request.pop("schemas"), effects=request.pop("effects"))
        execution_started = time.monotonic_ns()
        print(json.dumps({"execution_started_ns": execution_started}), flush=True)
        result = cell.run(**request, fuel=limits.fuel, memory_bytes=limits.memory_bytes)
        response = {"outcome": "passed", "result": result}
    except EffectDenied as error:
        response = {"outcome": "denied", "denials": error.denials}
    except WasmtimeError as error:
        response = {"outcome": "trapped" if execution_started else "host_failed",
                    "error": str(error)[-512:]}
    except Exception as error:
        response = {"outcome": "host_failed", "error": str(error)[-512:]}
    if execution_started is None:
        print(json.dumps({"execution_started_ns": None}), flush=True)
    for chunk in json.JSONEncoder(default=_encode).iterencode(response):
        sys.stdout.write(chunk)
    sys.stdout.flush()


if __name__ == "__main__":
    _host()
