# P-49 `.tsbuildinfo` feedback between checks in a workcell: precommit

Label: **Proposed** procedure, frozen 2026-11-06 before measurement.

Question: each check runs in a fresh compiler instance over in-memory files. If the previous check's `.tsbuildinfo` is fed into the next one, does a one-file edit check faster, and do diagnostics still match a full check?

Method: one guarded thread with `tools/tscheck/pin.mjs` limits and one compiled module, on `medium/ill`, `medium/well`, `stress/ill`, `stress/well`, 5 reps. The workloads' files are read-only and each edit is applied to an in-memory copy. The full arm is today's check: `-p tsconfig.json --noEmit --pretty false` with `incremental: false` from the config. The incremental arm adds `--incremental --tsBuildInfoFile /proj/.tsbuildinfo`, and the previous step's written build info as an input file.

Sequence per rep, starting from one seed check, where the incremental arm carries its build info forward. Each step runs both arms on the same files:

1. `comment`: append a comment to a leaf file.
2. `body`: change a function body in the same file, with no declaration change.
3. `add-error`: append `export const bad: number = "x";` to the leaf.
4. `restore` the leaf.
5. `export-type`: change a field's type in the most-imported file's exported interface.
6. `restore` that file.
7. `syntax-error`: append an unparseable line to the leaf.
8. `restore` the leaf.
9. `options`: turn `strict` off in `tsconfig.json`.
10. `restore` the config.

Compare the exact multiset of file, line, column, code and message per step. Record wall time for both arms, build info size, and exit code.

Predictions:

1. Parity holds at every step of every rep. The compiler has content hashes to use even though the in-memory file system reports `mtimeNs: 0`.
2. On `stress/ill`, `comment` and `body` take at least 30% less time than a full check; on `medium/ill`, at least 15%. Each fresh instance has to parse everything again, so the reduction is limited to the checker's share.
3. `export-type` and `options` save less than `comment`.

Decision: ship a `buildInfo` option in `checker.mjs` only if prediction 1 holds with no difference at all, and a one-file edit saves at least 15% on both sizes. Any parity difference means nothing ships and the difference is recorded. The result reports either way.

Failure meaning: a parity difference is a failure of this technique on this compiler version, not of the checker, and is kept with the step named.

Limits: a shared desktop with no quiet gate, one host and Node as recorded, one compiler version. The edits are synthetic. Build info is fed back in memory, so this says nothing about a persistent cache's trust: a stale or forged file is a separate question.
