# Repair round {{ROUND}} of 3 (incumbent), v1

The fixed gates ran on your kernel and something failed. CONTRACT.md and tests.json are frozen by hash and cannot change. Edit kernel.ts and glue.json only. Return both as file blocks (the unchanged one too) and nothing else.

## Gate output

{{FEEDBACK}}

## Your contract (frozen)

{{CONTRACT}}

## Your tests (frozen)

{{TESTS}}

## Your current kernel.ts

{{KERNEL}}

## Your current glue.json

{{GLUE}}

## Rules (unchanged)

kernel.ts: AssemblyScript, pure exported functions over `f64` / `i32` / `bool`, no imports, no persistent globals, no I/O, no strings, no classes; invalid input traps with `unreachable()`; every function named in the tests exported with that name and arity. glue.json: validated by the closed schema (below) and gate G7: every export described, every argument named with kind and unit, result unit and precision (or codes / true-false labels), a trap message for every export that traps in the tests, `assumption` and `question` present, `id` = `{{ID}}`.

{{SCHEMA}}

## Output discipline

Exactly two file blocks: `=== FILE: kernel.ts ===` … `=== END FILE ===` and `=== FILE: glue.json ===` … `=== END FILE ===`. No prose. No code fences.
