# P-12 revision 2 — result

Complete, 18 October 2026. **Recorded (probe).** This revision supersedes revision 1's runner, preserving its frozen sources and receipts. Revision 2 adds ownership-token validation before every kill/removal, including fallback, plus input snapshot rehash before publication.

## What this does not show

No live agents, campaign recovery, cross-host restore, hostile-kernel security or directory artifact transfer. No SIGKILL, daemon loss, cleanup-command failure or power-loss recovery was injected. Persistent cleanup errors produce a failed result and require external reconciliation. The simulated start fault is a Docker-client error, not a real daemon startup failure. Publication is one atomic no-overwrite hard link; a crash after linking but before `result.json` can leave a publication without a final receipt. There is no crash-durable multi-file transaction. No concurrent scheduler was tested.

## Recorded evidence

All original checks passed again: success, worker exit 7, hung timeout, subprocess controller SIGINT, missing stdout, invalid stdout, tampered input, duplicate publication, and immutable attempt reuse. Additional create failure (`--pull=never` with missing immutable image) and injected client start failure passed cleanup checks without publication. A deliberately collided name belonging to a differently labelled container survived untouched; the runner returned `cleanup_failed` with ownership mismatch and never killed/removed it. The test then removed its own known fixture. Raw fixture inspect is in `receipt/collision-survival.json`.

Ten normal/failure attempts, one foreign collision and one reuse check passed in 5.75 seconds. Exactly one publication remains, frozen source input is unchanged, and final P-12-labelled container inventory is empty. A full-run rerun also refused without changing existing receipts (`receipt/runner-reuse.json`). `receipt/frozen-hashes.json` was written before measurement; sources/precommit still match. Each launched attempt retains commands, logs, terminal status, cleanup verification and outcome. Foreign-collision evidence explicitly reports cleanup failure rather than pretending the unrelated container was removed.

## API

Use **this revision's** `lifecycle.py:run_attempt`, not revision 1. Signature and stdout artifact contract are unchanged; see the parent result for details. The host owns trusted expected hashes, attempt evidence and publication directory. Workers receive only a read-only snapshot and bounded private scratch. Successful validation and terminal log/status capture precede removal verification, which precedes atomic publication. The host rehashes its snapshot before publication. Catchable signals set a flag; they cannot interrupt the `os.link` syscall with a Python exception. SIGINT during active execution was tested; interruption exactly at publication was not separately injected.

Reproduce in a fresh probe directory using this revision's PRECOMMIT.md, lifecycle.py, run.py, run.sh and setup.sh. `bash setup.sh` checks existing dependencies offline, then `bash run.sh`. Do not delete/reuse old receipts. These remain deterministic fault tests, not a campaign scheduler qualification.
