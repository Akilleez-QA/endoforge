# Main-rig hardware record (EF-04)

Run from `forge/endoforge` with Python 3.10+ on Linux:

```sh
python3 -B -m unittest tools.hardware_record.test_record -v
python3 -B tools/hardware_record/record.py collect campaigns/ef-04-hwrecord/new-receipt
python3 -B tools/hardware_record/record.py validate campaigns/ef-04-hwrecord/receipt-current
python3 -B tools/hardware_record/record.py check-current campaigns/ef-04-hwrecord/receipt-current
```

Collection refuses an existing directory. It reads only allowlisted system metadata and version commands, excluding serials, UUIDs, environment dumps and credentials. Only its own process/child CPU affinity changes; receipts are its only filesystem writes. The stdlib schema in `schema.json` declares exact required fields/types, statuses, controls and reopening keys; it is not JSON Schema. `validate` checks receipt hashes, field types, identity provenance, control claims and recomputes gate/statistics. `check-current` additionally compares kernel, firmware, available module versions, runtime/toolchain results and boot ID, rejects changed collector/schema bytes and expires after 12 hours. A campaign runner must invoke it before reuse; this packet adds no runner integration.

The precommit fixes thresholds and sample sizes before measurement. Five 200 ms aggregate CPU windows gate mean ≤2 busy hardware threads, peak ≤4 and available memory ≥4 GiB. This narrower diagnostic gate excludes PSI, per-core occupancy, process attribution and thermal limits; it is not the full lab gate. Two interleaved arms use one allowed CPU versus the original allowed CPU set, with one warmup and 20 samples per kernel: sum 20,000 squares, allocate 1 MiB, and start an isolated Python process. CV uses sample standard deviation / mean; p95 uses nearest rank. A capacity guard refuses sampling below 256 MiB available or load1 above twice the allowed CPU count; allocations and subprocesses are bounded. No synthetic background load or machine configuration is applied.

`receipt-current/record.json` is the current Recorded inventory; every identity field cites its hashed `before.json` receipt. Main-rig has a Ryzen 9 7950X, 16 cores / 32 logical CPUs, 134,143,905,792 usable RAM bytes, Omarchy and kernel 7.2.8-9-omarchy. `disks` lists all block devices, including empty removable readers and zram; do not sum it as physical disk capacity. Firmware, available drivers and exact tool versions/errors are retained in the receipt. RAM is MemTotal, not a DIMM inventory. Instantaneous temperatures do not qualify sustained thermal behaviour.

WP03(a,c): hashes, receipt pointers and explicit `qualified-with-limits` status. WP03(b): affinity is empirically set and read back in a child; controller/limit/io availability are observations, and memory/PID/network enforcement remains untested. No production isolation qualification is claimed. WP03(d): `check-current` supplies the comparison boundary; runner integration and invisible firmware/driver changes remain gaps. WP01(e): both gate outcomes and 120 raw noise samples are recorded; the final collection passed both quiet gates. C1–C7, sustained bandwidth and power analysis are outside this calibration subset. `receipt/` and `receipt-final/` retain earlier collections before correcting the systemd version command and failed-record admission respectively; use `receipt-current/` for reuse.
