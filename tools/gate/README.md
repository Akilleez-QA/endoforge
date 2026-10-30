# Independent gate runner

Set ENDOFORGE_ASC to an installed AssemblyScript compiler. Freeze a directory containing CONTRACT.md and tests.json before adding kernel.ts. Run gate.mjs on that directory to check the frozen contract, compiled exports, deterministic outcomes, and glue schema. The engine tests exercise the generic evaluation boundary without this optional compiler.
