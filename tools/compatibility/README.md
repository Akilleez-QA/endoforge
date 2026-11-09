# TypeScript reducer compatibility

This lane binds the [kernel contract](../kernel/README.md) (`kernel.wit`) to plain TypeScript, so a reducer written in
TypeScript can be described and checked against the same interface as a WebAssembly kernel: state and an event in,
next state and effects (as data) out. It holds the TypeScript types, a pinned hash of the WIT file, and a conformance
probe for trusted reference reducers. It does not run untrusted code.

## How it works

`contract.ts` maps the WIT to erasable TypeScript: byte lists are `Uint8Array`, u64 is `bigint`, u32 is a checked
integer, record names are camelCase, and read results are `{tag: 'ok', value}` or `{tag: 'err', value}`. `WIT_SHA256`
pins the exact WIT bytes, and a test checks it against the file.

`probeTrustedReducer(reducer, expected, state, event, snapshots, limits)`:

- requires exactly `describe` and `reduce`, contract version 1.0.0 and the admitted schema identities;
- copies input and output bytes, and exposes borrowed buffers that are frozen and have only `size` and `read`;
- counts reads across all buffers, resets the read budget per call, and revokes handles on return or throw;
- traps on bad WIT integers and returns the WIT `out-of-bounds` or `limit-exceeded` variants for valid reads;
- needs explicit limits: input, read and output budgets in bytes (UTF-8 effect names count), each capped at 16 MiB,
  and at most 1,024 inputs and effects.

Every receipt, passed or refused, has `lane: compatibility`, the WIT hash and
`validation: trusted-reducer-conformance-only`. Effects are returned as data; nothing is dispatched.

`reference.ts` is a one-byte counter used by the tests; its schema names are test identifiers.

## Example

Saved as `compat-demo.mjs` in the repository root (Node 22.18 or later strips the TypeScript types without a flag):

```js
import { probeTrustedReducer } from './tools/compatibility/contract.ts';
import { referenceReducer } from './tools/compatibility/reference.ts';
const meta = { contractVersion: '1.0.0', stateSchema: 'counter-v1', eventSchema: 'increment-v1', effectSchema: 'notify-v1' };
const limits = { inputBytes: 32, readBytes: 4, outputBytes: 64, effects: 2 };
const ok = probeTrustedReducer(referenceReducer, meta, Uint8Array.of(1), Uint8Array.of(2), [Uint8Array.of(3)], limits);
console.log(ok.status, ok.transition);
const extra = probeTrustedReducer({ ...referenceReducer, hidden() {} }, meta, Uint8Array.of(1), Uint8Array.of(2), [Uint8Array.of(3)], limits);
console.log(extra.status, extra.reason);
```

```console
$ node compat-demo.mjs
passed {
  state: Uint8Array(1) [ 6 ],
  effects: [
    {
      capability: 'notify',
      operation: 'changed',
      payload: [Uint8Array]
    }
  ]
}
refused record fields differ
```

State 1 plus event 2 plus buffer byte 3 gives 6, with one `notify` effect. A reducer with an extra export is refused.

## Limits

- The probe runs synchronously in the caller and is only for trusted test reducers. It cannot bound CPU or heap,
  restrict ambient JavaScript capabilities, or safely run an untrusted candidate.
- A pass does not certify determinism, authorize an effect, admit an artifact or create a ledger record. Do not
  mistake a compatibility receipt for a component-validation record.
- Snapshot copying is a bounded conformance model, not production host-buffer calls.
- This lane does not run in a workcell yet. The remaining work: move invocation into a process-mode `IsolatePool`
  workcell with host-buffer calls and a watchdog, then bind source, compiler, runtime, WIT and evaluator identities to
  receipts. Containment is not established until then.

The type checker for TypeScript is [tscheck](../tscheck/README.md); this lane holds none.

## Tests

`make compatibility-test` runs `contract.test.mjs` (11 tests: the WIT pin, the reference reducer, refusals of extra,
missing, wrongly typed and asynchronous exports, budgets and borrowed-buffer revocation). It installs nothing.

Engineering record: component C-18, requirement REQ-COMPAT-001.
