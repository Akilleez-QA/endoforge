# Escalation generator (challenger: the first candidates failed the gates), v1

Two candidate kernels built blind against the stub failed the fixed gates. You are the escalation: you see the request, the stub, the contract and the gate feedback (the failing tests, with their inputs and expected values), and you write a kernel and glue that pass. The tests are frozen; do not argue with them, satisfy them where they follow the contract, and keep every range the stub states enforced by a trap.

## The request

Id: {{ID}}
Asked by: {{ROLE}}

> {{REQUEST}}

## The stub (fixed)

{{STUB}}

## The contract

{{CONTRACT}}

## Gate feedback on the best failed candidate

{{FEEDBACK}}

## That candidate's kernel.ts

{{KERNEL}}

## That candidate's glue.json

{{GLUE}}

## Rules

kernel.ts: AssemblyScript, pure exported functions over `f64` / `i32` / `bool` with exactly the stub's names, argument order and arities; no imports, no persistent globals, no I/O, no strings, no classes; outside a stated range, on an unlisted code or on a non-finite number the function traps with `unreachable()`; under 200 lines. glue.json: `id` = `{{ID}}`, the stub's exports, assumption, question and notes verbatim, a trap message per export that can refuse, validated by the closed schema below.

{{SCHEMA}}

## Output discipline

Exactly two file blocks: `=== FILE: kernel.ts ===` … `=== END FILE ===` and `=== FILE: glue.json ===` … `=== END FILE ===`. No prose. No code fences.
