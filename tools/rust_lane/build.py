import hashlib
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess

from tools.kernel.contract import WIT, check_tool, validate_component, wasm_tools
from core.ledger.ledger import encode

ROOT = Path(__file__).resolve().parent
TARGET = "wasm32-unknown-unknown"
FLAGS = "-C debuginfo=0 --remap-path-prefix={root}=/ef24"
VERSION = "rustc 1.98.1 (48a229cea 2026-09-01)"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(command, *, env, cwd):
    def limits():
        os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
        resource.setrlimit(resource.RLIMIT_AS, (4 * 1024**3,) * 2)
        resource.setrlimit(resource.RLIMIT_CPU, (120,) * 2)
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, start_new_session=True, preexec_fn=limits)
    try:
        out, err = process.communicate(timeout=180)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise ValueError("native build timed out") from None
    if process.returncode:
        raise ValueError(err.decode(errors="replace"))
    return out


def executable(name):
    path = shutil.which(os.environ.get(name.upper(), name.replace("_", "-")))
    if path is None:
        raise ValueError(f"{name} executable required")
    return Path(path).resolve()


def build(destination):
    destination = Path(destination).resolve()
    rustc = executable("rustc")
    cargo = executable("cargo")
    cache = Path(os.environ["CARGO_HOME"]).resolve()
    env = dict(PATH=str(rustc.parent) + os.pathsep + os.defpath,
               CARGO_HOME=str(cache), RUSTC=str(rustc), CARGO_INCREMENTAL="0")
    version = run([str(rustc), "-vV"], env=env, cwd=ROOT).decode()
    if version.splitlines()[0] != VERSION:
        raise ValueError(f"{VERSION} required")
    check_tool()
    sources = {name: (ROOT / name).read_bytes() for name in ("Cargo.toml", "Cargo.lock", "src/lib.rs")}
    identity = dict(toolchain=version, rustc_sha256=sha(rustc.read_bytes()),
                    cargo_sha256=sha(cargo.read_bytes()), target=TARGET, flags=FLAGS,
                    source_sha256={name: sha(data) for name, data in sources.items()},
                    wit_sha256=sha(WIT), wasm_tools_sha256=sha(executable("wasm_tools").read_bytes()),
                    wasm_tools=wasm_tools("--version").decode().strip())
    identity["recipe_sha256"] = sha(Path(__file__).read_bytes())
    key = sha(encode(identity).encode("ascii"))
    destination.mkdir(parents=True, exist_ok=False)
    crate = destination / "rust_lane"
    for name, data in sources.items():
        path = crate / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    wit = destination / "kernel" / "kernel.wit"
    wit.parent.mkdir()
    wit.write_bytes(WIT)
    env["RUSTFLAGS"] = FLAGS.format(root=destination)
    env["CARGO_TARGET_DIR"] = str(destination / "target")
    run([str(cargo), "build", "--frozen", "--release", "--target", TARGET, "--jobs", "1"],
        env=env, cwd=crate)
    core = (destination / "target" / TARGET / "release" / "ef24_kernel.wasm").read_bytes()
    component = wasm_tools("component", "new", "-", data=core)
    artifact = validate_component(component)
    receipt = dict(lane="rust-native", build_key=key, inputs=identity, artifact=artifact,
                   qualification="required", core_sha256=sha(core))
    (destination / "kernel.core.wasm").write_bytes(core)
    (destination / "kernel.wasm").write_bytes(component)
    (destination / "build.json").write_text(encode(receipt) + "\n")
    return receipt


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(encode(build(args.destination)))
