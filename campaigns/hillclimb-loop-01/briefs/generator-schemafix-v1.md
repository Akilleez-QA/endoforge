# Glue fix (challenger generator self-check), v1

Your kernel compiles, but the glue does not validate against the closed schema or does not agree with the module's exports. Fix glue.json (and kernel.ts only if an export name or arity must change) and return both as file blocks, nothing else. The stub's names, arities, units and ranges still hold; `id` must be `{{ID}}`.

## Problems

{{FEEDBACK}}

## Your kernel.ts

{{KERNEL}}

## Your glue.json

{{GLUE}}

## The glue schema (closed)

{{SCHEMA}}

## Output discipline

Exactly two file blocks: `=== FILE: kernel.ts ===` … `=== END FILE ===` and `=== FILE: glue.json ===` … `=== END FILE ===`. No prose. No code fences.
