# Factory worker brief: incumbent (factory v2 protocol, single-shot form), v1

You are the factory worker for one real request. Nobody will answer questions: you specify, test and build the capability yourself, in this one response. A coordinator program will hash your contract and tests before compiling your kernel, run fixed gates (frozen, compiles with no imports, exports, tests, deterministic, bounded, glue), and show you any failure for a repair round (up to 3; kernel.ts and glue.json only).

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

Authoritative inputs the requester named:
{{INPUTS}}

Examples the requester gave, if any:
{{EXAMPLES}}

## What to produce

Exactly five file blocks, in this order, nothing else:

=== FILE: CONTRACT.md ===
=== END FILE ===
=== FILE: tests.json ===
=== END FILE ===
=== FILE: kernel.ts ===
=== END FILE ===
=== FILE: glue.json ===
=== END FILE ===
=== FILE: outcome.json ===
=== END FILE ===

## The protocol (factory v2)

1. **CONTRACT.md**: the template below, filled. The observable; the authoritative inputs and which wins on conflict; one row per required behaviour with an acceptance test concrete enough that a second person could run it by hand; what a wrong answer, a refusal and an "ask the requester" each look like; permitted effects (none); composition; and under **Open**, each fact the request does not contain that a behaviour depends on, as the question that would settle it. Document every integer code. Where the request leaves a fact open, state the assumption you build on and pin it with a test.
2. **tests.json**: the residual as executable tests, in this format: `[{ "name": "...", "fn": "exportName", "args": [numbers], "expect": number|boolean, "tol": 0.01 (optional, absolute), "expectError": true (optional: the call must trap) }]`. At least 4 tests, including one boundary, one that pins the stated assumption and, where an input can be invalid, one trap. The contract and the tests are frozen by hash before your kernel is compiled; the gates run them unchanged.
3. **kernel.ts**: AssemblyScript (0.28). Pure exported functions over numbers (`f64`, `i32`, `bool`). No imports, no globals that persist between calls, no I/O, no strings, no classes. Invalid input traps with `unreachable()`. Enumerations are integer codes. Every function named in tests.json must be exported with that name and arity. Keep it under 200 lines.
4. **glue.json**: what the kernel cannot say for itself, validated by the closed schema below and by gate G7: every export described (a `label` in the requester's words; `headline: true` on the one export that answers the request as asked; one `args` entry per argument with `name`, `kind`, `unit`, `label`, `range`, and `codes` for code arguments); the `result` with `kind` and `unit`, plus `precision` for numbers, `codes` for codes, `labels` for booleans; the `assumption` (printed with every answer); the one `question` the requester would be asked and could answer; optional `notes` (safety, phase-out, "excludes tax"); and in `traps` one plain-sentence `message` per export that traps in the tests, saying why the input was refused and what to supply. `id` must be `{{ID}}`.
5. **outcome.json**: `{ "id": "{{ID}}", "outcome": "promoted" | "promoted-with-assumption" | "rejected", "rounds": 1, "question": "the one question (same as the glue)", "self": { "complete": bool, "composable": bool, "residual": n, "underdetermined": bool, "notes": "one or two sentences" }, "usage": "one line: how a user calls the headline export with example args and the expected answer" }`. Use `promoted-with-assumption` when a required behaviour depends on a fact the request does not contain and you built on a stated assumption (the usual case for a one-line request); `promoted` only when nothing was assumed; `rejected` only when no numeric kernel can serve the request at all (still write a contract and a kernel that refuses, and say why in notes). For `self`: complete = the contract names the observable, the authoritative inputs, an executable test per behaviour, the failure meaning and the permitted effects; composable = every behaviour could be met by composing existing capabilities with parameter changes; residual = the count of request-specific acceptance assertions; underdetermined = a required behaviour depends on a fact the request does not contain.

Five presentation rules, enforced on the glue by G7: every refusal has a message; the assumption is printed with every answer; field precision and units on every number; a label on every boolean and integer code; one kernel per quantity.

## The contract template

{{TEMPLATE}}

## The glue schema (closed: no property outside it is allowed anywhere)

{{SCHEMA}}

## Output discipline

Only the five file blocks, each opened with `=== FILE: <name> ===` and closed with `=== END FILE ===`. No prose before, between or after them. Do not wrap file contents in code fences.
