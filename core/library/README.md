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

Pass the same object to `runNeed({ ..., library })` and the `current` path consults it after the freeze.

| File | Role |
|---|---|
| [library.mjs](library.mjs) | `openLibrary`: `admit`, `lookup`, `serve`, `revoke`, `requalify`, `dependants` |
| [key.mjs](key.mjs) | Capability from glue or from a fenced `capability` block, keys, export binding |
| [cells.mjs](cells.mjs), [cell.mjs](cell.mjs) | Warm worker threads with the pool's heap limits and WASM guard; run `runGates`, discrimination and fingerprints |
| [discriminate.mjs](discriminate.mjs), [mutants.mjs](mutants.mjs) | Module mutants (up to 1,000 sites), result wrappers and a probe grid (up to 512 rows per export) |
| [journal.mjs](journal.mjs) | Hash-chained JSON lines; one `fsync` per record; verified on open |

`openLibrary` options: `journal` (path, or `null` for memory only), `cells` (1), `deadlineMs` per cell job (5,000),
`keyMode` (`contract`, also `interface` or `prose`) and `gate` (`full`; `none` skips discrimination; any other value, such as
`mutants`, counts module mutants only, without wrappers or untested bounds).

Run `make library-test`. Measurements: [P-53](../../experiments/P-53-library-v0/RESULT.md).
