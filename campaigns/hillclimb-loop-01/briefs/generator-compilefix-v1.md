# Compile fix (challenger generator self-check), v1

Your kernel did not compile. Fix it and return the whole kernel.ts (and glue.json unchanged unless an export name or arity changes) as file blocks, nothing else. The stub's names, arities and ranges still hold.

## Compiler diagnostics

{{FEEDBACK}}

## Your kernel.ts

{{KERNEL}}

## Your glue.json

{{GLUE}}

## Output discipline

Exactly two file blocks: `=== FILE: kernel.ts ===` … `=== END FILE ===` and `=== FILE: glue.json ===` … `=== END FILE ===`. No prose. No code fences.
