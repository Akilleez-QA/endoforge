import argparse
import hashlib
import os
import platform
import subprocess
import sys
import tarfile
import urllib.request
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / ".tools"
REQUIREMENTS = Path(__file__).with_name("requirements.txt")
WASMTIME_VERSION = "49.0.0"
WASM_TOOLS_VERSION = "1.262.0"
WASM_TOOLS_RELEASE = f"https://github.com/bytecodealliance/wasm-tools/releases/download/v{WASM_TOOLS_VERSION}"
WASM_TOOLS_ARCHIVES = {
    ("Linux", "x86_64"): ("x86_64-linux", "655b8df67d54c3ef9b52fc237c4e94bbfbb5f5f43825245cb0940a7002a9ed65"),
}


def platform_key():
    return platform.system(), platform.machine()


def wasm_tools_version(executable=None):
    executable = executable or os.environ.get("WASM_TOOLS", "wasm-tools")
    try:
        result = subprocess.run([str(executable), "--version"], capture_output=True, timeout=10, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.decode(errors="replace").strip()


def check():
    problems = []
    try:
        found = version("wasmtime")
    except PackageNotFoundError:
        found = None
    if found != WASMTIME_VERSION:
        problems.append(f"Python wasmtime {WASMTIME_VERSION} (found {'wasmtime ' + found if found else 'none'} for {sys.executable})")
    tool = wasm_tools_version()
    if (tool or "").split()[:2] != ["wasm-tools", WASM_TOOLS_VERSION]:
        problems.append(f"wasm-tools {WASM_TOOLS_VERSION} (found {tool or 'none'})")
    if problems:
        print("kernel-test needs the CI-pinned kernel tools: " + "; ".join(problems), file=sys.stderr)
        print("Run `make tools` to install them into .tools/ (one network fetch, hash-checked).", file=sys.stderr)
    return bool(problems)


def download(url, destination):
    with urllib.request.urlopen(url, timeout=60) as response, destination.open("wb") as output:
        while chunk := response.read(1 << 20):
            output.write(chunk)


def install_wasm_tools(tools=TOOLS):
    binary = tools / "bin" / "wasm-tools"
    if (wasm_tools_version(binary) or "").split()[:2] == ["wasm-tools", WASM_TOOLS_VERSION]:
        return binary
    system, machine = platform_key()
    if (system, machine) not in WASM_TOOLS_ARCHIVES:
        raise ValueError(f"no pinned wasm-tools {WASM_TOOLS_VERSION} archive for {system} {machine}")
    target, digest = WASM_TOOLS_ARCHIVES[system, machine]
    stem = f"wasm-tools-{WASM_TOOLS_VERSION}-{target}"
    cache = tools / "dl"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"{stem}.tar.gz"
    partial = archive.with_suffix(".part")
    download(f"{WASM_TOOLS_RELEASE}/{stem}.tar.gz", partial)
    actual = hashlib.sha256(partial.read_bytes()).hexdigest()
    if actual != digest:
        partial.unlink()
        raise ValueError(f"wasm-tools archive SHA-256 mismatch: expected {digest}, got {actual}")
    partial.replace(archive)
    with tarfile.open(archive) as bundle:
        member = bundle.extractfile(f"{stem}/wasm-tools")
        binary.parent.mkdir(parents=True, exist_ok=True)
        staged = binary.with_suffix(".part")
        staged.write_bytes(member.read())
    staged.chmod(0o755)
    staged.replace(binary)
    archive.unlink()
    return binary


def install_wasmtime(tools=TOOLS):
    venv = tools / "venv"
    python = venv / "bin" / "python"
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
    probe = "import importlib.metadata as m; print(m.version('wasmtime'))"
    installed = subprocess.run([str(python), "-c", probe], capture_output=True, text=True)
    if installed.stdout.strip() != WASMTIME_VERSION:
        subprocess.run([
            str(python), "-m", "pip", "install", "--disable-pip-version-check", "--no-deps",
            "--only-binary=:all:", "--require-hashes", "-r", str(REQUIREMENTS),
        ], check=True)
    return python


def main(argv=None):
    parser = argparse.ArgumentParser(description="Install or check the CI-pinned kernel test tools.")
    parser.add_argument("--check", action="store_true", help="check the current environment instead of installing")
    args = parser.parse_args(argv)
    if args.check:
        return check()
    python = install_wasmtime()
    binary = install_wasm_tools()
    print(f"kernel tools ready: {python} (wasmtime {WASMTIME_VERSION}), {binary} ({WASM_TOOLS_VERSION})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
