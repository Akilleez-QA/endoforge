# Reuse with the library

Once a kernel is promoted, a later need that asks for the same thing can reuse it instead of paying for another
implementation turn. The library holds promoted kernels, finds one whose contract matches a new need, and serves it
only after running the new need's own frozen tests against it.

The library is off by default. `runNeed` consults it only when you pass one, and only on the current path (with
`ENDOFORGE_LOOP` unset). The specification stage still runs, because the new need's frozen tests are what a reused
kernel is judged against. A hit saves the implementation turn and the compile and gate work behind it.

## 1. Open a library and admit a promotion

```js
import { openLibrary } from './core/library/library.mjs';

const library = await openLibrary({ journal: 'library.jsonl' });
const [outcome] = await library.admit([{ ledger: 'first/ledger.sqlite', promotion: 'first/promotion.json' }]);
```

`admit` takes a ledger and its `promotion.json` (the current and `isolate` paths write one next to the ledger). It
verifies the ledger's hash chain, the promotion, the receipt and the bindings between them, then runs the kernel's own
tests again under the current gates. An admitted kernel gets a behavioural fingerprint and a key computed from its
capability (argument and result kinds, units, ranges, precision, code tables, whether it traps) and the numerals in its
contract. Every admission, reuse, refusal and revocation is appended to the journal, a separate hash chain.

## 2. Pass it to runNeed

```js
const result = await runNeed({ need, directory, pool, env, library });
```

After the freeze, the library looks the need up. On a match it runs the need's frozen tests against the stored kernel
in a warm worker thread, then a discrimination gate: mutants and wrappers of the kernel must fail the tests, or the
tests are too weak to tell the kernel apart and the library refuses. A pass returns
`{ promoted: true, reused: <reuse receipt> }` and skips implementation. Anything else falls through to normal
generation.

A need can only match if its frozen `CONTRACT.md` declares its capability in a fenced `capability` JSON block, so the
capability's hash is bound at the freeze. The generator's specification prompt does not ask for this block yet, so
generated needs currently miss with `no_capability`.

## Try it

[`examples/library-reuse.mjs`](../../../examples/library-reuse.mjs) runs three needs through the current path with
the `fake-codex.mjs` test double as the generator and the pinned compiler. The first is promoted and admitted, the
second declares a capability block and is served from the library, and the third has no capability block and misses:

```sh
node examples/library-reuse.mjs
```

```json
{
  "first": {
    "promoted": true,
    "modelStages": [
      "implementation",
      "specification"
    ]
  },
  "admitted": {
    "admitted": true,
    "entries": 1
  },
  "second": {
    "promoted": true,
    "reusedFrom": "first",
    "modelStages": [
      "specification"
    ]
  },
  "third": {
    "promoted": true,
    "reused": false,
    "modelStages": [
      "implementation",
      "specification"
    ]
  },
  "journal": "/tmp/ef-library-A0qAgi/library.jsonl"
}
```

`modelStages` lists the stages the generator was asked for. The second need never reached implementation. Its journal
holds two records: `library_admit` and `library_reuse`. A miss before any test run writes nothing.

## Why a lookup misses

`library.lookup(need)` and `library.serve(need)` return a reason:

| Reason | Meaning |
|---|---|
| `need_not_frozen` | The need's `frozen.sha256` does not match its contract and tests. |
| `no_capability` | The contract has no `capability` block. |
| `no_contract_match` | No admitted kernel has this key. |
| `revoked` | The matching kernel was revoked. |
| `needs_requalification` | The gates or host code changed since the kernel was admitted; run `requalify()`. |
| `ambiguous_key` | Two kernels that behave differently share the key, so the key does not pin the meaning. |
| `no_binding`, `unbound_test` | The need's exports or tests cannot be mapped onto the kernel's. |
| `evaluator_failed` | The need's frozen tests fail on the kernel (a refusal, journaled). |
| `evaluator_cannot_discriminate` | The tests pass but cannot tell the kernel from its mutants (a refusal, journaled). |

## Revoke and requalify

`library.revoke(id, reason)` stops the kernel and every admitted kernel with the same key and fingerprint, and returns
the reuse receipts that named them. `library.requalify()` re-runs each entry's own tests after the gates or host
change and retires the ones that fail. `library.close()` stops the worker threads.

## Limits

The key reads declared fields and numerals, not prose: two contracts that differ only in words ("round down",
"exclusive") get the same key, and only the new need's tests stand between them. In
[P-53](../../../experiments/P-53-library-v0/RESULT.md), 0 of 5,493 lookups served a wrong kernel when the tests
carried the fault, but 93 of 313 did when nothing frozen differed. That is why the library stays off by default. The
[library README](../../../core/library/README.md) covers the key, the discrimination gate and what v0 leaves out.
