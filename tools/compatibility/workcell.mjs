import { createHash } from 'node:crypto';
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

export function createCompatibilityPool(options = {}) {
  return new IsolatePool({ ...COMPATIBILITY_WORKCELL, ...options, hostPort });
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
  let portOptions;
  try {
    portOptions = { contract: stripTypeScriptTypes(contractSource), expected, state, event, snapshots, limits,
      reducer: { javascript: stripTypeScriptTypes(reducer.source), exportName: reducer.exportName } };
  } catch (error) {
    return refuse(`reducer source: ${error.message}`);
  }
  let result;
  try {
    result = await pool.run({ candidates: ['reducer'], ledger: 'caller', portOptions });
  } catch (error) {
    return refuse(`workcell: ${error.message}`);
  }
  const { workcell: id = null, isolation, cgroup, resourceLimits, wasmMemoryMaxMb, reason, error, report } = result;
  const workcell = { id, isolation, cgroup, resourceLimits, wasmMemoryMaxMb };
  if (!report?.receipt) return refuse(`workcell: ${reason}${error ? ` (${error})` : ''}`, workcell);
  return { ...report.receipt, identities, workcell };
}
