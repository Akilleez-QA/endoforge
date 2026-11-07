import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const [directory, asPath, faultyPath] = process.argv.slice(2).map(path => resolve(path));
const evaluator = readFileSync(new URL('../../experiments/P-06-bounded-equivalence/run.mjs', import.meta.url), 'utf8');
const digest = createHash('sha256').update(evaluator).digest('hex');
assert.equal(digest, '6bc229b90ac807fc6333aadb0ec9fa32be1f92ba4ab5294ceeb55cb79b093bc7');
const frozen = evaluator.slice(evaluator.indexOf('const LO ='), evaluator.indexOf('function env('))
  + evaluator.slice(evaluator.indexOf('const K ='), evaluator.indexOf('const before = env'));
const { pairwise, oracleSample, invalidCodes, oracle } = runInNewContext(
  frozen + ';({pairwise, oracleSample, invalidCodes, oracle})', { performance });
const { instantiate } = await import(pathToFileURL(resolve(directory, 'kernel.js')));
class Buffer {
  constructor(bytes = new Uint8Array(16), error = null) { this.bytes = bytes; this.error = error; this.reads = 0; }
  size() { return BigInt(this.bytes.length); }
  read(offset, length) {
    assert.equal(offset, 0n); assert.equal(length, 16); this.reads++;
    if (this.error) throw this.error;
    return this.bytes.slice();
  }
}
const { reducer } = await instantiate(
  path => new WebAssembly.Module(readFileSync(resolve(directory, path))),
  { 'endoforge:kernel/buffers': { Buffer } });
assert.deepEqual(reducer.describe(), {
  contractVersion: '1.0.0', stateSchema: 'p06-result-i32le-v1',
  eventSchema: 'p06-args-4xi32le-v1', effectSchema: 'empty-v1',
});
const event = new Uint8Array(16), view = new DataView(event.buffer);
const empty = new Uint8Array();
const rs = { name: 'rust-native-reducer', convert: (v, f, t, b) => {
  [v, f, t, b].forEach((value, i) => view.setInt32(i * 4, value, true));
  const result = reducer.reduce(empty, event, []);
  assert.equal(result.effects.length, 0);
  assert.equal(result.state.byteLength, 4);
  return new DataView(result.state.buffer, result.state.byteOffset, 4).getInt32(0, true);
} };
const load = path => ({ name: path, convert: new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(path)), {}).exports.convert });
for (const length of [0, 1, 15, 17, 32]) {
  const result = reducer.reduce(new Uint8Array([1, 2]), new Uint8Array(length), []);
  assert.equal(new DataView(result.state.buffer, result.state.byteOffset, 4).getInt32(0, true), -2147483648);
  assert.equal(result.effects.length, 0);
}
assert.equal(rs.convert(-150, 0, 2, 0), oracle(-150, 0, 2, 0));
const buffer = new Buffer(event.slice());
for (let i = 0; i < 2; i++) {
  const result = reducer.reduce(new Uint8Array([99]), empty, [buffer]);
  assert.equal(new DataView(result.state.buffer, result.state.byteOffset, 4).getInt32(0, true), -2);
}
assert.equal(buffer.reads, 2);
for (const error of ['out-of-bounds', 'limit-exceeded']) {
  const result = reducer.reduce(empty, empty, [new Buffer(event, error)]);
  assert.equal(new DataView(result.state.buffer, result.state.byteOffset, 4).getInt32(0, true), -2147483648);
}
assert.equal(rs.convert(150, 0, 2, 0), 2);
const as = load(asPath), faulty = load(faultyPath);
console.error('P-06: bounded equivalence through the component reducer');
const equivalence = pairwise(as, rs);
assert.equal(equivalence.disagreements, 0);
console.error('P-06: frozen oracle sample and invalid codes');
const sample = oracleSample([as, rs]), invalid = invalidCodes([as, rs]);
for (const result of [...Object.values(sample.results), ...Object.values(invalid)]) assert.equal(result.wrong, 0);
console.error('P-06: seeded rounding fault');
const fault = pairwise(faulty, rs);
assert.ok(fault.disagreements > 0);
console.log(JSON.stringify({ label: 'local conformance, not campaign qualification', evaluator_sha256: digest,
  equivalence: { inputs: equivalence.inputs, disagreements: equivalence.disagreements },
  sample: sample.results, invalid, fault_exposing_inputs: fault.disagreements }));
