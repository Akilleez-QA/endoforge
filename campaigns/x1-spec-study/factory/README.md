# Dark-factory run on the X1 pool

Discover need → specify → generate → qualify → persona-check → promote, with no person in the loop. The needs are the frozen X1 pool (real requests; see `../receipt/freeze.json`). One fresh agent per request does the rest; the gates are fixed code (`gate.mjs`) that the agent cannot change. Since the persona review of 2026-10-17 (L-13), **promoted means gated and persona-accepted**: the gates certify that the kernel does what its contract says; the persona stage certifies that the contract is the capability the person asked for.

## Per-request protocol (the agent follows this exactly)

1. `bin/x1.mjs start <id>` — the clock starts before the request is read.
2. Read `work/pool/<id>.md`, `RUBRIC.md`, `templates/CONTRACT.md`. Nothing else from the pool.
3. Write `work/factory/<id>/CONTRACT.md` (the template, filled) and `work/factory/<id>/tests.json` (the residual as executable tests, in `gate.mjs` format; at least 4 tests, including one boundary and, where the request leaves a fact open, one test that pins the stated assumption).
4. `node factory/gate.mjs freeze work/factory/<id>` — contract and tests are hashed. From here the agent may not edit either file.
5. Write `work/factory/<id>/kernel.ts` — AssemblyScript, pure exported functions over numbers (`f64`/`i32`/`bool`), no imports, no globals that persist between calls, no I/O. Encode enumerations as integer codes documented in CONTRACT.md.
6. Write `work/factory/<id>/glue.json`: the declarative glue, validated by the closed schema `factory/glue.schema.json` and by gate G7. It carries what the kernel cannot say: a label for every export, name/kind/unit for every argument, the result's kind, unit and field precision (or a label for every integer code and both boolean values), the stated assumption (printed with every answer), the one question the requester would be asked (and could answer), optional notes (safety, phase-out, "excludes tax"), and one plain-sentence message per trap saying why the input was refused and what to supply. `glue.json` is not frozen; it may be edited in any round.
7. `node factory/gate.mjs run work/factory/<id>` — up to **3** repair rounds, editing `kernel.ts` and `glue.json` only. Record each round's gate output in `work/factory/<id>/rounds.jsonl` (append the printed JSON plus a one-line note of what was changed).
8. `bin/x1.mjs stop <id>`.
9. Write `work/factory/<id>/outcome.json`:
   `{ "id", "outcome": "promoted" | "rejected" | "underdetermined", "rounds": n, "question": "..." (only for underdetermined: the one question the requester would be asked), "self": { "complete": bool, "composable": bool, "residual": n, "underdetermined": bool, "notes": "..." }, "usage": "one line: how a user calls the exported function(s) with example args and the expected answer" }`.
   - **promoted** requires `result.json` `promotable: true`.
   - **underdetermined** is the right outcome when a required behaviour depends on a fact the request does not contain (unit basis, OEM data, a standard, a tie-break). Then the agent still writes the contract and tests for the *stated* assumption, generates the kernel against it, and records the question; the capability is promoted only as "promoted-with-assumption" if gates pass: `"outcome": "promoted-with-assumption"`.
   - **rejected** when gates still fail after 3 rounds.

A re-run of an id (after a persona rejection, say) voids the earlier timing first: `bin/x1.mjs void <id> --reason "..."`, then `start` as above. The earlier folder is moved to `work/factory-v1/<id>` by the coordinator before the worker starts; the worker never sees it. When the coordinator hands the worker persona findings (`work/persona-review/input/<id>.md`), the worker reads them right after the request: they are part of the need, not a consultation.

## What the agent may not do

Edit `gate.mjs`, `glue.schema.json`, `promote.mjs`, `RUBRIC.md`, the templates, any other request's folder, `persona.json`, or `tests.json`/`CONTRACT.md` after freezing. Consult the requester (there is none). Look at other requests or contracts.

## Gates (`gate.mjs`, fixed)

G1 frozen, G2 compiles with no imports, G3 exports, G4 tests, G5 deterministic, G6 bounded (unchanged since the first run), and **G7 glue**: `glue.json` validates against the closed schema and agrees with the module (every export described, argument count equal to the export's arity, precision on every number, a label on every code the tests returned and on both boolean values, a trap message for every export that traps in `tests.json`, assumption and question present). The five persona presentation rules (trap codes need a message; print the assumption with every answer; field precision and units; label every boolean and integer code; one kernel per quantity) are enforced on the glue, not on the kernel; the fifth is checked by the coordinator at promotion, not by G7.

## Persona stage

After the workers finish, a fresh persona agent (blind to the workers' reasoning and to any earlier verdicts) applies the house persona-review method to each gated capability: 2–3 named personas chosen by who would make the request, each running the kernel through `factory/try.mjs` on the usage example plus persona-realistic and edge inputs, each giving one verdict. It writes `work/factory/<id>/persona.json`:

```json
{ "id": "C-006", "at": "ISO time", "reviewer": "who/what produced this", "method": "...", "source": "report path", "calls": n,
  "verdicts": [ { "persona": "technician", "verdict": "accept" | "accept-with-change" | "reject", "change": "the one change named (AwC) or the reason (reject)" } ] }
```

Workers may not write or read `persona.json`.

## Promotion to the user

`promote.mjs` (run by the coordinator) checks every folder: `frozen.sha256` matches, the gates G1–G7 pass when re-run here, `outcome.json` is consistent, start/stop events exist; that makes the capability **gated**. Then the persona stage: a gated capability is **promoted** (or promoted-with-assumption) only when `persona.json` exists and records no `reject` from any persona consulted; when every persona accepts it is listed under "Promoted"; when at least one says accept-with-change and none rejects it is **promoted-pending-change** and listed separately with the changes named; a `reject` makes it **gated-rejected-by-persona** (not promoted); a gated capability with no `persona.json` is **gated-unreviewed** (not promoted). `promote.mjs` writes `work/factory/INDEX.md` and `receipt/factory-summary.json`; `factory/try.mjs <id> <fn> <args…>` runs a capability through its glue (value at field precision with unit or label, assumption, note, question; traps print their message).
