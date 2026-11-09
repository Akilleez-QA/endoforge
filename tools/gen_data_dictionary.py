import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "docs/data/data-dictionary.md"
LEDGER = "core/ledger/record.schema.json"
HARDWARE = "tools/hardware_record/schema.json"
FACTORY = sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "tools/factory_runtime/schemas/v1").glob("*.json"))
DISCLAIMER = (
    "> Organized after [NPR 7150.2D](https://nodis3.gsfc.nasa.gov/displayAll.cfm?Internal_ID=N_PR_7150_002D_&page_name=all), "
    "[NASA-STD-8739.8B](https://standards.nasa.gov/standard/nasa/nasa-std-87398) and the "
    "[NASA Software Engineering Handbook](https://swehb.nasa.gov/display/SWEHBVD/7.18+-+Documentation+Guidance) "
    "documentation guidance. This is not a NASA compliance determination or certification. The software "
    "classification is a self-assessed analog (Class E, not safety-critical); no NASA authority, independent "
    "verification and validation, or hazard analysis is asserted. The document describes the implementation "
    "inspected at the baseline commit."
)

HEAD = f"""# EndoForge data dictionary

| Field | Value |
|---|---|
| Document ID | ENDOFORGE-DD |
| Version | 1.0 |
| Status | Baselined |
| Owner | Akilleez-QA maintainer |
| Date | 2026-11-08 |
| Baseline commit | 4d692a41853045c4e013405d8e674528745a38b9 |
| Applies to | endoforge main at baseline commit |
| Classification | Self-assessed Class E analog; not safety-critical (see [SMP §1](../plan/software-management-plan.md#1-software-classification-self-assessed)) |

{DISCLAIMER}

This dictionary defines the data EndoForge reads, writes and exchanges. Sections 3 to 5 are generated from the
schema files by `python3 -I tools/gen_data_dictionary.py`; `make check` runs it with `--check` and fails when this file
differs from the schemas. Do not edit those sections by hand. Hardware channels, telemetry, rate groups and recorder
formats are N/A: EndoForge has no hardware interface.

## 1. Conventions

- Identifiers are text; digests are lowercase hexadecimal SHA-256 (64 characters).
- Durations are milliseconds where a name ends in `Ms` and seconds where it ends in `Sec`; sizes are MiB where a name
  ends in `Mb`. These suffixes are the code's convention (see the [configuration reference](../configuration/configuration-reference.md)).
- "Unknown" outcomes are never passes: `outcome_unknown` delivery state and `inconclusive` outcome state.

## 2. Configuration, interfaces and outcome codes

| Data | Defined in |
|---|---|
| Environment variables (every variable the code reads; checked by `tools/check_trace.py`) | [Configuration reference](../configuration/configuration-reference.md#environment-variables) |
| X1 agent `limits` keys | [Configuration reference](../configuration/configuration-reference.md#x1-agent-limits) |
| Options objects (`createLoopPool`, `IsolatePool`, contained runner, transports, governor, capacity, stage rates, kernel limits) | [Configuration reference](../configuration/configuration-reference.md#options-objects) |
| Workcell pool results, X1 host, generator and promotion records | [Ledger ICD](../interfaces/ledger-icd.md) |
| Capacity probe and plan records | [Capacity ICD](../interfaces/capacity-icd.md#probe-record) |
| Constraint records | [Constraint record](../interfaces/constraint-record.md) |
| Names Cstack calls | [Cstack ICD](../icd/icd-cstack.md#interface) |

Process exit codes shared across tools (`tools/lib/errors.mjs`, `core/runtime/subscription-guard.mjs`,
`core/runtime/usage-governor.mjs`, `core/runtime/agent-pool.mjs`):

| Exit | Meaning | Caller action |
|---|---|---|
| 0 | Success | — |
| 2 | Usage error (for example no Codex binary found by the agent pool) | Fix the invocation |
| 75 | Transient: a busy guard, a spawn-rate refusal, or a parked model call (`USAGE_PARKED`) | Wait and retry later; never count as a failed candidate |
| 78 | Stop: configuration refused (for example a non-subscription login) or torn state | Fix the configuration; do not retry |
| other | Failure | Investigate |
"""


def kind(node, defs):
    if "$ref" in node:
        name = node["$ref"].rsplit("/", 1)[-1]
        target = defs.get(name, {})
        if name in ("text", "nonblank"):
            return "text" + (", not blank" if name == "nonblank" else "")
        return f"object `{name}`" if target.get("type") == "object" else kind(target, defs)
    if "enum" in node:
        return "one of " + ", ".join(f"`{json.dumps(v)}`" for v in node["enum"])
    if node is False:
        return "absent"
    t = node.get("type", "any")
    if t == "array":
        return f"array of {kind(node.get('items', {}), defs)}" + (", unique" if node.get("uniqueItems") else "")
    extra = []
    for key in ("pattern", "minLength", "maxLength", "minimum", "maximum"):
        if key in node:
            extra.append(f"{key} `{node[key]}`")
    return t + (" (" + ", ".join(extra) + ")" if extra else "")


def object_table(name, node, defs):
    rows = ["| Field | Type | Required |", "|---|---|---|"]
    required = set(node.get("required", []))
    for field, spec in node.get("properties", {}).items():
        rows.append(f"| `{field}` | {kind(spec, defs) if spec is not False else 'absent'} | {'yes' if field in required else 'no'} |")
    return [f"#### `{name}`", "", *rows, ""]


def ledger_section():
    schema = json.loads((ROOT / LEDGER).read_text())
    defs = schema["$defs"]
    lines = ["## 3. Ledger records (generated)", "", f"Source: `{LEDGER}` ({schema.get('title', '')}). A record has "
             "these top-level fields; `data` takes the shape named by `kind`. Version 1 records require `provenance` "
             "and `license`; version 0 records must not carry them.", ""]
    lines += object_table("record", schema, defs)
    for name, node in defs.items():
        if node.get("type") == "object":
            lines += object_table(name, node, defs)
    return lines


def hardware_section():
    schema = json.loads((ROOT / HARDWARE).read_text())
    lines = ["## 4. Hardware record (generated)", "", f"Source: `{HARDWARE}` (schema `{schema['schema']}`). Types are "
             "Python type names checked by `tools/hardware_record/record.py`.", "",
             "| Field | Type |", "|---|---|"]
    lines += [f"| `{k}` | {v} |" for k, v in schema["required"].items()]
    lines += ["", "| `identity` field | Type |", "|---|---|"]
    lines += [f"| `{k}` | {v} |" for k, v in schema["identity"].items()]
    lines += ["", f"- `status`: one of {', '.join(f'`{s}`' for s in schema['statuses'])}.",
              f"- `controls` keys: {', '.join(f'`{c}`' for c in schema['controls'])}.",
              f"- Receipt files: {', '.join(f'`{c}`' for c in schema['receipt_files'])}.",
              f"- A change in any of {', '.join(f'`{c}`' for c in schema['reopen_on'])} reopens the record.", ""]
    return lines


def factory_section():
    lines = ["## 5. Factory runtime schemas (generated)", "", "Sources: `tools/factory_runtime/schemas/v1/`. "
             "`tools/factory_runtime/test_runtime_gaps.py` checks that these files match the runtime's validators "
             "(REQ-FACTORY-003).", ""]
    for relative in FACTORY:
        schema = json.loads((ROOT / relative).read_text())
        lines += object_table(Path(relative).name, schema, schema.get("$defs", {}))
    return lines


def render():
    tail = ["## Change history", "", "| Version | Date | Commit | Change | Reviewed in |", "|---|---|---|---|---|",
            "| 1.0 | 2026-11-08 | `4d692a4` | Initial dictionary; generated schema sections | this PR |", ""]
    return HEAD + "\n" + "\n".join(ledger_section() + hardware_section() + factory_section() + tail)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    text = render()
    if argv[:1] == ["--check"]:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != text:
            print("docs/data/data-dictionary.md is stale; run python3 -I tools/gen_data_dictionary.py")
            return 1
        print("data dictionary current")
        return 0
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
