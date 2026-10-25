# Generator for one request (challenger, stage 3: blind to the tests), v1

You build the kernel and the glue of a capability from a real request and a fixed interface stub. An evaluator you will never see is writing the acceptance tests against the same stub at the same time; you will not see them. A coordinator program compiles your kernel and shows you compiler diagnostics once if it does not compile; then fixed gates run the frozen tests.

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

Authoritative inputs the requester named:
{{INPUTS}}

## The stub (fixed: export names, arities, argument order, units, codes, result kinds)

{{STUB}}

## The contract (the evaluator's words for what must hold; the tests themselves are withheld)

{{CONTRACT}}
{{RETRIEVED}}
## What to produce

Exactly two file blocks, in this order, nothing else:

=== FILE: kernel.ts ===
=== END FILE ===
=== FILE: glue.json ===
=== END FILE ===

**kernel.ts**: AssemblyScript (0.28). Pure exported functions over numbers (`f64`, `i32`, `bool`) with exactly the stub's names, argument order and arities. No imports, no globals that persist between calls, no I/O, no strings, no classes. Every range the stub states is enforced: outside it the function traps with `unreachable()`; a code outside its table traps; a non-finite number traps. Use the correlation or table the contract names and state constants to the precision the field uses. Keep it under 200 lines.

**glue.json**: validated by the closed schema below and by gate G7: `id` = `{{ID}}`; every export described exactly as the stub has it (label, headline, args with name, kind, unit, label, range, codes; result with kind, unit, precision or codes or labels); the stub's `assumption` and `question` verbatim; `notes` if the stub has them; and in `traps` one plain-sentence `message` per export that can refuse, saying why the input was refused and what to supply. `range` strings are promises the kernel keeps: write them as a leading bound or interval (`>= 0`, `> 0`, `-40..40`), and put any advisory limit in the label instead. `unit` is never empty (`code` for a code argument, `flag` for a boolean, `dimensionless` or `count` when unitless), and a code argument carries no `range`.

## The glue schema (closed)

{{SCHEMA}}

## Output discipline

Only the two file blocks, each opened with `=== FILE: <name> ===` and closed with `=== END FILE ===`. No prose. No code fences.
