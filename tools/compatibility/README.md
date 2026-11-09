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

## Running in a workcell

`createCompatibilityPool(options)` in `workcell.mjs` returns an `IsolatePool` of process-mode workcells, as
[tscheck](../tscheck/README.md) uses, with a 10-second job timeout, a 64 MiB heap and one job per cell, so module state
cannot carry between reducers. `probeInWorkcell(pool, job)` takes `{reducer: {source, exportName}, expected, state,
event, snapshots, limits}`, where `source` is self-contained TypeScript or JavaScript text.

The host strips types and sends plain JavaScript, because Node's type stripper is WebAssembly with uncapped memory and
the cell's WebAssembly limit refuses it. `port.mjs` loads the contract and the reducer in the cell and runs the same
`probeTrustedReducer`. A reducer that hangs, exits or exhausts the heap gets a refused receipt whose reason names the
stop (`workcell: deadline`, `workcell: worker_exit`, `workcell: heap`), and the pool replaces the cell. Shared memory
and a WIT file that differs from the pin are refused before dispatch.

A workcell receipt adds `identities` (SHA-256 of the reducer source, the WIT and the evaluator; the Node version; the
type stripper version) and `workcell` (cell id, isolation, cgroup state and limits, or `null` when refused before
dispatch).

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

- `probeTrustedReducer` called directly runs synchronously in the caller and cannot bound CPU or heap.
- A workcell bounds wall-clock time, heap and WebAssembly memory, but the reducer still has Node's ambient capabilities
  (`process`, `node:fs`). The lane stays for trusted reducers and does not safely run an untrusted candidate.
- A pass does not certify determinism, authorize an effect, admit an artifact or create a ledger record. Do not
  mistake a compatibility receipt for a component-validation record.
- Snapshot copying is a bounded conformance model, not production host-buffer calls: the WIT `read` is synchronous and
  `IsolatePool` host calls are asynchronous, so snapshots are copied into the cell with the job.

The type checker for TypeScript is [tscheck](../tscheck/README.md); this lane holds none.

## Tests

`make compatibility-test` runs `contract.test.mjs` (18 tests). Eleven call the probe directly: the WIT pin, the
reference reducer, refusals of extra, missing, wrongly typed and asynchronous exports, budgets and borrowed-buffer
revocation. Seven run real workcells: the reference reducer in process and thread mode with its identities, refusals
from inside the cell, a hanging, exiting and heap-exhausting reducer, WIT drift and shared memory. It installs nothing.

Engineering record: component C-18, requirement REQ-COMPAT-001.
