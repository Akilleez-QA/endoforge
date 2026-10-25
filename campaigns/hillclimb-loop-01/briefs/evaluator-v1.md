# Evaluator for one request (challenger, stage 3: blind to the generator), v1

You write the acceptance contract and the executable tests for a capability that another agent, who will never see your tests, is building at the same time against the same stub. Your tests are frozen by hash before any kernel is evaluated and run unchanged by fixed gates. Write them so that a kernel that answers the question as asked passes and a kernel that silently does something else fails.

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

Authoritative inputs the requester named:
{{INPUTS}}

## The stub (the interface both of you build against; export names, arities, units and codes are fixed)

{{STUB}}

## What to produce

Exactly three file blocks, in this order, nothing else:

=== FILE: CONTRACT.md ===
=== END FILE ===
=== FILE: properties.md ===
=== END FILE ===
=== FILE: tests.json ===
=== END FILE ===

**CONTRACT.md**: the template below, filled: the observable; the authoritative inputs and which wins on conflict; one row per required behaviour with a concrete acceptance test; failure meaning (wrong answer, refusal, ask); permitted effects (none); composition; the stub's assumption stated and pinned; under Open, the stub's question.

**properties.md**: the procedure, not just examples: the properties and metamorphic relations the capability must satisfy (monotonicity in an input, an inverse pair that round-trips, scaling, a dimensional identity, a known reference point with its source, a guard that refuses outside every stated range), each with the concrete instances you turned into test rows below. Name the source of every reference value (a standard, a table, a textbook relation) so a reviewer can check it.

**tests.json**: `[{ "name": "...", "fn": "exportName", "args": [numbers], "expect": number|boolean, "tol": absolute (optional), "expectError": true (optional: the call must trap) }]`. Between 6 and 14 rows: at least one reference point per export with a tolerance that reflects real field precision; one boundary per export; one row pinning the assumption; one trap row per stated range; and at least two rows that instantiate a property (a monotonic pair, an inverse round-trip, a scaling). Use only the export names, arities, units and codes the stub fixes; args are plain numbers (codes as integers, booleans as 1/0). Expected values must be numbers you are confident of; when a value depends on a correlation whose exact form the stub leaves open, widen the tolerance to what any accepted correlation would satisfy rather than guessing a digit.

## The contract template

{{TEMPLATE}}

## Output discipline

Only the three file blocks, each opened with `=== FILE: <name> ===` and closed with `=== END FILE ===`. No prose. No code fences.
