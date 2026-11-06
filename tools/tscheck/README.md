# TypeScript checker

Runs `tsrs`, a Rust port of the TypeScript 7 compiler built as WebAssembly, inside `IsolatePool` V8 workcells behind the WASM guard. It's the checker for imported TypeScript, not part of the kernel path.

```js
import { IsolatePool } from './core/runtime/isolate-pool.mjs';
import { WORKCELL } from './tools/tscheck/pin.mjs';

const pool = new IsolatePool({ hostPort: 'tools/tscheck/port.mjs', size: 8, jobTimeoutMs: 120000, ...WORKCELL });
const result = await pool.run({ reference, candidates, receipts, portOptions: { basePort, projects } });
```

- `pin.mjs` holds the module and core digests and the workcell limits. Without the `trustedWasmModules` entry, the guard stops the compiler.
- `checker.mjs` verifies both digests and gives each check a fresh instance over in-memory files. `WORKCELL` has the pool compile the module once and share it across thread cells, which [P-45](../../experiments/P-45-shared-module/RESULT.md) measured at 56% less peak RSS at 8 cells. A process cell compiles its own. With `emit`, only a check with no diagnostics returns an artifact, with a SHA-256 per file.
- `port.mjs` wraps a caller's host port and adds the `typescript` invariant. `projects` maps each candidate to `{root, files, tsconfig}`. List `typescript` in the frozen evaluator's `invariants`.
- Pass `warm: {}` to the pool to have `ready()` load the checker in every cell, so the first job doesn't compile. [P-46](../../experiments/P-46-prewarm/RESULT.md) measured the first job down 82%, at the cost of a slower `ready()` and with the same total.
- A pass means the checker read the project's TypeScript. The host owns `noCheck`, `noResolve`, `composite` and `incremental` on the compiler's command line, so a tsconfig or anything it extends can't switch them. A clean result also needs every `.ts`, `.tsx`, `.mts` and `.cts` file in `files`, declaration files and unimported `node_modules` aside, to be in the compiler's program, and at least one such file. That refuses `exclude`, `include` or `files` that leave a source out, an empty `files`, and `references`, which redirect sources out of the program. `@ts-nocheck` anywhere in a checked source and any `.tsbuildinfo` input are refused too, so a string containing that text is refused as well. A refusal throws, so the evaluator records an unknown outcome. A caller whose project legitimately leaves sources out should leave them out of `files`.
- With `emit`, a clean check that writes nothing, such as one with `noEmit` in its tsconfig, throws rather than returning an empty artifact.
- These still pass, as stated limits: `// @ts-ignore` and `// @ts-expect-error`, any `strict` family setting the project chose, `skipLibCheck` on a declaration file, and JavaScript without `checkJs`. A project of only JavaScript has no TypeScript source and is refused. Type lies in declarations and `any` are ordinary TypeScript.
- A hash mismatch, a missing compiler or a trap throws, so the evaluator records an unknown outcome and never a pass.

Use a `jobTimeoutMs`, since a check can't stop itself. Don't lower `maxOldGenerationSizeMb` below the pinned limit: 256 MiB ran out of memory on a healthy job in [P-43](../../experiments/P-43-tsrs-workcell/RESULT.md). That probe also found throughput flat by 8 cells.

`make tscheck-setup` installs the exact pinned version without install scripts, and `make tscheck-test` runs the tests. On a version bump, update `pin.mjs` and rerun the probe.

Thread workcells aren't an OS sandbox. Running the emitted JavaScript isn't implemented here.
