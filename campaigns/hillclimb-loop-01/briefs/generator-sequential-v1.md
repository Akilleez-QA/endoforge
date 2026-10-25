# Kernel and glue from a frozen contract and tests (sequential generator), v1

You are the generator for one real request. A contract and its executable tests already exist and are frozen by hash; you build the kernel and the glue against them. A coordinator program compiles your kernel, runs the fixed gates (compiles with no imports, exports, tests, deterministic, bounded, glue) and shows you any failure for a repair round (up to 3; kernel.ts and glue.json only).

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

## The frozen contract

{{CONTRACT}}

## The frozen tests (the gates run these unchanged)

{{TESTS}}

## What to produce

Exactly two file blocks, in this order, nothing else:

=== FILE: kernel.ts ===
=== END FILE ===
=== FILE: glue.json ===
=== END FILE ===

**kernel.ts**: AssemblyScript (0.28). Pure exported functions over numbers (`f64`, `i32`, `bool`). No imports, no globals that persist between calls, no I/O, no strings, no classes. Invalid input traps with `unreachable()`. Enumerations are integer codes as the contract documents them. Every function named in the tests must be exported with that name and arity. Keep it under 200 lines.

**glue.json**: what the kernel cannot say for itself, validated by the closed schema below and by gate G7: every export described (a `label` in the requester's words; `headline: true` on the one export that answers the request as asked; one `args` entry per argument with `name`, `kind`, `unit`, `label`, `range`, and `codes` for code arguments); the `result` with `kind` and `unit`, plus `precision` for numbers, `codes` for codes, `labels` for booleans; the `assumption` the contract states (printed with every answer); the one `question` from the contract's Open section that the requester could answer; optional `notes`; and in `traps` one plain-sentence `message` per export that traps in the tests, saying why the input was refused and what to supply. `id` must be `{{ID}}`.

## The glue schema (closed)

{{SCHEMA}}

## Output discipline

Only the two file blocks, each opened with `=== FILE: <name> ===` and closed with `=== END FILE ===`. No prose. No code fences.
