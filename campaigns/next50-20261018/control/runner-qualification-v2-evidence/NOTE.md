# Runner qualification v2 refresh

This packet copies current qualification receipts and runtime/campaign source bytes after the comparison. It preserves runner-qualification.json as v1, including the expected historical mismatch where a reusable state-recovery receipt was subsequently regenerated. The current state receipt, latest local-journal-0b4796f5 qualification and general CLI summary/result are immutable copies here.

The source manifest states what code exists now. It does not assert every current source line was frozen, measured or qualified before the comparison. Existing test and live evidence retains its original scope and timing. The parent reported the latest make factory-check passed; this packaging pass adds hash/immutability/ownership checks and no model calls. Current31-check model-journal result and source-matching manifest are copied.

Files are separate byte copies, content-hashed and owner-read-only. This is accidental-mutation protection under a trusted host, not irreversible storage. Original mutable receipts are not rewritten. Run python verify.py from this folder to validate all snapshot hashes, the unchanged v1 packet, chronology disclosure and recorded stopped-resource inventory.

Generation ownership recovery used an actual controller kill around a deterministic-test worker in the final declared role wrapper. It did not kill or resume an in-flight hosted Codex request. The separate compile/publication recovery used a genuinely live-generated frozen candidate in Docker. Remote request outcomes remain unknown after an uncertain interruption; no implicit retry is inferred.
