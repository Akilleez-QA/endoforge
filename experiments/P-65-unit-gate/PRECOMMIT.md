# P-65 unit gate: precommit

Label: **Proposed** procedure, frozen 2026-11-07 before the pipeline arms run and before the evaluator overlap is computed. This is a probe and decides nothing under DEC-64.

## Question

After evaluator synthesis (P-56, arm S2a), 184 of 799 glue P-21 mutants still promote, against a bar of at most 156. Can a gate that fails independently of the dual evaluators close them? Two evaluators that share a blind spot don't multiply: redundancy helps only where failures are independent.

## Classification of the 184 (done first, before any gate code)

From P-56's S2a rows (`S2a/glue.jsonl`, sha256 d989e12b…), the P-51 prep (`mutants.jsonl`) and each kernel's frozen glue, contract and source. Each escape's glue was diffed against the pristine glue and the changed field classified by what the old and new unit strings denote.

| Class | Rows | What it is |
|---|---|---|
| Label vs physical | 50 | One side a label (`status`, `condition code`, `unit code`), the other a physical unit (`psig`, `%`, `°F`). 32 are a physical unit landing on a `code` result |
| Label only | 36 | Both sides non-physical labels: `approval action` ↔ `role rights mask`, `display status` → `workflow state`, `person ID` ↔ `confirmation state` |
| Code labels swapped | 27 | 13 swap a "reserved; never returned" label onto the code the kernel returns; 14 swap two live labels |
| Time point vs duration | 20 | All C-010: `ms since Unix epoch` ↔ `UTC days`/`days` |
| Different dimension | 19 | `°F` → `% RH`, `dimensionless` ↔ `kg/s`, `g` ↔ `circuits`, `psi` → `°F difference` |
| Temperature point vs difference | 12 | `°F difference` → `°F` |
| Same dimension | 10 | `°C difference` → `°F difference` (scale), epoch day ↔ epoch ms, `mass liquid/mass vapor` → `mass/mass` |
| Generic physical | 9 | One side is `selected unit`, `same mass/time unit as inlet`, `caller-labelled mass/time` |
| Precision | 1 | |

So "mostly unit swaps" holds in the mutator's sense (156 of 184 are `glue_result_unit_swapped` or `glue_arg_units_swapped`), but only about 61 are swaps between two parseable physical units. 86 involve a label that is not a physical unit at all, which is exactly where P-56's `units.glue` can't judge: it compares only when both its unit and the glue's parse. About 10 are near-equivalent (`mass fraction` → `dimensionless`, `same mass/time unit as inlet` → `mass/time`), and the 12 bare-degree rows match a convention pristine glue uses for differences (seen below), so neither group is a fault a correct gate can refuse.

The strongest rival, "the escapes are contract or spec errors, not unit swaps", fits at most the 14 live code-label swaps and one contradictory contract (C-015, P-55). It doesn't fit the rest: the pristine glue in those rows is right, and the mutant's unit contradicts the kernel's own arithmetic, the kind, or the parameter names.

## Mechanism

`G9_units` in `core/runtime/x1/gates.mjs`, from `core/runtime/x1/dimensions.mjs`. Static, deterministic, no model calls, and it never reads the contract text or the evaluator. Its information is the kernel source, the glue's kinds, units and names, and the frozen tests' outputs that G4 already computed. The evaluator's information is a model's reading of the contract checked on sampled values. Rules:

- **K**: a `code` or `boolean` field whose unit is a physical quantity or a percent.
- **D**: dimensional inference through the kernel. Parameters take dimensions from their glue units; local constants, locals and helper calls are followed; comparisons and literal-armed ternaries are codes; `+`, `-`, `min`, `max` and comparisons must balance; a multiplication or division by a literal makes the result unknown, since a coefficient can carry a unit (`dropF * 3.47` psi). The inferred return must match the glue result: a computed code can't carry a physical unit, dimensions must agree, and a definite point (epoch or temperature) can't be shown as a difference.
- **N**: a unit named by a parameter's or export's trailing token (`perCircuitChargeG`, `anchorMs`, `temperatureF`, `slopePsiPerF`) must agree with the glue unit in dimension and scale. Compound and `From` names are skipped.
- **L**: two adjacent arguments whose units each fit the other's name better (token overlap).
- **R**: a computed code whose result unit is a specific (two or more word) label copied from an argument whose name fits it better than the export's name and label.
- **C**: a code labelled "reserved", "never returned" or "unused" that the frozen tests return.

Anything that doesn't parse is unknown and never refuses. Rules were developed on `cand-r1` and `cand-r2` glue mutants plus all 349 pristine kernels (`cand` and `base`); `cand-r3` to `cand-r6` are reported separately as held-out. The classification above read all 184, so the held-out split is weaker than a blind one.

## Development figures (offline, disclosed; not the acceptance figures)

`gates-offline.mjs` runs `runGates` from this tree on every pristine kernel and mutant row: 0 of 349 pristine refused by G9. Of the 184 S2a escapes, G9 refuses 93 (dev 25 of 51, held-out 68 of 133), leaving 91. The unit check alone is 0.06 ms p50, 0.25 ms p95 per candidate. Rules that failed pristine during development and were dropped or narrowed: temperature point vs difference (pristine glue writes `°F` or `K` for differences in 5 kernels), name scale on singular `Day` (C-010's `sampleDay` returns ms), a literal coefficient as dimensionless (CC-022), `dimensionless` on a code, and the unrestricted R rule (C-005's generic `code`).

## Arms

On this branch with `experiments/P-51-escape-rate/` from `origin/escape-rate-probe` copied unmodified into the run tree, P-51's prep and the P-42 corpus, P-56's `recorded.jsonl` (sha256 786a7cb0…) replayed by P-56's `replay-provider.mjs`, `P51_WIDTH=14`, under `HEAVY_SLOTS=4 heavy-run`, started only at load average under 20:

- **U2** (headline): `ENDOFORGE_SYNTH=1 ENDOFORGE_SYNTH_WIDTH=2`, arms `control,sampled,glue`. G9 is on in every arm because it is a gate.
- **U1**: `ENDOFORGE_SYNTH=1`, width 1, arm `control` only, for C-015.
- Baseline: P-56's S2a rows, same corpus, seeds and recordings. Cross-check: a U2 row that S2a let through must be refused in U2 only if G9 refuses it, and every row S2a refused stays refused.

## Measures

Pristine promotions; sampled and glue P-21 escapes (P-51's `stats.mjs` intervals); escapes by class above; G9 refusals by rule; offline vs pipeline G9 agreement; G9 time per candidate unloaded (`gates-offline.mjs`, load recorded) and the pipeline gate stage, labelled loaded above load 16.

Independence: over all P-21 mutant rows (sampled and glue), of the rows G9 refuses, the fraction the dual evaluator (P-56 `offline.mjs` at width 2, decision not `refuse`) does not refuse. Reported also against the existing gates G1 to G8 (the pipeline's failing gate set), and against both together.

## Predictions

| # | Prediction | Failure means |
|---|---|---|
| 1 | U2 glue P-21 escapes 88 to 94 (offline 91) | The pipeline differs from the offline judge; trace before reading |
| 2 | U2 sampled P-21 escapes 100 to 105 | G9 sees more or fewer kernel faults than expected |
| 3 | U2 pristine 177 of 177; U1 refuses C-015 by the evaluator, as P-56 S1a did | G9 or the run moved a pristine kernel |
| 4 | G9 p50 at most 0.5 ms unloaded | The parser costs more than development showed |
| 5 | Independence: 35% to 65% of G9's P-21 refusals are rows the dual evaluator passes | Below: the gate mostly duplicates the evaluator. Above: it covers a nearly disjoint set |
| 6 | Held-out catch rate within 10 points of the dev rate (offline 49% and 51%) | The rules fit the dev split |

## Bars

1. U2 glue P-21 escapes at most 156; stretch at most 92.
2. U2 sampled P-21 escapes at most 105.
3. U2 pristine 177 of 177 promote, zero false refusals; C-015 stays refused under U1.
4. G9 at most 5 ms p50 per candidate unloaded, no model calls in the gate.
5. Independence reported against prediction 5.

Decision rule: all of 1 to 4 met means the gate closes the P-56 glue bar. A miss is reported, not retuned; a pristine refusal is reported with its reason. Stop condition: one U2 run and one U1 control run; a harness defect found mid-run is an amendment before rerunning, as in P-56.

## Not claimed

No searched rate; seeded glue faults are not model faults. The 12 bare-degree and about 10 near-equivalent rows stay as escapes by design. The rules' vocabulary (unit words, name tokens) was written against this corpus.
