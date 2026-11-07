// Controls for the held-out harness, no model calls: a hand-written correct kernel for
// each of three H needs must pass its held-out tests, and a seeded wrong kernel for each
// (a constant off, a bound exclusive, a missing trap) must fail them.
import assert from 'node:assert/strict';
import { compile, x1Flags } from '../assemblyscript-toolchain.mjs';
import { ASC_PATH } from '../../tools/asc/pin.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { hNeeds, heldOutTests } from './needs.mjs';
import { heldOut } from './heldout.mjs';

const kernels = {
  H01: { good: 'export function kwToHp(kw:f64):f64{if(!(kw>=0&&kw<=10000))abort();return kw*1000/745.699872}',
    bad: 'export function kwToHp(kw:f64):f64{if(!(kw>=0&&kw<=10000))abort();return kw*1000/746.0}' },
  H05: { good: 'export function subcoolingF(s:f64,l:f64):f64{if(!(s>=-100&&s<=200&&l>=-100&&l<=200))abort();return s-l}\nexport function subcoolStatus(x:f64,lo:f64,hi:f64):i32{if(isNaN(x)||isNaN(lo)||isNaN(hi)||lo>hi)abort();return x<lo?0:(x<=hi?1:2)}',
    bad: 'export function subcoolingF(s:f64,l:f64):f64{if(!(s>=-100&&s<=200&&l>=-100&&l<=200))abort();return s-l}\nexport function subcoolStatus(x:f64,lo:f64,hi:f64):i32{if(isNaN(x)||isNaN(lo)||isNaN(hi)||lo>hi)abort();return x<lo?0:(x<hi?1:2)}' },
  H10: { good: 'export function maxChargeKg(a:f64,h:f64,l:f64):f64{if(!(a>0&&a<=1000&&h>0&&h<=3&&l>0&&l<=1))abort();return 2.5*Math.pow(l,1.25)*h*Math.sqrt(a)}\nexport function r290MaxChargeKg(a:f64,h:f64):f64{return maxChargeKg(a,h,0.038)}',
    bad: 'export function maxChargeKg(a:f64,h:f64,l:f64):f64{if(!(a>0&&a<=1000&&h>0&&l>0&&l<=1))abort();return 2.5*Math.pow(l,1.25)*h*Math.sqrt(a)}\nexport function r290MaxChargeKg(a:f64,h:f64):f64{return maxChargeKg(a,h,0.038)}' },
};
for (const need of hNeeds) assert.ok(heldOutTests(need).length >= 7, `${need.id} has too few held-out tests`);
const results = {};
for (const [id, pair] of Object.entries(kernels)) {
  const tests = heldOutTests(hNeeds.find(need => need.id === id));
  for (const [kind, source] of Object.entries(pair)) {
    const bytes = await compile({ name: 'kernel', source }, ASC_PATH, { flags: x1Flags });
    assert.ok(bytes, `${id} ${kind} does not compile`);
    const files = { 'CONTRACT.md': 'control', 'tests.json': '[]', 'kernel.ts': source, 'glue.json': '{}' };
    const content = JSON.stringify({ id, files, compiled: { source: hash(source), wasm: Buffer.from(bytes).toString('base64') } });
    const result = heldOut(content, tests);
    results[`${id}-${kind}`] = { clean: result.clean, passed: result.passed, total: result.total };
    assert.equal(result.clean, kind === 'good', `${id} ${kind}: ${JSON.stringify(result).slice(0, 400)}`);
  }
}
console.log(JSON.stringify({ needs: hNeeds.length, heldOutTests: hNeeds.reduce((n, need) => n + heldOutTests(need).length, 0), results }));
