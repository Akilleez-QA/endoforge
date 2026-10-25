# X1 specification-study kit (C01, WP07)

Runs Edition 3's first experiment: of twenty real small requests, what fraction can a person turn into a checkable acceptance contract in under ten minutes? The precommit draft is `docs/execution/campaigns/C01-x1-specification-study.md`; this kit is the tooling it names. Zero dependencies beyond Node 26.

## Roles

- **Collector**: records requests on `templates/REQUEST.md` as people make them.
- **Rater 1 (specifier)**: writes each contract against the timer and classifies it.
- **Rater 2 (blind classifier)**: classifies the seeded half from `work/blind/` only.
- **Adjudicator**: resolves rater disagreements (sensitivity analysis only).

Rater 2 and the adjudicator must not be rater 1. If no second person is available, run the study anyway and record "κ not measured" in C01's receipt; the primary still stands, labelled as single-rater.

## Procedure

```bash
cd campaigns/x1-spec-study
node --test test/                  # the analysis reproduces R14's intervals
bin/x1.mjs init
```

1. **Collect** at least 20 requests (60 if you want the extension rule to be possible without a second collection). Each is one file in `work/pool/<id>.md`:
   ```bash
   bin/x1.mjs add R-001            # opens a template; or: bin/x1.mjs add R-001 /path/to/notes.md
   ```
   Apply the inclusion rules in `RUBRIC.md` before adding; list exclusions by id in `receipt/excluded.md`.
2. **Register C01.** Fill the TBD fields in the C01 draft (names, seed, dates), then freeze:
   ```bash
   bin/x1.mjs freeze --seed 20261017
   ```
   This hashes every request and the kit, fixes a seeded order, picks the primary 20 and the blind half, and writes `receipt/freeze.json`. Copy `receipt/freeze.sha256` into C01 §15. After this point no request or rubric may change; `x1 verify` enforces it.
3. **Contract**, one request at a time in frozen order:
   ```bash
   bin/x1.mjs next
   bin/x1.mjs start R-014          # creates work/contracts/R-014.md from the template
   bin/x1.mjs pause R-014          # interruptions
   bin/x1.mjs resume R-014
   bin/x1.mjs stop R-014           # prints working seconds
   ```
   Then classify (rater 1): see `RUBRIC.md` for each field.
   ```bash
   bin/x1.mjs classify R-014 --rater 1 --complete y --composable n --residual 4 --underdetermined n --shape parametric --cluster unit-join
   ```
   `--shape` and `--cluster` are assigned in one pass after all 20 contracts exist; you may classify the other fields first and add shape/cluster later only by deleting and rewriting the JSON (say so in the receipt).
4. **Blind half**:
   ```bash
   bin/x1.mjs blind                # exports work/blind/ for rater 2
   bin/x1.mjs classify R-014 --rater 2 --complete y ...   # rater 2, only ids in the blind half
   ```
5. **Analyse**:
   ```bash
   bin/x1.mjs verify
   bin/x1.mjs analyze              # primary, CP95 interval, DP-6 band and decision, secondaries, κ
   ```
   If the band is "10–35 %", contract the reserve in frozen order to 60 and run `bin/x1.mjs analyze --extended`.
6. **Record** `receipt/summary.json` and the receipt files in C01, and the outcome in R12 and R16 (WP32), whatever it is.

## What is committed and what is not

`work/` (requests, contracts, blind exports) may contain customer data and is git-ignored; `receipt/` (digests, events, classifications, summary) is committed. The pool digest, not the pool, is the study's identity.

## Decision bands (C01 §3, DP-6)

| Outcome at n = 20 | Band | Decision |
|---|---|---|
| 0–1 specifiable | below 10 % | kill: generative applications move to research |
| 2–7 | 10–35 % | extend to 60 from the frozen reserve; decide at 60 against 20 % |
| 8 or more | above 35 % | pass |

Every decision reports the two-sided 95 % Clopper–Pearson interval; one whose interval straddles 20 % is labelled a point-estimate decision.
