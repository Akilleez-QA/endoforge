# Hardware record

`record.py` records the machine a measurement ran on, using read-only probes, and later checks that the record still
describes the machine. EndoForge's experiments report throughput and latency numbers; a number without the machine,
kernel, drivers, toolchain and background noise it was measured under cannot be compared or repeated.

## How it works

- `collect <dir>` probes CPU, RAM, disks, OS, kernel, firmware, drivers, toolchain versions and boot id; checks CPU
  affinity; records cgroup, memory, pids, IO and network controls as unproven configuration; runs a quiet-machine gate;
  and measures 20-sample noise baselines, pinned and unpinned. It writes `precommit.json`, `before.json`,
  `controls.json`, `after.json` and `record.json`.
- `validate <dir>` checks the record against [schema.json](schema.json) and the receipt hashes.
- `check-current <dir>` also refuses a record older than 12 hours, one made by a different `record.py` or schema, a
  failed record, or one whose kernel, firmware, drivers, toolchain or boot id differ from now.

Each prints the status, `qualified-with-limits` or `failed`. A read-only probe can never produce `qualified`. Errors
exit 1 with the reason.

## Example

```console
$ python3 -I tools/hardware_record/record.py collect /tmp/hw
qualified-with-limits
$ python3 -I tools/hardware_record/record.py check-current /tmp/hw
qualified-with-limits
$ ls /tmp/hw
after.json  before.json  controls.json  precommit.json  record.json
$ python3 -c "import json; print(json.load(open('/tmp/hw/record.json'))['limits'][0])"
Read-only inventory and diagnostic jitter only; no production isolation qualification.
```

`collect` took about 3 seconds. The record contains the hostname, so keep it outside the source tree.

## Limits

- It observes; it does not enforce. Memory, pids and controller settings are recorded as configuration, and their
  enforcement is untested. Network denial, sustained thermal behaviour and firmware or driver completeness remain
  unqualified (the record's own `limits` field says so).
- Records made from a source copy without revision metadata use a zero commit id and say so in `limits`; each record
  still binds the probe source and schema by SHA-256.
- No environment variables are read.

## Tests

`make hardware-test` runs `test_record.py` (8 tests).

Engineering record: component C-21, requirement REQ-HW-001.
