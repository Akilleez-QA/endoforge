import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TSRS_CORE_SHA256, TSRS_MODULE } from './pin.mjs';
import { exposePrepare, REUSE_DEFAULTS } from './tsrs-reuse.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
const VENDOR = new URL('node_modules/@tsrs/wasm/', import.meta.url);
const own = name => readFileSync(new URL(name, import.meta.url), 'utf8');

export function cohortPrepare({ layout = 'sibling', count, resourceLimits, checkDeadlineMs, memoryMb, reuse = false, baseline } = {}) {
  const core = readFileSync(new URL('core.js', VENDOR), 'utf8');
  if (sha256(core) !== TSRS_CORE_SHA256) throw new Error('tsrs core hash does not match the pin');
  const reusing = reuse === true ? { ...REUSE_DEFAULTS } : reuse || null;
  return {
    layout, count, resourceLimits, checkDeadlineMs, memoryMb,
    sources: [{ name: 'core', text: reusing ? exposePrepare(core) : core }, { name: 'check', text: own('check-core.mjs') },
      ...(reusing ? [{ name: 'reuse', text: own('tsrs-reuse.mjs') }] : []), { name: 'preparer', text: own('cohort-preparer.mjs') }],
    entry: 'preparer',
    wasm: [{ path: fileURLToPath(new URL('tsrs.wasm', VENDOR)), sha256: TSRS_MODULE.sha256 }],
    config: { compiler: { name: TSRS_MODULE.name, sha256: TSRS_MODULE.sha256 }, ...(reusing ? { reuse: reusing } : {}), ...(baseline ? { baseline } : {}) },
  };
}
