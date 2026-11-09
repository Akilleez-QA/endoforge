export const WIT_SHA256 = '4768b0a5910d7adedd071b26d2eb46e1e849ea5e7988015a80e29ec91c57613e';
export type ReadResult = { tag: 'ok'; value: Uint8Array } | {
  tag: 'err'; value: 'out-of-bounds' | 'limit-exceeded';
};
export interface BorrowedBuffer {
  size(): bigint;
  read(offset: bigint, length: number): ReadResult;
}
export interface HostBuffer {
  size(): number;
  read(offset: number, length: number): Uint8Array;
}
export interface Effect { capability: string; operation: string; payload: Uint8Array }
export interface Transition { state: Uint8Array; effects: Effect[] }
export interface Metadata {
  contractVersion: '1.0.0'; stateSchema: string; eventSchema: string; effectSchema: string;
}
export interface Reducer {
  describe(): Metadata;
  reduce(state: Uint8Array, event: Uint8Array, inputs: readonly BorrowedBuffer[]): Transition;
}
export interface Limits { inputBytes: number; readBytes: number; outputBytes: number; effects: number }
export type Receipt = {
  lane: 'compatibility'; validation: 'trusted-reducer-conformance-only'; witSha256: string;
} & ({ status: 'passed'; metadata: Metadata; transition: Transition } |
     { status: 'refused'; reason: string });

function requireValue(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object', 'record required');
  const observed = Reflect.ownKeys(value);
  requireValue(observed.length === keys.length && keys.every(key => observed.includes(key)), 'record fields differ');
  for (const key of keys) {
    requireValue(Object.getOwnPropertyDescriptor(value, key)?.get === undefined, 'accessor refused');
  }
}
function bytes(value: unknown, budget: { remaining: number }): Uint8Array {
  requireValue(value instanceof Uint8Array && (typeof SharedArrayBuffer === 'undefined' ||
    !(value.buffer instanceof SharedArrayBuffer)), 'unshared bytes required');
  requireValue(value.byteLength <= budget.remaining, 'byte limit exceeded');
  budget.remaining -= value.byteLength;
  return new Uint8Array(value);
}
function text(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 4096 && value.isWellFormed(), 'text required');
}
function metadata(value: unknown): Metadata {
  fields(value, ['contractVersion', 'stateSchema', 'eventSchema', 'effectSchema']);
  requireValue(value.contractVersion === '1.0.0', 'contract version differs');
  text(value.stateSchema); text(value.eventSchema); text(value.effectSchema);
  return { contractVersion: '1.0.0', stateSchema: value.stateSchema,
    eventSchema: value.eventSchema, effectSchema: value.effectSchema };
}
function limits(value: Limits): Limits {
  fields(value, ['inputBytes', 'readBytes', 'outputBytes', 'effects']);
  for (const item of Object.values(value)) {
    requireValue(typeof item === 'number' && Number.isSafeInteger(item) && item >= 0 && item <= 16 * 1024 * 1024, 'invalid limit');
  }
  requireValue(value.effects <= 1024, 'effect limit exceeds 1024');
  return { ...value };
}
function transition(value: unknown, policy: Limits): Transition {
  fields(value, ['state', 'effects']);
  const budget = { remaining: policy.outputBytes };
  const state = bytes(value.state, budget);
  requireValue(Array.isArray(value.effects) && value.effects.length <= policy.effects, 'effect limit exceeded');
  const effects: Effect[] = [];
  for (const effect of value.effects) {
    fields(effect, ['capability', 'operation', 'payload']);
    text(effect.capability); text(effect.operation);
    budget.remaining -= new TextEncoder().encode(effect.capability + effect.operation).length;
    requireValue(budget.remaining >= 0, 'byte limit exceeded');
    effects.push({ capability: effect.capability, operation: effect.operation, payload: bytes(effect.payload, budget) });
  }
  return { state, effects };
}

type Source = { byteLength: number; read(offset: number, length: number): Uint8Array };
function copied(copy: Uint8Array): Source {
  return { byteLength: copy.byteLength, read: (offset, length) => copy.slice(offset, offset + length) };
}
function hosted(value: unknown, budget: { remaining: number }): Source {
  fields(value, ['size', 'read']);
  const { size, read } = value;
  requireValue(typeof size === 'function' && typeof read === 'function', 'host buffer functions required');
  const byteLength = size();
  requireValue(Number.isSafeInteger(byteLength) && byteLength >= 0, 'host buffer size invalid');
  requireValue(byteLength <= budget.remaining, 'byte limit exceeded');
  budget.remaining -= byteLength;
  return {
    byteLength,
    read(offset, length) {
      const value = read(offset, length);
      requireValue(value instanceof Uint8Array && value.byteLength === length, 'host buffer read differs');
      return new Uint8Array(value);
    },
  };
}

const envelope = { lane: 'compatibility' as const,
  validation: 'trusted-reducer-conformance-only' as const, witSha256: WIT_SHA256 };

export function refusal(reason: string): Receipt {
  return { ...envelope, status: 'refused', reason };
}

export function probeTrustedReducer(
  reducer: Reducer, expected: Metadata, state: Uint8Array, event: Uint8Array,
  snapshots: readonly (Uint8Array | HostBuffer)[], policy: Limits,
): Receipt {
  let active = true;
  try {
    const bound = limits(policy);
    const wanted = metadata(expected);
    fields(reducer, ['describe', 'reduce']);
    requireValue(typeof reducer.describe === 'function' && typeof reducer.reduce === 'function', 'reducer functions required');
    const inputBudget = { remaining: bound.inputBytes };
    const stateCopy = bytes(state, inputBudget);
    const eventCopy = bytes(event, inputBudget);
    requireValue(Array.isArray(snapshots) && snapshots.length <= 1024, 'buffer limit exceeded');
    let readBudget = bound.readBytes;
    const handles = Object.freeze(Array.from(snapshots, snapshot => {
      const source = snapshot instanceof Uint8Array ? copied(bytes(snapshot, inputBudget)) : hosted(snapshot, inputBudget);
      return Object.freeze({
        size(): bigint {
          requireValue(active, 'expired buffer');
          return BigInt(source.byteLength);
        },
        read(offset: bigint, length: number): ReadResult {
          requireValue(active, 'expired buffer');
          requireValue(typeof offset === 'bigint' && offset >= 0n && offset <= 0xffffffffffffffffn, 'u64 offset required');
          requireValue(Number.isInteger(length) && length >= 0 && length <= 0xffffffff, 'u32 length required');
          if (offset + BigInt(length) > BigInt(source.byteLength)) return { tag: 'err', value: 'out-of-bounds' };
          if (length > readBudget) return { tag: 'err', value: 'limit-exceeded' };
          readBudget -= length;
          return { tag: 'ok', value: source.read(Number(offset), length) };
        },
      });
    }));
    const observed = metadata(reducer.describe());
    requireValue(Object.keys(wanted).every(key => wanted[key as keyof Metadata] === observed[key as keyof Metadata]), 'schema identity differs');
    const result = reducer.reduce(stateCopy, eventCopy, handles);
    active = false;
    return { ...envelope, status: 'passed', metadata: observed, transition: transition(result, bound) };
  } catch (error) {
    return refusal(error instanceof Error ? error.message : 'reducer threw');
  } finally {
    active = false;
  }
}
