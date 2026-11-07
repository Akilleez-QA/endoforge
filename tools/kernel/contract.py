import hashlib
import json
import os
from pathlib import Path
import subprocess

from core.ledger.ledger import encode


WIT = Path(__file__).with_name("kernel.wit").read_bytes()
TOOL_VERSION = "1.262.0"
CONTRACT_VERSION = "1.0.0"
MAX_COMPONENT_BYTES = 16 * 1024 * 1024


def wasm_tools(*args, data=None):
    try:
        result = subprocess.run(
            [os.environ.get("WASM_TOOLS", "wasm-tools"), *args],
            input=data, capture_output=True, timeout=10, check=True,
        )
    except (OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as error:
        raise ValueError(f"wasm-tools failed: {' '.join(args)}") from error
    return result.stdout


def check_tool():
    version = wasm_tools("--version").decode().split()
    if version[:2] != ["wasm-tools", TOOL_VERSION]:
        raise ValueError(f"wasm-tools {TOOL_VERSION} required")


def interface_shape(document):
    budget = 10000

    def interface_name(index):
        interface = document["interfaces"][index]
        package = document["packages"][interface["package"]]["name"]
        return f"{package}/{interface['name']}"

    def expand(value, depth=0):
        nonlocal budget
        budget -= 1
        if depth > 64 or budget < 0:
            raise ValueError("interface complexity limit exceeded")
        if type(value) is int:
            definition = document["types"][value]
            kind = definition["kind"]
            if kind == "resource":
                owner = interface_name(definition["owner"]["interface"])
                return {"resource": f"{owner}/{definition['name']}"}
            if isinstance(kind, dict) and set(kind) == {"type"}:
                return expand(kind["type"], depth + 1)
            return expand(kind, depth + 1)
        if isinstance(value, list):
            return [expand(item, depth + 1) for item in value]
        if isinstance(value, dict):
            return {key: expand(item, depth + 1) for key, item in value.items()}
        return value

    if len(document["worlds"]) != 1:
        raise ValueError("exactly one kernel world required")
    shape = {}
    for direction in ("imports", "exports"):
        entries = {}
        for key, item in document["worlds"][0][direction].items():
            if set(item) != {"interface"}:
                raise ValueError(f"undeclared {direction}: {key}")
            index = item["interface"]["id"]
            if key != f"interface-{index}":
                raise ValueError(f"noncanonical {direction}: {key}")
            interface = document["interfaces"][index]
            name = interface_name(index)
            if name in entries:
                raise ValueError("duplicate interface")
            entries[name] = expand({field: interface[field] for field in ("types", "functions")})
        shape[direction] = entries
    return shape


def validate_component(component):
    if type(component) is not bytes or not 8 <= len(component) <= MAX_COMPONENT_BYTES:
        raise ValueError("component bytes required within 16 MiB limit")
    if component[:8] != b"\x00asm\x0d\x00\x01\x00":
        raise ValueError("Component Model binary required")
    check_tool()
    wasm_tools("validate", "-", data=component)
    expected = interface_shape(json.loads(wasm_tools("component", "wit", "--json", data=WIT)))
    observed = interface_shape(json.loads(wasm_tools("component", "wit", "--json", data=component)))
    for direction in ("imports", "exports"):
        if observed[direction] != expected[direction]:
            raise ValueError(f"kernel {direction} differ from declared WIT contract")
    record = {
        "version": 1, "contract_version": CONTRACT_VERSION,
        "world": "endoforge:kernel/kernel@1.0.0",
        "component_sha256": hashlib.sha256(component).hexdigest(),
        "wit_sha256": hashlib.sha256(WIT).hexdigest(),
        "validator": f"wasm-tools/{TOOL_VERSION}", "validation": "static-interface-only",
    }
    return {"id": hashlib.sha256(encode(record).encode("ascii")).hexdigest(), **record}


def validate_artifact(record, component):
    expected = validate_component(component)
    if encode(record) != encode(expected):
        raise ValueError("artifact record differs; revalidation required")
    return expected


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("component", type=Path)
    args = parser.parse_args()
    try:
        with args.component.open("rb") as source:
            print(encode(validate_component(source.read(MAX_COMPONENT_BYTES + 1))))
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
