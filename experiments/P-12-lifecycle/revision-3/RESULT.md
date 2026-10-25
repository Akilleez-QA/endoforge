# P-12 revision 3: controller crash reconciliation

Complete, 18 October 2026. **Recorded (probe).** The bounded SIGKILL/reconciliation qualification passed in 2.22 seconds. Revisions 1 and 2 retain their original sources and receipts.

## What this does not show

The external supervisor must establish controller death and call reconciliation. This is an explicit API and a tested supervising subprocess, not a persistent service or campaign integration. Never reconcile a live controller: no distributed lease prevents that misuse. No power cut, daemon outage, filesystem failure, cross-host restore, credentialed agent, eval-quality correction, arbitrary output directory or multi-host scheduling was tested. Catchable-signal/ordinary lifecycle checks are in revision 2; revision 3 specifically tests hard-kill recovery.

Journal writes fsync the file and containing directory, and fsync the root after creating the journals directory. This requests local filesystem durability, without proving physical storage persistence or durability of newly created ancestor trees. Published artifact bytes, publication-directory entries and final/recovery receipts are not one fsynced transaction. A matching recovered artifact proves an existing job artifact meets the trusted expected digest; it does not identify which attempt originally published it. Host ownership remains trusted, and a host user can alter journals.

## Recorded results

| Fault or recovery | Result |
|---|---|
| SIGKILL after controller recorded successful Docker start | Controller exit −9; container remained running, confirmed by independent inspect |
| External reconciliation after confirmed controller death | Token matched journal; worker killed; terminal state/logs captured; container removed; no uncertain output published |
| Retry same unpublished job under new attempt | Trusted digest validation passed; exactly one job publication |
| Simulated crash after atomic link, before final result write | Exit 88; publication present; final attempt result absent |
| Reconcile existing publication | Trusted journal digest matched artifact; recorded `publication_recovered`, without another link |
| Repeat reconciliation | Same recovered state; publication hashes/count unchanged |
| Malformed identifier/token journal | Rejected before Docker operations or reconciliation receipt creation |

Final inventory contained zero P-12 containers. There are two distinct job artifacts: one recovered after a retry of the hard-killed job and one recovered from the simulated link-before-receipt crash. Neither job was published twice. `receipt/summary.json`, controller receipts and individual reconciliation command/log/status receipts retain raw evidence. `receipt/frozen-hashes.json` was written before measurement and still matches the precommit and scripts; environment before/after records host and Docker details.

## API and operating contract

`lifecycle.py:run_attempt(...)` retains revision 2's signature, output validation, unique names, token-checked cleanup and atomic no-overwrite publication. It now calls `recovery.py:journal_before_create(...)` before Docker creation. The trusted journal contains attempt/job identifiers, unpredictable owner token, exact container name and expected artifact SHA-256. Existing journal names refuse reuse.

`recovery.py:reconcile(root, attempt)` reads one requested journal. It validates its fields, inspects only its exact container, and requires the journal owner token before any container kill/removal. Ownership mismatch fails without touching the container. It never performs global-label deletion. A daemon failure cannot be mistaken for successful absence because an independent Docker inventory command must succeed. Original attempt receipts are preserved; each reconciliation receives a new receipt directory.

After confirmed cleanup, absent publication becomes `interrupted_reconciled`, permitting retry under a new attempt. Staged files and worker logs are never promoted during recovery. If the job publication already exists and matches the trusted expected digest, reconciliation records `publication_recovered`; a mismatch fails closed. It does not replace or duplicate existing artifacts. The supervisor can inspect the returned outcome and receipt location. This closes the tested controller-death orphan-container gap while keeping supervision and campaign scheduling outside this probe.

To reproduce, copy this revision's PRECOMMIT.md, lifecycle.py, recovery.py, run.py, run.sh and setup.sh into a fresh directory, run `bash setup.sh`, then `bash run.sh`. Existing receipts are never reused or removed. The only dependencies are Python and the already available immutable P-09 Docker image, checked offline.
