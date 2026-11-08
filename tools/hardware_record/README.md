# Hardware record

`record.py` records the machine a measurement ran on, with read-only probes, and later checks that the record still applies.

## Usage

```
python3 -I tools/hardware_record/record.py collect <dir>
python3 -I tools/hardware_record/record.py validate <dir>
python3 -I tools/hardware_record/record.py check-current <dir>
```

- `collect` writes `precommit.json`, `before.json`, `controls.json`, `after.json` and `record.json`, and prints the status. It probes CPU, RAM, disks, OS, kernel, firmware, drivers, toolchain versions and boot id; checks CPU affinity; records cgroup, memory, pids, IO and network controls as unproven; runs a quiet-machine gate; and measures 20-sample noise baselines, pinned and unpinned. It took about 3 seconds here.
- `validate` checks the record against [schema.json](schema.json) and the receipt hashes, and prints the status.
- `check-current` also refuses a record older than 12 hours, one made by a different `record.py` or schema, a failed record, or one whose kernel, firmware, drivers, toolchain or boot id differ from now.

Status is `qualified-with-limits` or `failed`. A read-only probe can never produce `qualified`. Errors exit 1 with the reason. On the run above all three actions printed `qualified-with-limits`. The record contains the hostname, so keep it outside the source tree.

Records made from a source copy without revision metadata use a zero commit identifier and say so in `limits`. Each record still binds the probe source and schema by SHA-256. No environment variables are read.

## Tests

```
make hardware-test
```

Runs `tools/hardware_record/test_record.py` (8 tests).
