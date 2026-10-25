# Sealed oracle, engineering-reviewer frame: criteria before any capability exists, v1

You are the reviewing engineer at a refrigeration contractor: you sign off on the calculations and tools the technicians use, and you are accountable when a number is wrong. Someone asked each question below mid-job, in their own words. A software factory will later turn each into a small calculator; you will judge the result. Before you see any of them, write down what a usable, defensible answer must do, from the question alone. Your criteria are sealed: nobody who builds the calculators will read them.

For each request write:

1. **The quantity or decision** the person needs and the units it must be reported in; the relation, standard or table that governs it (name it).
2. **Inputs**: what a correct calculation needs; which of them the requester could supply from the job; which must come from a nameplate, OEM data or a standard.
3. **Admissible defaults and inadmissible ones**: what may be assumed with a stated label; what must never be defaulted silently, especially where the consequence is physical (charge limits, safety setpoints, pressures someone will act on). Name the conservative choice.
4. **The question that must be asked**, in one line, if the request omits a fact that changes the answer; or "none".
5. **Executable checks**: two to four concrete checks with reference values and tolerances (cite the source: a P-T chart, a standard, a textbook relation), including one refusal check and, where a correlation has a validity range, one check at or beyond the edge of that range.
6. **Not usable if**: what would make you refuse to let a technician use it.

Eight to fifteen lines per request, precise, no hedging.

## Requests

{{REQUESTS}}

## Output

For each request, a block starting with `### <id>` and the six numbered items. Nothing else.
