# core/library

Reuse of promoted capabilities. A need whose declared capability matches an admitted entry is served from that entry,
after the need's own frozen tests pass on it and a mutation check shows those tests can tell it from a near variant,
instead of spending a model turn on the implementation. The design, the key, the miss reasons and the limits are in
[docs/architecture/library.md](../../docs/architecture/library.md).

```js
import { openLibrary } from './core/library/library.mjs';

const library = await openLibrary({ journal: '/path/outside/the/checkout/library.jsonl', cells: 1 });
await library.admit([{ ledger: '/runs/a/ledger.sqlite', promotion: '/runs/a/promotion.json' }]);
const served = await library.serve({ id: 'need-7', files });   // { verdict: 'pass' | 'refused' | 'miss', ... }
await library.close();
```

Pass the same object to `runNeed({ ..., library })`: every loop path consults it once the specification is frozen
(`current` and `isolate` after the freeze, `agent` after admission), and a pass skips the implementation.

| File | Role |
|---|---|
| [library.mjs](library.mjs) | `openLibrary`: `admit`, `retrieve`, `lookup`, `serve`, `compose`, `grant`, `ungrant`, `reclaim`, `revoke`, `requalify`, `qualifications`, `counterexamples`, `dependants` |
| [key.mjs](key.mjs) | Capability from glue or from a fenced `capability` block, keys, export binding, contract text vectors |
| [compose.mjs](compose.mjs), [link.mjs](link.mjs) | Turn a composition plan into one module, glue and manifest source: union, output-to-input pipelines, argument adapters |
| [scope.mjs](scope.mjs) | Tenant and lineage access check |
| [cells.mjs](cells.mjs), [cell.mjs](cell.mjs) | Warm worker threads with the pool's heap limits and WASM guard; run `runGates`, discrimination and fingerprints |
| [discriminate.mjs](discriminate.mjs), [mutants.mjs](mutants.mjs) | Module mutants (up to 1,000 sites), result wrappers and a probe grid (up to 512 rows per export) |
| [journal.mjs](journal.mjs) | Hash-chained JSON lines; one `fsync` per record; verified on open |

`openLibrary` options: `journal` (path, or `null` for memory only), `cells` (1), `deadlineMs` per cell job (5,000),
`keyMode` (`contract`, also `interface` or `prose`) and `gate` (`full`; `none` skips discrimination; any other value, such as
`mutants`, counts module mutants only, without wrappers or untested bounds), `retrieval` (`key`; `semantic` also lets a
need with no capability block adopt the capability of a textually similar entry, score at least 0.4, whose key then
matches), `principal` (`null`; the default `{ tenant, lineage }` for admission and reuse) and `environment` (replaces the recorded
Node, V8, platform and architecture).

Composition: `library.compose(need, plan)` takes `{ exports: [{ name, entry, fn } | { name, stages: [{ entry, fn, args }], output }] }`.
An argument is `{ input }`, `{ previous: true }` or `{ const }`, with optional `scale`, `offset` and `narrow` (`trunc` or
`nearest`; lossy conversions are refused without it). The result is linked into one module and must pass the need's
frozen tests and the discrimination check, like a single entry. `serve` builds a union by itself when no single entry
holds the capability. At most one part may read or write linear memory and at most one may use a table; a plan that
needs more misses with `memory_conflict` or `table_conflict`.

Scopes: an entry's `scope` comes from the admit row or the principal. Another tenant's entry is invisible, a lineage
outside the entry's path misses with `permission_denied`, and `grant` opens an entry to a named tenant or lineage. The
principal is passed by the caller, never read from the need.

`reclaim()` keeps the oldest entry of each behaviour within a scope, releases the others' bytes and rewrites the journal
with a `library_compacted` record naming the previous tip. A refused need records its counterexamples: a later need
whose tests that entry is known to fail, or an identical refused need, misses with `counterexample` and no cell runs.
Qualifications are kept per environment; a failure in one environment does not revoke the entry elsewhere.

Run `make library-test`. Measurements: [P-53](../../experiments/P-53-library-v0/RESULT.md).
