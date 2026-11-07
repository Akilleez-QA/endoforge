# TypeScript reducer compatibility

`contract.ts` binds [`kernel.wit`](../kernel/README.md) to erasable TypeScript. WIT byte lists
are `Uint8Array`, u64 is `bigint`, and u32 is a checked integer. Record names use
camelCase; read results use `{tag: 'ok', value}` or `{tag: 'err', value}`. The
exact WIT SHA-256 is pinned and tested against the source file.
`reference.ts` is a typed, one-byte counter control used by the conformance
tests; its schema names are test identifiers, not production schema registrations.

`probeTrustedReducer(reducer, expected, state, event, snapshots, limits)` checks
trusted reference implementations. It requires exactly `describe` and `reduce`,
contract version 1.0.0 and the admitted schema identities. It copies input and
output bytes, exposes frozen borrowed resources with only `size` and `read`,
counts reads across all resources and revokes handles on return or throw.
Bad WIT integers trap; valid reads return the WIT range/budget error variants.
Each invocation resets the read budget. Limits must be supplied explicitly;
input/output budgets count bytes, including UTF-8 effect names in output.
Each byte budget is capped at 16 MiB, with at most 1,024 inputs and effects.

Every passed or refused receipt has `lane: compatibility`, the WIT hash and
`validation: trusted-reducer-conformance-only`. Effects are returned as data;
no capability is dispatched. A pass does not certify determinism, authorize an
effect, admit an artifact or introduce a ledger record kind. Callers must not
mistake a compatibility receipt for a component-validation record.

This probe executes synchronously in the caller and is ONLY for trusted test
reducers. It cannot enforce CPU/heap bounds, restrict ambient JavaScript
capabilities or safely execute an untrusted candidate. Runtime integration must
move candidate invocation into an owned child isolate.
Snapshot copying is a bounded conformance model, not production host-buffer RPC.

## Checker

This lane holds no type checker. The checker is [tools/tscheck](../tscheck/README.md), which runs inside a V8 workcell of [IsolatePool](../../core/runtime/isolate-pool.mjs).

## Tests

Run `make compatibility-test`. It needs Node with TypeScript stripping and installs nothing. The tests cover the contract and the reference reducer only.

## Relation to the V8 workcell

This is the lane closest to the workcell: TypeScript kernels bound to the runtime-neutral WIT. It doesn't yet run in one. Remaining work is moving invocation into a process-mode `IsolatePool` workcell with host-buffer calls and a watchdog, then binding source, compiler, runtime, WIT and evaluator identities to receipts. Containment isn't established until then.
