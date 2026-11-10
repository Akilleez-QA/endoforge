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
| [key.mjs](key.mjs) | Capability from glue or from a fenced `capability` block, keys, export binding, contract text vectors. Keys and binding include the nested layout of record, list and text values (field names, kinds, units, ranges, precision, codes, `max`, `maxBytes`); record fields compare by name, and a scalar capability keeps the key it had before layout was keyed |
| [compose.mjs](compose.mjs), [link.mjs](link.mjs) | Turn a composition plan into one module, glue and manifest source: union, output-to-input pipelines, argument adapters |
| [scope.mjs](scope.mjs) | Tenant and lineage access check |
| [cells.mjs](cells.mjs), [cell.mjs](cell.mjs) | Warm worker threads with the pool's heap limits and WASM guard; run `runGates`, discrimination and fingerprints |
| [discriminate.mjs](discriminate.mjs), [mutants.mjs](mutants.mjs) | Module mutants (up to 1,000 sites), result wrappers and a probe grid (up to 512 rows per export). For an export that takes or returns a `record`, `list` or `text`, the grid is built from the declared layout (each scalar leaf varied, codes and booleans enumerated, lists shortened, extended and reordered, text varied within `maxBytes`), calls go through the host buffers of a metered instance, results are compared field by field, and wrappers act on every `number` leaf |
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
holds the capability. Parts that use linear memory keep their state apart: the composed module has one WebAssembly
memory per part (multi-memory), after memory 0, which holds the buffers the host passes in. Each part's loads, stores,
data segments and bulk operations address only its own memory, still bounds-checked to the part's own size, and
structured values cross between parts only through copies the linked wrapper makes between memories. The meter
(`core/runtime/x1/meter.mjs`) reads, exports and counts every memory. Each part keeps its own table. A plan misses with
`memory_conflict` when the parts' memories together cannot fit the 64 MiB workcell budget, or a part declares or
addresses more than one memory.

Scopes: an entry's `scope` comes from the admit row or the principal. Another tenant's entry is invisible, a lineage
outside the entry's path misses with `permission_denied`, and `grant` opens an entry to a named tenant or lineage. The
principal is passed by the caller, never read from the need.

`reclaim()` keeps the oldest entry of each behaviour within a scope, releases the others' bytes and rewrites the journal
with a `library_compacted` record naming the previous tip. A behaviour is the entry's fingerprint: every export's
results over a fixed grid, with numbers (non-finite ones included) to 12 significant digits, records and lists as
JSON, and text kept exactly, so kernels returning different strings are not duplicates. The kept entry takes
the union of the released entries' grants, and a later `grant`, `ungrant` or composition plan that names a released
entry resolves to the kept one. A refused need records its counterexamples: a later need whose tests that entry is
known to fail, or an identical refused need, misses with `counterexample` and no cell runs. Qualifications and
refusals are kept per environment; a failure or refusal in one environment does not revoke the entry or refuse the
need elsewhere.

Run `make library-test`. Measurements: [P-53](../../experiments/P-53-library-v0/RESULT.md).
