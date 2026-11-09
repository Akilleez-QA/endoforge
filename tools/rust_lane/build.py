import hashlib
import os
from pathlib import Path
import resource
import shutil
import signal
import subprocess
import tomllib

from tools.kernel.contract import WIT, check_tool, validate_component, wasm_tools
from core.ledger.ledger import encode

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parents[1]
TARGET = "wasm32-unknown-unknown"
FLAGS = "-C debuginfo=0 --remap-path-prefix={root}=/ef24"
VERSION = "rustc 1.98.1 (48a229cea 2026-09-01)"
MAX_SOURCE_BYTES = 4 * 1024 * 1024


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


def rust_tool(name):
    rustup = None if name.upper() in os.environ else shutil.which("rustup")
    if rustup is not None:
        located = subprocess.run([rustup, "which", name, "--toolchain", VERSION.split()[1]],
                                 capture_output=True, text=True, timeout=30)
        if located.returncode == 0:
            return Path(located.stdout.strip()).resolve()
    return executable(name)


def cargo_home():
    return Path(os.environ.get("CARGO_HOME") or Path.home() / ".cargo").resolve()


def prefer_checkout_wasm_tools():
    local = REPOSITORY / ".tools/bin/wasm-tools"
    if "WASM_TOOLS" not in os.environ and local.exists():
        os.environ["WASM_TOOLS"] = str(local)


def fetch_locked(cargo, env, cwd):
    try:
        run([str(cargo), "fetch", "--frozen"], env=env, cwd=cwd)
    except ValueError:
        run([str(cargo), "fetch", "--locked"], env=env, cwd=cwd)


def crate_sources(crate):
    crate = Path(crate).resolve()
    try:
        manifest = tomllib.loads((crate / "Cargo.toml").read_text())
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as error:
        raise ValueError("kernel crate needs a readable Cargo.toml") from error
    package = manifest.get("package")
    if type(package) is not dict or type(package.get("name")) is not str:
        raise ValueError("kernel crate needs a named package")
    library = manifest.get("lib", {})
    if "cdylib" not in library.get("crate-type", []):
        raise ValueError("kernel crate must build a cdylib")
    if "build" in package or (crate / "build.rs").exists() or "workspace" in manifest:
        raise ValueError("kernel crate may not have a build script or workspace")
    tables = [manifest.get("dependencies", {}), manifest.get("build-dependencies", {})]
    tables += [t.get("dependencies", {}) for t in manifest.get("target", {}).values()]
    for table in tables:
        for name, spec in table.items():
            if type(spec) is dict and spec.keys() & {"path", "git", "registry"}:
                raise ValueError(f"dependency {name} must come from crates.io through Cargo.lock")
    if not (crate / "Cargo.lock").is_file() or not (crate / "src/lib.rs").is_file():
        raise ValueError("kernel crate needs Cargo.lock and src/lib.rs")
    names = ["Cargo.toml", "Cargo.lock"]
    for path in sorted((crate / "src").rglob("*")):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError("kernel crate sources must be regular files")
        if path.is_file():
            names.append(path.relative_to(crate).as_posix())
    sources = {name: (crate / name).read_bytes() for name in names}
    if sum(map(len, sources.values())) > MAX_SOURCE_BYTES:
        raise ValueError("kernel crate sources exceed 4 MiB")
    return library.get("name", package["name"]).replace("-", "_"), sources


def build(destination, crate=ROOT):
    destination = Path(destination).resolve()
    library, sources = crate_sources(crate)
    prefer_checkout_wasm_tools()
    rustc = rust_tool("rustc")
    cargo = rust_tool("cargo")
    cache = cargo_home()
    env = dict(PATH=str(rustc.parent) + os.pathsep + os.defpath,
               CARGO_HOME=str(cache), RUSTC=str(rustc), CARGO_INCREMENTAL="0")
    version = run([str(rustc), "-vV"], env=env, cwd=ROOT).decode()
    if version.splitlines()[0] != VERSION:
        raise ValueError(f"{VERSION} required")
    check_tool()
    identity = dict(toolchain=version, library=library, rustc_sha256=sha(rustc.read_bytes()),
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
    fetch_locked(cargo, env, crate)
    run([str(cargo), "build", "--frozen", "--release", "--target", TARGET, "--jobs", "1"],
        env=env, cwd=crate)
    core = (destination / "target" / TARGET / "release" / f"{library}.wasm").read_bytes()
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
    parser.add_argument("--crate", type=Path, default=ROOT)
    args = parser.parse_args()
    print(encode(build(args.destination, args.crate)))
