# P-24 result: G4 ablation (session x effort)

Precommit: `PRECOMMIT.md`, sha256 `9557e4ff3e4369fe803cdd663b756d9f3e81f3afb9f5642a261f1f41b1aa6dfd`
(`receipt/precommit.sha256`). Run on main-rig, started 2026-11-01 23:50 EST,
thread pool size 10, the 20 P-21 needs per arm, real Codex generator (`testDouble: false`).
Receipts: `receipt/rows.json`, `receipt/environment.json`, `receipt/<arm>/<id>.json`.
G4 status per row is read from the last attempt's `gates.G4_tests` in that row's ledger record.

| Arm | Session | Effort | Promoted | G4 refusals | G4 refusals using `assert(` | Promoted using `assert(` | Generate p50 (s) |
|---|---|---|---|---|---|---|---|
| A0 | fresh | default | 9/20 | 11 | 11 | 0 | 59.7 |
| A1 | resume | default | 9/20 | 11 | 11 | 0 | 53.3 |
| A2 | fresh | auto | 9/20 | 11 | 11 | 0 | 62.6 |
| A3 | resume | auto | 7/20 | 12 | 10 | 0 | 56.8 |

## Decisions

- D1: no arm has 4 or more G4 refusals above A0 (largest difference is A3, +1). No arm raises G4.
- D2: neither session resume nor auto effort is the driver. The G4 rise is present with both off (A0).
- D3: holds. Pooled, 43 of 45 G4 refusals (95.6%) contain `assert(`; 0 of 34 promoted kernels do.

## Interpretation

The G4 rise is not caused by the P-23 speed settings. It follows `assert(` in generated
kernels: the compiler builds with `--noAssert`, so `assert` traps are removed and every
`expectError` test fails G4. The fix belongs in the generator instructions (trap explicitly),
not in G4 and not in the session or effort settings, which can stay at resume + auto.

## What it does not show

- It does not show why P-21 promoted more: the current generator prompt is used in all four arms,
  so the earlier prompt may simply have produced fewer asserts.
- It does not show that removing asserts alone restores 41/60; that needs the confirmation run.
- 20 needs per arm is small; differences of 1 or 2 promotions are within noise.
- Generate times were measured with four arms sharing one Codex account in sequence, not in isolation.
