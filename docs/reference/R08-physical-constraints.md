# R08 — Physical constraints

> Reconstructed 2026-10-17. The original R08 was not available; this version is rebuilt from
> Edition 2 (§11, §7, §15 and the closing passage) and Edition 3 (§13, §17). Every calculation in
> Edition 2 §11 was redone for this document. Content follows Edition 3 where the editions differ.

## Purpose

Edition 2 §11 reasoned upward from physics to separate fundamental limits from today's conventions. Physics does not require a checkout, a new compiler process, a fresh parse for a parameter change, or a model turn for every deterministic operation [E2 §11]. This document records that reasoning in full, checks every number in it, and then states what Edition 3 kept: two engineering consequences. Everything else here is background. Nothing in it predicts this system's performance, and Edition 3 says so explicitly [E3 §17].

## Summary

- There is no universal maximum programs per second. A limit needs a defined task, information, correctness requirement, machine, energy, temperature, error tolerance and external interactions [E2 §11].
- A lower-envelope model, T ≥ max(W/F, Q/B, T_crit, T_ext), shows that Endoforge can change W, Q and the dependency graph instead of buying a larger F [E2 §11].
- Every figure in E2 §11 checks out: light-distance floors, 12.8 ms versus 2.56 µs, 2.87 × 10⁻²¹ J per erased bit, about 5.4 × 10⁵⁰ operations per second, about 40 billion years for 2^100 (all **Derived** below).
- Edition 3 keeps two consequences: movement can dominate computation, and no computation supplies a missing observation [E3 §13].
- Everything else, including thermodynamic and quantum bounds, is background [E3 §13, §17].

## 1. No universal maximum

A meaningful physical limit needs a defined task, available information, correctness requirement, machine size, energy, temperature, error tolerance and required external interactions. A three-operation transformation and a complex simulation are not interchangeable production units [E2 §11]. "Programs per second" without those is not a quantity.

## 2. The lower-envelope model

Edition 2's simplified model [E2 §11]:

```
T ≥ max( W/F , Q/B , T_critical_path , T_required_external_interaction )
```

| Symbol | Meaning |
|---|---|
| W | Computational work |
| F | Available computational throughput |
| Q | Information traffic across a relevant boundary |
| B | Effective bandwidth across that boundary |
| T_critical_path | Floor set by serial dependencies |
| T_required_external_interaction | Floor set by necessary external waits (a person, a model service, a network) |

It is a floor, not a predictor. Phases may not overlap, so the real time can approach the sum rather than the maximum, and shared resources add contention [E2 §11]. Its value is to show which terms a design can move. Endoforge can reduce W (generate less, reuse analysis), reduce Q (change-aware paths, compact representations), and shorten the critical path (overlap evaluator synthesis with generation [E3 §10]) instead of only increasing F [E2 §11].

Edition 3's latency budget is a worked instance. Roughly four fifths of a small novel capability's time is model inference, and the person's confirmation is the only term with an unbounded tail (**Estimated** [E3 §10]). In this model those are T_required_external_interaction terms, and no amount of F moves them.

## 3. Distance and locality

Edition 2 gives ideal one-way light propagation as about 33 ps across a centimetre, 3.3 ns across a metre and 3.3 ms across 1,000 km, using the exact vacuum speed of light [E2 §11].

**Derived.** c = 299,792,458 m/s (exact by definition).

| Distance | t = d / c | E2 value |
|---|---|---|
| 1 cm | 0.01 / 299,792,458 = 3.336 × 10⁻¹¹ s ≈ 33.4 ps | about 33 ps ✓ |
| 1 m | 3.336 × 10⁻⁹ s ≈ 3.34 ns | 3.3 ns ✓ |
| 1,000 km | 1 × 10⁶ / 299,792,458 = 3.336 × 10⁻³ s ≈ 3.34 ms | 3.3 ms ✓ |

These are floors in vacuum. Signals in copper and fibre travel slower, and real systems add transport, queuing, switching and processing [E2 §11]. The design consequence: repeated dependence on distant state can dominate even an extremely fast local compiler. Isolate locality is the first level; cache, DRAM, chip interconnect, accelerator placement, machine boundaries and model-service distance are further levels. The goal is a short and infrequent necessary communication path [E2 §11].

## 4. Movement can dominate the calculation

Edition 2's illustration: a workload with 1.28 GB of DRAM traffic per candidate, at an assumed effective 100 GB/s, has a transfer term of 12.8 ms. A change-aware path needing 256 kB has a term of 2.56 µs: a 5,000-fold difference in that term, not a forecast of a 5,000-fold application speedup [E2 §11].

**Derived** (decimal units, as the source uses):

- 1.28 × 10⁹ B / 1.00 × 10¹¹ B/s = 1.28 × 10⁻² s = 12.8 ms ✓
- 2.56 × 10⁵ B / 1.00 × 10¹¹ B/s = 2.56 × 10⁻⁶ s = 2.56 µs ✓
- 1.28 × 10⁹ / 2.56 × 10⁵ = 5,000 ✓

If "256 kB" is read as 256 KiB (262,144 B), the ratio is 4,883. The order of magnitude is unchanged.

Why only the term: total time is at least the largest of the four terms in §2. Removing 12.8 ms of traffic helps by 12.8 ms only if traffic was the binding term, and by less if computation, serial dependencies or external waits are larger. The 100 GB/s figure and the 1.28 GB workload are assumptions of the illustration, not measurements [E2 §11].

This example ties directly to persistent semantic state, shared candidates, compact representations, batch processing and reuse of prepared data (R06, R07). A better representation can remove far more work than a modestly faster implementation of the same full scan. Sometimes recomputing a small value is cheaper than retaining and retrieving it; residency is not automatically optimal [E2 §11].

## 5. Thermodynamics and state transition (background)

**Landauer.** For the standard isothermal erasure of an unbiased classical bit, E_erase ≥ k_B T ln 2. At 300 K Edition 2 gives about 2.87 × 10⁻²¹ J per erased bit [E2 §11].

**Derived.** k_B = 1.380649 × 10⁻²³ J/K (exact). 1.380649 × 10⁻²³ × 300 × 0.693147 = 2.871 × 10⁻²¹ J ✓.

This is not energy per instruction, token, compiler check or candidate [E2 §11]. For scale (**Derived**, illustrative): erasing every bit of the 1.28 GB in §4 once, 1.024 × 10¹⁰ bits, would cost at least 1.024 × 10¹⁰ × 2.871 × 10⁻²¹ ≈ 2.9 × 10⁻¹¹ J. Practical machinery dissipates many orders of magnitude more than this floor. The figure says nothing about Endoforge's energy budget.

Edition 2 also notes, from the conversation, that reversible computation avoids logical erasure at each step but does not make practical machinery lossless, and that minimum dissipation is generally not the operating point of maximum throughput [E2 §11].

**Margolus–Levitin.** The time to evolve to an orthogonal quantum state satisfies τ ≥ πħ / (2E), where E is the mean energy above the ground state, not machine wattage [E2 §11]. The corresponding maximum rate of orthogonal transitions is 2E / (πħ).

**Lloyd's ultimate computer.** Edition 2 cites Lloyd's thought experiment of one kilogram in one litre, placing a distant envelope near 5.4 × 10⁵⁰ elementary operations per second [E2 §11].

**Derived.** Taking all rest-mass energy as available: E = mc² = 1 kg × (299,792,458 m/s)² = 8.988 × 10¹⁶ J. ħ = 1.054572 × 10⁻³⁴ J·s. Rate = 2E / (πħ) = 1.7975 × 10¹⁷ / 3.3130 × 10⁻³⁴ ≈ 5.43 × 10⁵⁰ s⁻¹ ✓.

These are not hardware roadmaps or Endoforge specifications [E2 §11]. Their role was to show how far today's conventions sit from fundamental limits: Endoforge can pursue large reductions in redundancy long before approaching any of them.

## 6. Search and information are limits too

**Combinatorial search.** One hundred independent binary choices give 2^100 combinations. At an assumed 10¹² evaluations per second, exhaustive enumeration would take about 40 billion years [E2 §11].

**Derived.** 2^100 = 1.2677 × 10³⁰. 1.2677 × 10³⁰ / 10¹² = 1.2677 × 10¹⁸ s. Dividing by 3.15576 × 10⁷ s per Julian year gives 4.02 × 10¹⁰ years ≈ 40 billion ✓.

More candidates alone are therefore not the destination. Better representations, useful priors, parameter families, valid equivalences and discriminating counterexamples matter [E2 §11]. R05 gives the trust-side version: more candidates also multiply evaluator leaks.

**Underdetermined behaviour.** When the intended behaviour is underdetermined by the available information, computation cannot manufacture the missing observation. The efficient operation may be a clarification or an authoritative lookup [E2 §11]. Edition 2's worked request shows it: if the sources do not establish which pressure basis or unit interpretation is intended, another compilation will not supply the fact [E2 §5].

**Verification.** Verification of unrestricted programs has fundamental limits, while bounded domains and explicit contracts still permit strong checking. The factory should seek useful restricted proof and validation systems without claiming that passing tests establishes every behaviour [E2 §11].

## 7. The direction toward the limit

Edition 2's practical sequence: remove repeated setup, then unaffected reanalysis, then duplicate candidate work, then general-purpose overhead that can be economically specialised, then avoidable movement across hardware boundaries. Proof or validation can preserve some evidence under explicit assumptions; physical performance still needs observations [E2 §11]. The far end is only the new behaviour, only the information that must move, and only the evidence the change invalidates. That is a research direction, not a promise of constant-time lookup [E2 §11]. Irreducible task work, missing information, measurement uncertainty, communication distance and physical trade-offs remain [E2 closing passage].

## 8. Edition 3's reduction: two engineering consequences

Edition 3 keeps exactly two consequences and calls everything else background [E3 §13]:

1. **Movement can dominate computation.** A change-aware path that touches 256 kB instead of 1.28 GB removes a 5,000-fold term, not a 5,000-fold speedup. Engineering consequence: measure bytes moved per candidate (copies, conversions, scans, transfers) as a first-class metric, and judge representation changes by the traffic term they remove (R06, R07, R09).
2. **Underdetermined behaviour.** When behaviour is underdetermined by the available information, no computation can supply the missing observation. Engineering consequence: the host asks. Intake treats an underdetermined request as a request for a fact, and the specification stage cannot synthesize what the request never contained [E3 §4, §6].

| Item | Status in Edition 3 |
|---|---|
| Lower-envelope model | Background; useful for reasoning, not a predictor |
| Light-distance floors | Background |
| 1.28 GB versus 256 kB traffic | **Kept** as consequence 1 |
| Landauer bound | Background |
| Reversible and finite-time computation | Background |
| Margolus–Levitin bound | Background |
| Lloyd's ultimate computer | Background |
| 2^100 search arithmetic | Background; its lesson survives in R05 and R07 |
| Underdetermined behaviour | **Kept** as consequence 2 |
| Limits of verification | Background; Edition 3's trust model measures escape rate instead [E3 §7] |

Edition 3's claim ladder states the boundary plainly: the document does not claim that the physical-limits discussion predicts anything about this system's performance [E3 §17].

## Edition 3 alignment

- **Superseded:** the physical-limits discussion as part of the main line. Edition 3 moves it out and keeps two consequences [E3 §2, §13].
- **Holds:** all arithmetic, as verified above, and the qualifications Edition 2 attached to each figure.
- **No contradictions found** between E2 §11 and E3 §13. The 5,000-fold figure is consistent in both, in decimal units.

## Open questions

- What is the actual traffic term per candidate in any Endoforge route? No bytes-moved measurement exists yet; the lab's P10 sensors measure file I/O, not memory traffic. A hardware-counter measurement would be needed (see the hardware qualification template).
- Which requests are underdetermined in practice? E3 X1 measures how many of twenty real requests can be specified in ten minutes, and E3 X2 measures evaluator error by request type [E3 §15].

## Sources

- `sources/text/Endoforge-Edition-2-The-Entire-Idea.txt` §5, §11, closing passage of §15.
- `sources/text/Endoforge-Edition-3.txt` §2, §4, §6, §7, §10, §13, §15, §17.
- Physical constants: c, k_B and ħ are CODATA/SI values (c and k_B exact by SI definition; ħ = 1.054571817 × 10⁻³⁴ J·s). The source register (R18) holds the external physics references EXT-PHY-01 to EXT-PHY-06 cited by Edition 2; they were not reverified here.
