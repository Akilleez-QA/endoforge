import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../core/runtime/isolate-pool.mjs';
import { refusal, WIT_SHA256 } from './contract.ts';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const own = name => fileURLToPath(new URL(name, import.meta.url));
const hostPort = own('port.mjs');
const kernelWit = own('../kernel/kernel.wit');
const contractPath = own('contract.ts');

export const COMPATIBILITY_WORKCELL = Object.freeze({
  size: 1, isolation: 'process', jobTimeoutMs: 10000, jobDeadlineMs: 60000, retireAfterJobs: 1, wasmMemoryMaxMb: 16,
  resourceLimits: Object.freeze({ maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 }),
});

const served = new Map();
const integer = value => Number.isSafeInteger(value) && value >= 0;

export function serveHostBuffer(request, { data }) {
  const counter = served.get(data?.hostBufferJob);
  const buffers = data?.hostBuffers;
  if (!counter || !Array.isArray(buffers)) throw new Error('no host buffers for this job');
  if (request === null || typeof request !== 'object' || !integer(request.index) || request.index >= buffers.length) throw new Error('unknown host buffer');
  const buffer = buffers[request.index];
  counter.calls += 1;
  if (request.op === 'size') return buffer.byteLength;
  if (request.op !== 'read') throw new Error('unknown host buffer operation');
  const { offset, length } = request;
  if (!integer(offset) || !integer(length) || offset + length > buffer.byteLength) throw new Error('host buffer read out of bounds');
  counter.bytesRead += length;
  return buffer.slice(offset, offset + length);
}

export function createCompatibilityPool(options = {}) {
  return new IsolatePool({ ...COMPATIBILITY_WORKCELL, ...options, hostPort, syncHostCalls: serveHostBuffer });
}

export async function probeInWorkcell(pool, { reducer, expected, state, event, snapshots, limits }, { witPath = kernelWit } = {}) {
  if (typeof reducer?.source !== 'string' || typeof reducer.exportName !== 'string') {
    return { ...refusal('reducer source and export name required'), identities: null, workcell: null };
  }
  const contractSource = readFileSync(contractPath, 'utf8');
  const identities = {
    source: sha256(reducer.source),
    wit: sha256(readFileSync(witPath)),
    evaluator: sha256(contractSource + readFileSync(hostPort, 'utf8')),
    runtime: process.version,
    compiler: `node-strip-types/${process.versions.amaro}`,
  };
  const refuse = (reason, workcell = null) => ({ ...refusal(reason), identities, workcell });
  if (identities.wit !== WIT_SHA256) return refuse('WIT differs from the pinned contract');
  if ([state, event, ...(Array.isArray(snapshots) ? snapshots : [])].some(value => value?.buffer instanceof SharedArrayBuffer)) {
    return refuse('unshared bytes required');
  }
  if (!Array.isArray(snapshots) || snapshots.length > 1024) return refuse('buffer limit exceeded');
  if (!snapshots.every(value => value instanceof Uint8Array)) return refuse('unshared bytes required');
  let portOptions;
  try {
    portOptions = { contract: stripTypeScriptTypes(contractSource), expected, state, event, buffers: snapshots.length, limits,
      reducer: { javascript: stripTypeScriptTypes(reducer.source), exportName: reducer.exportName } };
  } catch (error) {
    return refuse(`reducer source: ${error.message}`);
  }
  let result;
  const hostBufferJob = randomUUID();
  const counter = { calls: 0, bytesRead: 0 };
  served.set(hostBufferJob, counter);
  try {
    result = await pool.run({ candidates: ['reducer'], ledger: 'caller', portOptions, hostBuffers: snapshots, hostBufferJob });
  } catch (error) {
    return refuse(`workcell: ${error.message}`);
  } finally {
    served.delete(hostBufferJob);
  }
  const { workcell: id = null, isolation, cgroup, resourceLimits, wasmMemoryMaxMb, reason, error, report } = result;
  const workcell = { id, isolation, cgroup, resourceLimits, wasmMemoryMaxMb };
  if (!report?.receipt) return refuse(`workcell: ${reason}${error ? ` (${error})` : ''}`, workcell);
  return { ...report.receipt, identities, workcell, hostBuffers: { ...counter } };
}
