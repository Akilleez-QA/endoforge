# P-53 amendment 1, post-hoc

Written after the first run, whose receipt is `receipt/first-run/summary.json` and whose numbers stand. This changes the gate because of what that run showed, so nothing here is a blind prediction about the first design.

The first run served 149 of 313 arm B cases against a prediction of at most 1%, and 5 arm A cases against a requirement of 0. I read those 5 (see RESULT.md). Reading the served arm B cases by P-51 operator: `single_precision` and `round_two_places` inside an expression, and dropped guard disjuncts.

## Changes
- Mutants may now insert after a floating-point arithmetic operation: single precision, floor, ceil, nearest, round to 1 or 2 places. This grows the code section, still with no compiler.
- The full gate now also refuses when an export that traps has a numeric declared bound its tests never refuse from outside.
- The harness adds arm B's split by finite witness and by a witness inside the declared range, with 4,096 seeded in-range samples per export where every argument has a numeric range.
- Python spawns are counted with a `PATH` shim, because the first run's hook did not reach workcell threads in the generation path. It undercounted there.

## Predictions for the second run, before running it
1. Arm M stays 0. Arm A stays at most the same 5 cases.
2. Arm B cases with an in-domain witness: at most 10% served under the full gate.
3. Arm B cases differing only on NaN or infinity stay largely served. The gate's grid is finite, and the scalar rule says inputs are finite.
4. Shipped hit rate falls: P-21 at most 4 of 118, add at most 51 of 59.
5. Warm pass p50 at most 150 ms.
6. No Python spawn on the warm path; at least one per evaluator call on the generation path.
