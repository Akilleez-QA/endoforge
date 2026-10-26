# Approved atoms (factory scale L1)

Job: `train-every-employee-on-ammonia-awareness`; the jobs board records ABI's
written brief. Happy path: approve one immutable atom, resolve its pinned value
across ABI, RETA, campus and service-forward, then find affected consumers on retirement.
Design target: 10,000 videos/day; this change does not establish render throughput.

From the repo root:
```sh
python3 -B -m forge.endoforge.tools.approved_atoms --store /tmp/atoms.jsonl add look.1 asset_look '"blue"' 'craig_signoff 2026-10-26'
python3 -B -m forge.endoforge.tools.approved_atoms --store /tmp/atoms.jsonl approve look.1 CONTENT_SHA256 --by craig
python3 -B tools/claim_gate.py --report report.md --ledger events.json --atoms /tmp/atoms.jsonl --atom-refs refs.json --consumer abi/scene-1
```
`refs.json` is a list of `{ "id": "look.1", "sha256": "CONTENT_SHA256" }`.
Use the digest returned by `add`; `get`, `consumers` and `retire ID SHA256` are
also CLI commands. `Registry.get`, `list_consumers`, and `resolve(refs, consumer)`
are the Python API. Resolve supplies values, never retype them in expressions.

JSONL contains `atom` snapshots and deduplicated `consumer` events. Content hashes
cover id, kind, value and provenance; changes need a new id and approval. Retirement
is terminal. Resolution checks the latest approval and every digest before recording
any consumer; historical consumers remain listed. Approval does not promote runtime
claims in the existing claim gate. Existing report/ledger callers remain compatible.

Local POSIX locks serialize writers/readers; fsync persists appends. A reused resolver
replays only the new tail and indexes ids and consumers in memory. Torn/corrupt records
fail closed and need operator recovery. The trusted operator supplies approver identity;
hashes are not signatures. Resolve again before each build; already built artifacts
are not recalled. Store files belong in trusted local state, not generated assets.

Subtract first: reuses `tools/claim_gate.py` (#24) for qualification and the parts-wall
number/claim approval pattern. Hillclimb fan-out, throttle/GPU admission and Foundation
Math's problem spec remain their existing owners' concerns; no scheduler is duplicated.
Check: `python3 -B -m unittest tests.test_approved_atoms tests.test_claim_gate -v`.
