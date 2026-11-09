import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { IsolatePool } from '../../runtime/isolate-pool.mjs';
import { runNeed } from '../../runtime/x1/pipeline.mjs';
import { candidate } from '../../runtime/test/fixtures/x1/candidate.mjs';
import { openLibrary } from '../library.mjs';
import { binding, capabilityFromGlue, contractVector, keysOf, numerals, range, sha256, similarity, unit } from '../key.mjs';
import { Journal } from '../journal.mjs';
import { link } from '../link.mjs';
import { discriminate, uncoveredBounds } from '../discriminate.mjs';
import { applied, mutantsOf } from '../mutants.mjs';
import { meter } from '../../runtime/x1/meter.mjs';
const fixture = name => fileURLToPath(new URL(`../../runtime/test/fixtures/x1/${name}`, import.meta.url));
const base = candidate();
const glue = { ...JSON.parse(base.files['glue.json']) };
const capability = capabilityFromGlue(glue);
const frozen = (contract, tests) => ({ 'CONTRACT.md': contract, 'tests.json': tests, 'frozen.sha256': JSON.stringify({ contract: sha256(contract), tests: sha256(tests) }) });
const need = (over = {}) => ({ id: 'new-need', capability: over.capability ?? capability, files: frozen(over.contract ?? base.files['CONTRACT.md'], over.tests ?? base.files['tests.json']) });
async function promoted(root) {
  const env = { ...process.env, CODEX_HOME: join(root, 'home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fixture('fake-codex.mjs')]), ENDOFORGE_ASC_CMD: fixture('fake-asc.mjs') };
  const pool = new IsolatePool({ hostPort: fixture('../../../x1/host.mjs'), size: 1, isolation: 'thread' });
  try {
    const directory = join(root, 'source');
    const result = await runNeed({ need: 'integer add(a,b)', directory, pool, env });
    assert.equal(result.promoted, true);
    return { ledger: join(directory, 'ledger.sqlite'), promotion: join(directory, 'promotion.json'), directory };
  } finally { await pool.close(); }
}
test('canonical key: semantic fields separate, labels and names do not', () => {
  const contract = 'Add within [-10,10]. Show 0 decimal places.';
  const keys = c => keysOf(c, contract).contract, base = { exports: [{ name: 'add', args: [{ name: 'a', kind: 'number', unit: 'kg', range: '0..10' }], result: { kind: 'number', unit: 'kg', precision: 2 } }], traps: ['add'] };
  const change = fn => { const c = JSON.parse(JSON.stringify(base)); fn(c); return keys(c); };
  assert.equal(change(c => { c.exports[0].name = 'sum'; c.traps = ['sum']; c.exports[0].args[0].name = 'x'; }), keys(base));
  for (const fn of [c => { c.exports[0].result.unit = 'g'; }, c => { c.exports[0].result.precision = 1; }, c => { c.exports[0].result.rounding = 'floor'; },
    c => { c.exports[0].args[0].range = '0..11'; }, c => { c.exports[0].args[0].range = '(0, 10]'; }, c => { c.traps = []; }, c => { c.exports[0].args[0].unit = 'lb'; }]) assert.notEqual(change(fn), keys(base));
  assert.notEqual(keysOf(base, 'Use 745.7 W per hp.').contract, keysOf(base, 'Use 746 W per hp.').contract);
  assert.equal(keysOf(base, 'Use 745.7 W per hp.').contract, keysOf(base, 'Multiply by 745.7 watts.').contract);
  assert.equal(keysOf(base, 'Use 745.7 W per hp.').interface, keysOf(base, 'Use 746 W per hp.').interface);
  assert.notEqual(keysOf(base, 'Use 745.7 W.').prose, keysOf(base, 'Multiply 745.7 W.').prose);
  assert.deepEqual(numerals('# C-005\nf64 i32 in [-10, 10] and 0..3 at 1.5e3.'), [-10, 0, 3, 10, 1500]);
  assert.equal(unit('°F'), 'degF'); assert.equal(unit('psig'), 'psig'); assert.notEqual(unit('kW'), unit('KW'));
  assert.deepEqual(range('0..3, finite'), { low: 0, high: 3, lowOpen: false, highOpen: false, note: '' });
  assert.deepEqual(range('(0, 1000]'), { low: 0, high: 1000, lowOpen: true, highOpen: false, note: '' });
  const twins = { exports: [{ name: 'a', args: [], result: { kind: 'number', unit: 'g', precision: 1 } }, { name: 'b', args: [], result: { kind: 'number', unit: 'g', precision: 1 } }], traps: [] };
  assert.deepEqual(binding(twins, twins), { a: 'a', b: 'b' });
  assert.equal(binding({ ...twins, exports: [{ ...twins.exports[0], name: 'x' }, { ...twins.exports[1], name: 'y' }] }, twins), null);
});
test('wasm mutants are valid modules in each class and unknown opcodes fail closed', () => {
  const bytes = Buffer.from(base.compiled.wasm, 'base64');
  const { sites } = mutantsOf(bytes);
  assert(sites.length > 0);
  const outcome = discriminate({ bytes, tests: JSON.parse(base.files['tests.json']), capability, numbers: numerals(base.files['CONTRACT.md']) });
  assert.equal(outcome.invalid, 0);
  assert.equal(outcome.mutants, outcome.killed + outcome.equivalent + outcome.survivors.length);
  const double = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 124, 1, 124, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 16, 1, 14, 0, 32, 0, 68, 0, 0, 0, 0, 0, 0, 0, 64, 162, 11]);
  const shape = { exports: [{ name: 'f', args: [{ name: 'x', kind: 'number', unit: 'g', range: '0..8' }], result: { kind: 'number', unit: 'g', precision: 2 } }], traps: [] };
  const weak = discriminate({ bytes: double, tests: [{ fn: 'f', args: [0], expect: 0 }], capability: shape, numbers: [] });
  assert(weak.survivors.some(s => s.kind === 'constants') && weak.survivors.some(s => s.kind === 'units'));
  assert(weak.wrappers.survivors.some(s => s.kind === 'negate'));
  const strong = discriminate({ bytes: double, tests: [{ fn: 'f', args: [1.37], expect: 2.74, tol: 1e-12 }], capability: shape, numbers: [] });
  assert.equal(strong.survivors.length + strong.wrappers.survivors.length, 0);
  assert(weak.survivors.length > 0 && mutantsOf(double).sites.some(s => s.insert));
  for (const site of mutantsOf(double).sites) new WebAssembly.Module(applied(double, site));
  const guarded = { exports: [{ ...shape.exports[0] }], traps: ['f'] };
  assert.deepEqual(uncoveredBounds(guarded, [{ fn: 'f', args: [-1], expectError: true }]), [{ fn: 'f', arg: 0, side: 'high' }]);
  assert.deepEqual(uncoveredBounds(guarded, [{ fn: 'f', args: [-1], expectError: true }, { fn: 'f', args: [9], expectError: true }]), []);
  const prefixed = Buffer.from(double); prefixed[prefixed.length - 2] = 0xfd;
  assert.throws(() => mutantsOf(prefixed), /opcode/);
});
test('admission, serving, refusal, revocation, requalification and restart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await promoted(root), path = join(root, 'library.jsonl');
  let library = await openLibrary({ journal: path, gate: 'none' });
  t.after(() => library.close());
  const decision = JSON.parse(await readFile(source.promotion, 'utf8'));
  const forged = join(root, 'forged.json');
  await writeFile(forged, JSON.stringify({ ...decision, decision: 'refuse' }));
  const wrongHash = join(root, 'hash.json');
  await writeFile(wrongHash, JSON.stringify({ ...decision, chain_tip: '0'.repeat(64) }));
  const refused = await library.admit([{ ledger: source.ledger, promotion: forged }, { ledger: source.ledger, promotion: wrongHash }, { ledger: join(root, 'absent.sqlite'), promotion: source.promotion }]);
  assert.deepEqual(refused.map(r => r.admitted), [false, false, false]);
  assert.equal(library.size, 0);
  const [admitted] = await library.admit([{ ledger: source.ledger, promotion: source.promotion, capability }]);
  assert.equal(admitted.admitted, true); assert.equal(admitted.hostMatches, true);
  assert.equal(admitted.id, decision.candidate);
  assert.equal((await library.admit([{ ledger: source.ledger, promotion: source.promotion, capability }]))[0].reason, 'already admitted');
  const hit = await library.serve(need());
  assert.equal(hit.verdict, 'pass');
  assert.equal(hit.receipt.source.decision, decision.sha256);
  assert.equal(hit.receipt.source.candidate, decision.candidate);
  assert.equal(hit.receipt.wasm, sha256(Buffer.from(base.compiled.wasm, 'base64')));
  const miss = await library.serve(need({ capability: { ...capability, exports: capability.exports.map(e => ({ ...e, result: { ...e.result, unit: 'kg' } })) } }));
  assert.equal(miss.verdict, 'miss'); assert.equal(miss.reason, 'no_contract_match');
  const tests = JSON.parse(base.files['tests.json']), wrong = tests.map(row => typeof row.expect === 'number' ? { ...row, expect: -row.expect - 1 } : row);
  const refusedRun = await library.serve(need({ tests: JSON.stringify(wrong) }));
  assert.equal(refusedRun.verdict, 'refused'); assert.equal(refusedRun.reason, 'evaluator_failed');
  const broken = need(); broken.files['tests.json'] = '[]';
  assert.equal((await library.serve(broken)).reason, 'need_not_frozen');
  assert.equal(library.lookup(need()).status, 'hit');
  const { covers, dependants } = library.revoke(admitted.id, 'found bad');
  assert.deepEqual(covers, [admitted.id]); assert.equal(dependants.length, 1);
  assert.equal(dependants[0].source.candidate, admitted.id);
  assert.equal((await library.serve(need())).reason, 'revoked');
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none' });
  assert.equal(library.size, 1);
  assert.equal((await library.serve(need())).reason, 'revoked');
  assert.equal(library.dependants(admitted.id).length, 1);
  await library.close();
  const lines = (await readFile(path, 'utf8')).trim().split('\n'), row = JSON.parse(lines[0]);
  await cp(path, `${path}.bad`);
  await writeFile(`${path}.bad`, [JSON.stringify({ ...row, body: row.body.replace('library_admit', 'library_admin') }), ...lines.slice(1)].join('\n'));
  await assert.rejects(openLibrary({ journal: `${path}.bad` }), /chain failed/);
  library = await openLibrary({ journal: join(root, 'fresh.jsonl'), gate: 'none' });
  await library.admit([{ ledger: source.ledger, promotion: source.promotion, capability }]);
  [...library.entries.values()][0].qualifiedHost = { gates: 'old', host: 'old' };
  assert.equal((await library.serve(need())).reason, 'needs_requalification');
  const requalified = await library.requalify();
  assert.deepEqual(requalified, { passed: [admitted.id], retired: [] });
  assert.equal((await library.serve(need())).verdict, 'pass');
});
test('the full gate refuses an evaluator that cannot discriminate', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await promoted(root), library = await openLibrary({});
  t.after(() => library.close());
  await library.admit([{ ledger: source.ledger, promotion: source.promotion, capability }]);
  const thin = JSON.stringify([{ name: 'zeros', fn: 'add', args: [0, 0], expect: 0 }]);
  const outcome = await library.serve(need({ tests: thin }));
  assert.equal(outcome.verdict, 'refused'); assert.equal(outcome.reason, 'evaluator_cannot_discriminate');
  assert(outcome.receipt.discrimination.survivors + outcome.receipt.discrimination.wrappers.survivors > 0);
});
test('nothing a cell imports can start a process', async () => {
  const pending = ['../cell.mjs'].map(name => new URL(name, import.meta.url)), seen = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const text = await readFile(url, 'utf8');
    assert.doesNotMatch(text, /child_process/, url.pathname);
    for (const [, name] of text.matchAll(/from '(\.[^']+)'/g)) pending.push(new URL(name, url));
  }
  assert(seen.size >= 5);
});
test('cell deadline turns a hang into a refusal', async t => {
  const { Cells } = await import('../cells.mjs');
  const cells = new Cells({ size: 1, deadlineMs: 200 });
  t.after(() => cells.close());
  await cells.ready();
  const spin = Buffer.from([0,97,115,109,1,0,0,0, 1,4,1,96,0,0, 3,2,1,0, 7,5,1,1,102,0,0, 10,9,1,7,0,3,64,12,0,11,11]);
  const { error } = await cells.run('fingerprint', { wasm: spin.toString('base64'), capability: { exports: [{ name: 'f', args: [], result: { kind: 'number' } }] }, numbers: [] });
  assert.equal(error, 'cell_timeout');
  assert.ok((await cells.run('fingerprint', { wasm: base.compiled.wasm, capability, numbers: [] })).result);
});
test('the pipeline call site reuses on a pass, generates on a miss and is off without a library', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ef-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await promoted(root), library = await openLibrary({ gate: 'none' });
  t.after(() => library.close());
  await library.admit([{ ledger: source.ledger, promotion: source.promotion, capability }]);
  const block = `Integer addition on [-10,10].\n\n\`\`\`capability\n${JSON.stringify(capability)}\n\`\`\`\n`;
  const env = record => ({ ...process.env, CODEX_HOME: join(root, 'home'), ENDOFORGE_CODEX_TEST_DOUBLE: '1', FAKE_CODEX_RECORD: join(root, record), FAKE_CODEX_CONTRACT: block,
    ENDOFORGE_CODEX_CMD: JSON.stringify([process.execPath, fixture('fake-codex.mjs')]), ENDOFORGE_ASC_CMD: fixture('fake-asc.mjs') });
  const stages = async record => (await readdir(root)).filter(name => name.startsWith(`${record}.`));
  const pool = new IsolatePool({ hostPort: fixture('../../../x1/host.mjs'), size: 1, isolation: 'thread' });
  t.after(() => pool.close());
  const hit = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'addition'), pool, env: env('hit'), library });
  assert.equal(hit.promoted, true); assert.equal(hit.reused.source.candidate, library.entries.keys().next().value);
  assert.deepEqual(await stages('hit'), ['hit.specification.json']);
  const off = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'off', 'addition').replace('off/', 'off-'), pool, env: env('off') });
  assert.equal(off.promoted, true); assert.equal(off.reused, undefined);
  assert.deepEqual((await stages('off')).sort(), ['off.implementation.json', 'off.specification.json']);
  const plain = { ...env('miss'), FAKE_CODEX_CONTRACT: 'Integer addition on [-10,10].' };
  const miss = await runNeed({ need: 'integer add(a,b)', directory: join(root, 'miss-addition'), pool, env: plain, library });
  assert.equal(miss.promoted, true); assert.equal(miss.reused, undefined);
  assert.deepEqual((await stages('miss')).sort(), ['miss.implementation.json', 'miss.specification.json']);
});
const seedHost = async path => { const probe = await openLibrary({ journal: path }); const { hostDigest, environment, environmentId } = probe; await probe.close(); return { hostDigest, environment, environmentId }; };
const wasmOf = bytes => Buffer.from(bytes).toString('base64');
const doubleWasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 6, 1, 96, 1, 124, 1, 124, 3, 2, 1, 0, 7, 5, 1, 1, 102, 0, 0, 10, 16, 1, 14, 0, 32, 0, 68, 0, 0, 0, 0, 0, 0, 0, 64, 162, 11]);
const addWasm = Uint8Array.from(Buffer.from(base.compiled.wasm, 'base64'));
const memoryWasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 5, 3, 1, 0, 1, 7, 5, 1, 1, 109, 0, 0, 10, 9, 1, 7, 0, 65, 0, 40, 2, 0, 11]);
const doubleCapability = { exports: [{ name: 'f', args: [{ name: 'x', kind: 'number', unit: '1' }], result: { kind: 'number', unit: '1', precision: 2 } }], traps: [] };
const addCapability = { exports: [{ name: 'add', args: ['a', 'b'].map(name => ({ name, kind: 'integer', unit: '1' })), result: { kind: 'integer', unit: '1' } }], traps: [] };
const glueFor = (id, cap) => JSON.stringify({ id, assumption: 'Inputs stay within the declared range.', question: 'Are these inputs sufficient for the need?', exports: cap.exports.map(item => ({ ...item, label: `Export ${item.name}` })), traps: [] });
const seededEntry = (host, { id, bytes, cap, contract, scope, label, fingerprint = id }) => {
  const source = `export const seeded = ${JSON.stringify(id)};`;
  return { id, glueId: id, wasm: wasmOf(bytes), wasmSha: sha256(bytes), source, sourceSha: sha256(source), glue: glueFor(id, cap), capability: cap, keys: keysOf(cap, contract), fingerprint,
    own: { contract, tests: JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]) }, qualifiedHost: host.hostDigest, qualifications: { [host.environmentId]: { environment: host.environment, ok: true } }, promotion: { candidate: id, decision: `decision-${id}` }, label, ...(scope ? { scope } : {}) };
};
const seeded = async (path, rows, options = {}) => {
  const host = await seedHost(path), journal = new Journal(path);
  for (const row of rows) journal.append({ kind: 'library_admit', entry: seededEntry(host, row) });
  journal.close();
  return openLibrary({ journal: path, ...options });
};
const scratch = async t => { const root = await mkdtemp(join(tmpdir(), 'ef-library-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
const entryRows = [{ id: 'adder', bytes: addWasm, cap: addCapability, contract: 'Integer addition of two whole values.' }, { id: 'doubler', bytes: doubleWasm, cap: doubleCapability, contract: 'Doubles a measured value.' }];
const pipelineCap = { exports: [{ name: 'pipe', args: ['a', 'b'].map(name => ({ name, kind: 'integer', unit: '1' })), result: { kind: 'number', unit: '1', precision: 2 } }], traps: [] };
const unionCap = { exports: [{ name: 'sum', args: addCapability.exports[0].args, result: addCapability.exports[0].result }, { name: 'twice', args: doubleCapability.exports[0].args, result: doubleCapability.exports[0].result }], traps: [] };
test('G5 link: union keeps each export, a pipeline feeds output to input, an adapter reorders, binds and converts', () => {
  const bytes = link([addWasm, doubleWasm], {
    exports: [{ name: 'sum', part: 0, fn: 'add' }, { name: 'twice', part: 1, fn: 'f' }],
    wrappers: [
      { name: 'pipe', params: ['i32', 'i32'], result: 'f64', stages: [{ part: 0, fn: 'add', args: [{ input: 0 }, { input: 1 }] }, { part: 1, fn: 'f', args: [{ previous: true }] }] },
      { name: 'celsius', params: ['f64'], result: 'f64', stages: [{ part: 1, fn: 'f', args: [{ input: 0, scale: 0.5, offset: 1 }] }] },
      { name: 'bumped', params: ['i32'], result: 'i32', stages: [{ part: 0, fn: 'add', args: [{ const: 7 }, { input: 0 }] }] },
      { name: 'rounded', params: ['f64', 'i32'], result: 'i32', stages: [{ part: 0, fn: 'add', args: [{ input: 1 }, { input: 0, narrow: 'nearest' }] }] },
    ] });
  const { exports: live } = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  assert.equal(live.sum(2, 3), 5); assert.equal(live.twice(4), 8);
  assert.equal(live.pipe(2, 3), 10); assert.equal(live.celsius(4), 6);
  assert.equal(live.bumped(1), 8); assert.equal(live.rounded(2.6, 1), 4);
  assert.throws(() => link([addWasm, doubleWasm], { wrappers: [{ name: 'lossy', params: ['f64'], result: 'i32', stages: [{ part: 0, fn: 'add', args: [{ input: 0 }, { const: 1 }] }] }] }), error => error.reason === 'adapter_narrowing');
  assert.throws(() => link([addWasm], { wrappers: [{ name: 'short', params: ['i32'], result: 'i32', stages: [{ part: 0, fn: 'add', args: [{ input: 0 }] }] }] }), error => error.reason === 'adapter_arity');
  const both = new WebAssembly.Instance(new WebAssembly.Module(link([memoryWasm, memoryWasm], { exports: [{ name: 'a', part: 0, fn: 'm' }, { name: 'b', part: 1, fn: 'm' }] })), {}).exports;
  assert.equal(both.a(), 0); assert.equal(both.b(), 0);
  const solo = new WebAssembly.Instance(new WebAssembly.Module(link([memoryWasm, addWasm], { exports: [{ name: 'a', part: 0, fn: 'm' }, { name: 'sum', part: 1, fn: 'add' }] })), {}).exports;
  assert.equal(solo.a(), 0); assert.equal(solo.sum(1, 1), 2);
});
test('G5 compose: a pipeline is gated on the need tests, journaled against every part, and refused when wrong', async t => {
  const root = await scratch(t), path = join(root, 'library.jsonl');
  let library = await seeded(path, entryRows, { gate: 'none' });
  t.after(() => library.close());
  const contract = 'Add two integers then double the sum.';
  const tests = JSON.stringify([{ name: 'pipe', fn: 'pipe', args: [2, 3], expect: 10 }]);
  const plan = { exports: [{ name: 'pipe', stages: [{ entry: 'adder', fn: 'add' }, { entry: 'doubler', fn: 'f' }] }] };
  const passed = await library.compose({ id: 'p', capability: pipelineCap, files: frozen(contract, tests) }, plan);
  assert.equal(passed.verdict, 'pass');
  assert.equal(passed.receipt.kind, 'library_compose');
  assert.deepEqual(passed.receipt.sources.map(s => s.candidate).sort(), ['adder', 'doubler']);
  assert.equal(passed.receipt.source.candidate, 'adder');
  assert.equal(passed.candidate.compiled.source, sha256(passed.candidate.files['kernel.ts']));
  assert.equal(library.dependants('doubler').length, 1);
  const wrong = JSON.stringify([{ name: 'pipe', fn: 'pipe', args: [2, 3], expect: 11 }]);
  const refused = await library.compose({ capability: pipelineCap, files: frozen(contract, wrong) }, plan);
  assert.equal(refused.verdict, 'refused'); assert.equal(refused.reason, 'evaluator_failed');
  assert.equal((await library.compose({ capability: pipelineCap, files: frozen(contract, tests) }, { exports: [{ name: 'other', entry: 'adder', fn: 'add' }] })).reason, 'plan_mismatch');
  assert.equal((await library.compose({ capability: pipelineCap, files: frozen(contract, tests) }, { exports: [{ name: 'pipe', stages: [{ entry: 'ghost', fn: 'add' }] }] })).reason, 'unknown_part');
  library.revoke('doubler', 'bad');
  assert.equal((await library.compose({ capability: pipelineCap, files: frozen(contract, tests) }, plan)).reason, 'revoked');
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none' });
  assert.equal(library.dependants('adder').length, 1);
});
test('G5 serve composes a union when no single entry holds the whole capability', async t => {
  const root = await scratch(t), library = await seeded(join(root, 'library.jsonl'), entryRows, { gate: 'none' });
  t.after(() => library.close());
  const tests = JSON.stringify([{ name: 'sum', fn: 'sum', args: [2, 3], expect: 5 }, { name: 'twice', fn: 'twice', args: [4], expect: 8 }]);
  const served = await library.serve({ id: 'u', capability: unionCap, files: frozen('Sum and double.', tests) });
  assert.equal(served.verdict, 'pass');
  assert.equal(served.receipt.kind, 'library_compose');
  const partial = { exports: [unionCap.exports[0], { ...unionCap.exports[1], result: { ...unionCap.exports[1].result, unit: 'kg' } }], traps: [] };
  assert.equal((await library.serve({ capability: partial, files: frozen('Sum and double.', tests) })).reason, 'no_contract_match');
});
test('G6 retrieval ranks by normalized contract text before the key match and is deterministic and offline', async t => {
  assert(similarity(contractVector('Integer addition on [-10,10].'), contractVector('Addition of integers within [-10,10]!')) > similarity(contractVector('Integer addition on [-10,10].'), contractVector('Converts pressure readings to kilopascals.')));
  const root = await scratch(t), library = await seeded(join(root, 'library.jsonl'), entryRows, { gate: 'none', retrieval: 'semantic' });
  t.after(() => library.close());
  const tests = JSON.stringify([{ name: 'plus', fn: 'plus', args: [2, 3], expect: 5 }]);
  const ranked = library.retrieve('Integer addition for two whole values');
  assert.deepEqual(ranked.map(r => r.id), ['adder', 'doubler']);
  assert.deepEqual(library.retrieve('Integer addition for two whole values'), ranked);
  const found = library.lookup({ files: frozen('Addition of two whole integer values.', tests) });
  assert.equal(found.status, 'hit'); assert.equal(found.entry.id, 'adder'); assert.equal(found.retrieved[0].id, 'adder');
  assert.equal(found.tests[0].fn, 'add');
  const far = library.lookup({ files: frozen('Converts pressure readings to kilopascals.', tests) });
  assert.equal(far.status, 'miss'); assert.equal(far.reason, 'no_capability');
  const numeral = library.lookup({ files: frozen('Addition of two whole integer values above 40.', tests) });
  assert.equal(numeral.status, 'miss');
  const keyOnly = await seeded(join(root, 'other.jsonl'), entryRows, { gate: 'none' });
  t.after(() => keyOnly.close());
  assert.equal(keyOnly.lookup({ files: frozen('Addition of two whole integer values.', tests) }).reason, 'no_capability');
  const nearest = library.lookup({ capability: { exports: [{ ...addCapability.exports[0], result: { kind: 'integer', unit: 'kg' } }], traps: [] }, files: frozen('Integer addition of two whole values.', tests) });
  assert.equal(nearest.reason, 'no_contract_match'); assert.equal(nearest.nearest[0].id, 'adder');
});
test('G7 tenants are isolated, lineages are checked on reuse and grants are journaled', async t => {
  const root = await scratch(t), path = join(root, 'library.jsonl'), contract = 'Integer addition of two whole values.';
  let library = await seeded(path, [{ id: 'adder', bytes: addWasm, cap: addCapability, contract, scope: { tenant: 'acme', lineage: 'acme/payments' } }], { gate: 'none' });
  t.after(() => library.close());
  const tests = JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]);
  const asked = () => ({ capability: addCapability, files: frozen(contract, tests) });
  assert.equal((await library.serve(asked(), { principal: { tenant: 'acme', lineage: 'acme/payments/eu' } })).verdict, 'pass');
  assert.equal((await library.serve(asked(), { principal: { tenant: 'acme', lineage: 'acme/search' } })).reason, 'permission_denied');
  assert.equal((await library.serve(asked(), { principal: { tenant: 'globex' } })).reason, 'no_contract_match');
  assert.equal((await library.serve(asked())).reason, 'no_contract_match');
  assert.deepEqual(library.retrieve(contract, { principal: { tenant: 'globex' } }), []);
  assert.throws(() => library.grant('adder', { tenant: 'globex' }, { by: { tenant: 'globex' } }), /permission/);
  library.grant('adder', { tenant: 'globex' }, { by: { tenant: 'acme', lineage: 'acme/payments' } });
  assert.equal((await library.serve(asked(), { principal: { tenant: 'globex' } })).verdict, 'pass');
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none' });
  const served = await library.serve(asked(), { principal: { tenant: 'globex' } });
  assert.equal(served.verdict, 'pass'); assert.deepEqual(served.receipt.principal, { tenant: 'globex' });
  library.ungrant('adder', { tenant: 'globex' }, { by: { tenant: 'acme', lineage: 'acme/payments' } });
  assert.equal((await library.serve(asked(), { principal: { tenant: 'globex' } })).reason, 'no_contract_match');
  const denied = await library.compose({ capability: addCapability, files: frozen(contract, tests) }, { exports: [{ name: 'add', entry: 'adder', fn: 'add' }] }, { principal: { tenant: 'globex' } });
  assert.equal(denied.reason, 'permission_denied');
});
test('G7 entries admitted through a principal carry its scope', async t => {
  const root = await scratch(t), source = await promoted(root);
  const library = await openLibrary({ gate: 'none', principal: { tenant: 'acme', lineage: 'acme/a' } });
  t.after(() => library.close());
  const [{ id }] = await library.admit([{ ledger: source.ledger, promotion: source.promotion, capability }]);
  assert.deepEqual(library.entries.get(id).scope, { tenant: 'acme', lineage: 'acme/a' });
  assert.equal((await library.serve(need(), { principal: { tenant: 'other' } })).reason, 'no_contract_match');
  assert.equal((await library.serve(need())).verdict, 'pass');
});
test('G8 reclaim keeps one entry per behaviour within a scope and frees the rest, in memory and on disk', async t => {
  const root = await scratch(t), path = join(root, 'library.jsonl'), contract = 'Integer addition of two whole values.';
  const twin = (id, more = {}) => ({ id, bytes: addWasm, cap: addCapability, contract, fingerprint: 'same', ...more });
  let library = await seeded(path, [twin('first'), twin('second'), twin('other', { fingerprint: 'different' }), twin('walled', { scope: { tenant: 'acme' } })], { gate: 'none' });
  t.after(() => library.close());
  const tests = JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]);
  const before = (await readFile(path, 'utf8')).length;
  const outcome = library.reclaim();
  assert.deepEqual(outcome.reclaimed, [{ id: 'second', into: 'first' }]);
  assert(outcome.bytes > 0);
  assert.equal(library.size, 3);
  assert.equal(library.entries.get('second').wasm, null);
  assert((await readFile(path, 'utf8')).length < before);
  library.revoke('other', 'wrong');
  assert.equal(library.lookup({ capability: addCapability, files: frozen(contract, tests) }).entry.id, 'first');
  assert.deepEqual(library.reclaim().reclaimed, []);
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none' });
  assert.equal(library.size, 3);
  assert.equal(library.entries.get('second').reclaimedInto, 'first');
  assert.equal((await library.serve({ capability: addCapability, files: frozen(contract, tests) })).verdict, 'pass');
  const { covers } = library.revoke('second', 'bad');
  assert.deepEqual(covers.sort(), ['first', 'second']);
});
test('G9 a refusal becomes counterexamples that narrow later search, and survives restart', async t => {
  const root = await scratch(t), path = join(root, 'library.jsonl'), contract = 'Integer addition of two whole values.';
  let library = await seeded(path, [entryRows[0]], { gate: 'full' });
  t.after(() => library.close());
  const asked = rows => ({ capability: addCapability, files: frozen(contract, JSON.stringify(rows)) });
  const wrong = [{ name: 'add', fn: 'add', args: [2, 3], expect: 6 }];
  const first = await library.serve(asked(wrong));
  assert.equal(first.reason, 'evaluator_failed');
  assert.deepEqual(first.counterexamples, [{ fn: 'add', args: [2, 3], got: 5 }]);
  const stricter = [{ name: 'one', fn: 'add', args: [1, 1], expect: 2 }, { name: 'two', fn: 'add', args: [2, 3], expect: 7 }];
  const narrowed = library.lookup(asked(stricter));
  assert.equal(narrowed.status, 'miss'); assert.equal(narrowed.reason, 'counterexample');
  assert.deepEqual(narrowed.counterexamples, [{ fn: 'add', args: [2, 3], got: 5 }]);
  assert.equal((await library.serve(asked(stricter))).verdict, 'miss');
  assert.equal(library.lookup(asked([{ name: 'ok', fn: 'add', args: [2, 3], expect: 5 }])).status, 'hit');
  const thin = [{ name: 'zeros', fn: 'add', args: [0, 0], expect: 0 }];
  const weak = await library.serve(asked(thin));
  assert.equal(weak.reason, 'evaluator_cannot_discriminate');
  assert(weak.witnesses.length > 0 && weak.witnesses.every(w => w.fn === 'add' && Array.isArray(w.args)));
  const again = library.lookup(asked(thin));
  assert.equal(again.reason, 'counterexample'); assert.equal(again.refused, 'evaluator_cannot_discriminate'); assert(again.witnesses.length > 0);
  await library.close();
  library = await openLibrary({ journal: path, gate: 'full' });
  assert.equal(library.lookup(asked(stricter)).reason, 'counterexample');
  assert.equal(library.lookup(asked(thin)).reason, 'counterexample');
  assert.deepEqual(library.counterexamples('adder'), [{ fn: 'add', args: [2, 3], got: 5 }]);
});
test('G10 qualification is recorded per environment; a new environment requalifies without losing the old one', async t => {
  const root = await scratch(t), path = join(root, 'library.jsonl'), contract = 'Integer addition of two whole values.';
  const tests = JSON.stringify([{ name: 'add', fn: 'add', args: [2, 3], expect: 5 }]);
  const asked = () => ({ capability: addCapability, files: frozen(contract, tests) });
  const adder = entryRows[0];
  const seed = await seeded(path, [{ ...adder, contract }], { gate: 'none' });
  t.after(() => seed.close());
  const home = seed.environmentId;
  assert.equal(seed.qualifications('adder')[home].ok, true);
  assert.equal(seed.lookup(asked()).status, 'hit');
  await seed.close();
  const elsewhere = { node: 'v99.0.0', v8: '99.9', platform: 'linux', arch: 'riscv64' };
  let library = await openLibrary({ journal: path, gate: 'none', environment: elsewhere });
  t.after(() => library.close());
  assert.notEqual(library.environmentId, home);
  assert.equal(library.lookup(asked()).reason, 'needs_requalification');
  assert.deepEqual(await library.requalify(), { passed: ['adder'], retired: [] });
  assert.equal(library.lookup(asked()).status, 'hit');
  const held = library.qualifications('adder');
  assert.equal(Object.keys(held).length, 2);
  assert.deepEqual(held[library.environmentId].environment, elsewhere);
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none', environment: elsewhere });
  assert.equal(library.lookup(asked()).status, 'hit');
  assert.equal(Object.keys(library.qualifications('adder')).length, 2);
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none' });
  assert.equal(library.environmentId, home);
  assert.equal(library.lookup(asked()).status, 'hit');
  assert.equal((await library.serve(asked())).receipt.environment, home);
});
test('G10 a failing requalification in a new environment does not revoke the entry elsewhere', async t => {
  const root = await scratch(t), path = join(root, 'library.jsonl'), contract = 'Integer addition of two whole values.';
  const failing = JSON.stringify([{ name: 'bad', fn: 'add', args: [1, 1], expect: 3 }]);
  const host = await seedHost(path), journal = new Journal(path);
  journal.append({ kind: 'library_admit', entry: { ...seededEntry(host, { id: 'adder', bytes: addWasm, cap: addCapability, contract }), own: { contract, tests: failing } } });
  journal.close();
  let library = await openLibrary({ journal: path, gate: 'none', environment: { node: 'v99.0.0', v8: '99.9', platform: 'linux', arch: 'riscv64' } });
  t.after(() => library.close());
  const outcome = await library.requalify();
  assert.deepEqual(outcome, { passed: [], retired: [], failed: ['adder'] });
  assert.equal(library.isRevoked('adder'), false);
  assert.equal(library.qualifications('adder')[library.environmentId].ok, false);
  await library.close();
  library = await openLibrary({ journal: path, gate: 'none' });
  assert.equal(library.isRevoked('adder'), false);
  assert.equal(library.lookup({ capability: addCapability, files: frozen(contract, failing) }).status, 'hit');
});
const mleb = value => { const out = []; let n = value; do { const part = n % 128; n = Math.floor(n / 128); out.push(part | (n ? 128 : 0)); } while (n); return out; };
const sec = (id, content) => (content.length ? [id, ...mleb(content.length), ...content] : []);
const vec = rows => [...mleb(rows.length), ...rows.flat()];
const str = text => [...mleb(Buffer.byteLength(text)), ...Buffer.from(text)];
const I32 = 0x7f, F64 = 0x7c;
const f64 = value => { const out = new Uint8Array(8); new DataView(out.buffer).setFloat64(0, value, true); return [...out]; };
const assemble = ({ types = [], funcs = [], memory = null, tables = 0, elements = [], data = [], exports = [] }) => Uint8Array.from([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...sec(1, vec(types.map(([params, results]) => [0x60, ...vec(params.map(p => [p])), ...vec(results.map(r => [r]))]))),
  ...sec(3, vec(funcs.map(f => mleb(f.type)))),
  ...(tables ? sec(4, vec([[0x70, 0, tables]])) : []),
  ...(memory ? sec(5, vec([memory.max === undefined ? [0, ...mleb(memory.initial)] : [1, ...mleb(memory.initial), ...mleb(memory.max)]])) : []),
  ...sec(7, vec(exports.map(([name, index]) => [...str(name), 0, index]))),
  ...(elements.length ? sec(9, vec(elements.map(([at, list]) => [0, 0x41, at, 0x0b, ...vec(list.map(f => [f]))]))) : []),
  ...sec(10, vec(funcs.map(f => { const body = [0, ...f.code, 0x0b]; return [...mleb(body.length), ...body]; }))),
  ...(data.length ? sec(11, vec(data.map(([at, bytes]) => [0, 0x41, at, 0x0b, ...vec(bytes.map(b => [b]))]))) : []),
]);
const live = bytes => new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
const counter = (name, step, extra = {}) => assemble({
  types: [[[], [I32]]],
  funcs: [{ type: 0, code: [0x41, 0, 0x41, 0, 0x28, 2, 0, 0x41, step, 0x6a, 0x36, 2, 0, 0x41, 0, 0x28, 2, 0] }],
  memory: { initial: 1, max: 1 }, exports: [[name, 0]], ...extra });
const peek = assemble({ types: [[[I32], [I32]]], funcs: [{ type: 0, code: [0x20, 0, 0x28, 2, 0] }], memory: { initial: 1, max: 1 }, exports: [['peek', 0]] });
const poke = assemble({ types: [[[I32, I32], []]], funcs: [{ type: 0, code: [0x20, 0, 0x20, 1, 0x36, 2, 0] }], memory: { initial: 1, max: 1 }, exports: [['poke', 0]] });
const growing = assemble({ types: [[[I32], [I32]], [[], [I32]]], funcs: [{ type: 0, code: [0x20, 0, 0x40, 0] }, { type: 1, code: [0x3f, 0] }], memory: { initial: 1, max: 3 }, exports: [['grow', 0], ['size', 1]] });
const seededData = assemble({ types: [[[], [I32]]], funcs: [{ type: 0, code: [0x41, 16, 0x28, 2, 0] }], memory: { initial: 1, max: 1 }, data: [[16, [42, 0, 0, 0]]], exports: [['seed', 0]] });
const bulk = assemble({ types: [[[], [I32]]], funcs: [{ type: 0, code: [0x41, 32, 0x41, 7, 0x41, 4, 0xfc, 11, 0, 0x41, 48, 0x41, 32, 0x41, 4, 0xfc, 10, 0, 0, 0x41, 48, 0x28, 2, 0] }], memory: { initial: 1, max: 1 }, exports: [['bulk', 0]] });
const dispatcher = (name, value) => assemble({
  types: [[[], [I32]], [[I32], [I32]]],
  funcs: [{ type: 0, code: [0x41, value] }, { type: 1, code: [0x20, 0, 0x11, 0, 0] }],
  tables: 1, elements: [[0, [0]]], exports: [[name, 1]] });

const recordStep = (name, delta, scale) => assemble({
  types: [[[I32, I32], []]],
  funcs: [{ type: 0, code: [0x20, 1, 0x20, 0, 0x2b, 3, 0, 0x44, ...f64(scale), 0xa2, 0x44, ...f64(delta), 0xa0, 0x39, 3, 0] }],
  memory: { initial: 1, max: 1 }, exports: [[name, 0]] });
const inc = recordStep('inc', 1, 1), dbl = recordStep('dbl', 0, 2);
const balance = { kind: 'record', label: 'Balance', fields: [{ name: 'total', kind: 'number', unit: 'kg', label: 'Total', precision: 2 }] };
const stepCap = name => ({ exports: [{ name, args: [{ ...balance, name: 'state' }], result: balance }], traps: [] });
const seed = async (path, rows, options) => {
  const probe = await openLibrary({ journal: path }), { hostDigest, environment, environmentId } = probe;
  await probe.close();
  const journal = new Journal(path);
  for (const { id, bytes, cap, contract } of rows) {
    const source = `export const seeded = ${JSON.stringify(id)};`, tests = '[]';
    journal.append({ kind: 'library_admit', entry: { id, glueId: id, wasm: Buffer.from(bytes).toString('base64'), wasmSha: sha256(bytes), source, sourceSha: sha256(source), glue: glueFor(id, cap), capability: cap, keys: keysOf(cap, contract), fingerprint: id, own: { contract, tests }, promotion: { candidate: id, decision: `decision-${id}` }, qualifiedHost: hostDigest, qualifications: { [environmentId]: { environment, ok: true } } } });
  }
  journal.close();
  return openLibrary({ journal: path, gate: 'none', ...options });
};

test('H7 two parts that use linear memory link, and each keeps its own state', () => {
  const { a, b } = live(link([counter('a', 1), counter('b', 10)], { exports: [{ name: 'a', part: 0, fn: 'a' }, { name: 'b', part: 1, fn: 'b' }] }));
  assert.deepEqual([a(), a(), b(), a(), b()], [1, 2, 10, 3, 20]);
});
test('H7 a part cannot read or write outside its own memory', () => {
  const { peek: read, poke: write } = live(link([peek, poke], { exports: [{ name: 'peek', part: 0, fn: 'peek' }, { name: 'poke', part: 1, fn: 'poke' }] }));
  write(0, 77);
  assert.equal(read(0), 0);
  write(65532, 5);
  assert.equal(read(65532), 0);
  assert.throws(() => read(65533), WebAssembly.RuntimeError);
  assert.throws(() => write(65536, 1), WebAssembly.RuntimeError);
  assert.throws(() => read(-4), WebAssembly.RuntimeError);
});
test('H7 memory.size, memory.grow, data segments and bulk operations stay inside the part', () => {
  const linked = live(link([growing, seededData, bulk], { exports: [{ name: 'grow', part: 0, fn: 'grow' }, { name: 'size', part: 0, fn: 'size' }, { name: 'seed', part: 1, fn: 'seed' }, { name: 'bulk', part: 2, fn: 'bulk' }] }));
  assert.equal(linked.size(), 1);
  assert.equal(linked.grow(1), 1);
  assert.equal(linked.size(), 2);
  assert.equal(linked.grow(5), -1);
  assert.equal(linked.size(), 2);
  assert.equal(linked.seed(), 42);
  assert.equal(linked.bulk(), 0x07070707);
});
test('H7 parts with tables link, each dispatching through its own table', () => {
  const { x, y } = live(link([dispatcher('x', 5), dispatcher('y', 9)], { exports: [{ name: 'x', part: 0, fn: 'x' }, { name: 'y', part: 1, fn: 'y' }] }));
  assert.equal(x(0), 5);
  assert.equal(y(0), 9);
  assert.throws(() => x(1), WebAssembly.RuntimeError);
});
test('H7 the linked module still meters, and its mutants stay valid', () => {
  const bytes = link([counter('a', 1), counter('b', 10)], { exports: [{ name: 'a', part: 0, fn: 'a' }, { name: 'b', part: 1, fn: 'b' }] });
  const metered = live(meter(Buffer.from(bytes), 1_000_000));
  assert.equal(metered.a(), 1);
  assert.equal(metered.b(), 10);
  const { sites } = mutantsOf(bytes);
  assert(sites.length > 0);
  for (const site of sites) new WebAssembly.Module(applied(bytes, site));
});
test('H7 a plan that cannot fit every part in the memory budget is refused', () => {
  const big = name => assemble({ types: [[[], [I32]]], funcs: [{ type: 0, code: [0x41, 0, 0x28, 2, 0] }], memory: { initial: 600, max: 600 }, exports: [[name, 0]] });
  assert.throws(() => link([big('a'), big('b')], { exports: [{ name: 'a', part: 0, fn: 'a' }, { name: 'b', part: 1, fn: 'b' }] }), error => error.reason === 'memory_conflict');
});
test('H7 compose gates a two-memory union through the cell', async t => {
  const root = await scratch(t);
  const cap = name => ({ exports: [{ name, args: [], result: { kind: 'integer', unit: '1' } }], traps: [] });
  const library = await seed(join(root, 'l.jsonl'), [{ id: 'first', bytes: counter('a', 1), cap: cap('a'), contract: 'First counter.' }, { id: 'second', bytes: counter('b', 10), cap: cap('b'), contract: 'Second counter.' }]);
  t.after(() => library.close());
  const capability = { exports: [...cap('a').exports, ...cap('b').exports], traps: [] };
  const tests = JSON.stringify([{ name: 'a', fn: 'a', args: [], expect: 1 }, { name: 'b', fn: 'b', args: [], expect: 10 }]);
  const plan = { exports: [{ name: 'a', entry: 'first', fn: 'a' }, { name: 'b', entry: 'second', fn: 'b' }] };
  const served = await library.compose({ id: 'u', capability, files: frozen('Two counters.', tests) }, plan);
  assert.equal(served.verdict, 'pass', JSON.stringify(served));
  assert.deepEqual(served.receipt.sources.map(s => s.candidate).sort(), ['first', 'second']);
});
test('H7 a structured pipeline copies state between the parts\' memories and passes the gates', async t => {
  const root = await scratch(t);
  const library = await seed(join(root, 'l.jsonl'), [{ id: 'incer', bytes: inc, cap: stepCap('inc'), contract: 'Adds one to the balance.' }, { id: 'doubler', bytes: dbl, cap: stepCap('dbl'), contract: 'Doubles the balance.' }]);
  t.after(() => library.close());
  const capability = stepCap('step');
  const tests = JSON.stringify([{ name: 'step', fn: 'step', args: [{ total: 3 }], expect: { total: 8 } }, { name: 'zero', fn: 'step', args: [{ total: 0 }], expect: { total: 2 } }]);
  const plan = { exports: [{ name: 'step', stages: [{ entry: 'incer', fn: 'inc' }, { entry: 'doubler', fn: 'dbl' }] }] };
  const served = await library.compose({ id: 's', capability, files: frozen('Add one then double the balance.', tests) }, plan);
  assert.equal(served.verdict, 'pass', JSON.stringify(served));
  const wrong = JSON.stringify([{ name: 'step', fn: 'step', args: [{ total: 3 }], expect: { total: 9 } }]);
  assert.equal((await library.compose({ capability, files: frozen('Add one then double the balance.', wrong) }, plan)).verdict, 'refused');
});
test('H7 a structured union export takes the host buffer through the part\'s window', async t => {
  const root = await scratch(t);
  const library = await seed(join(root, 'l.jsonl'), [{ id: 'incer', bytes: inc, cap: stepCap('inc'), contract: 'Adds one to the balance.' }, { id: 'doubler', bytes: dbl, cap: stepCap('dbl'), contract: 'Doubles the balance.' }]);
  t.after(() => library.close());
  const capability = { exports: [...stepCap('inc').exports, ...stepCap('dbl').exports], traps: [] };
  const tests = JSON.stringify([{ name: 'inc', fn: 'inc', args: [{ total: 3 }], expect: { total: 4 } }, { name: 'dbl', fn: 'dbl', args: [{ total: 3 }], expect: { total: 6 } }]);
  const plan = { exports: [{ name: 'inc', entry: 'incer', fn: 'inc' }, { name: 'dbl', entry: 'doubler', fn: 'dbl' }] };
  const served = await library.compose({ id: 'su', capability, files: frozen('Add one or double.', tests) }, plan);
  assert.equal(served.verdict, 'pass', JSON.stringify(served));
});
test('H7 a pipeline whose stage layouts disagree is refused', async t => {
  const root = await scratch(t);
  const other = { exports: [{ name: 'dbl', args: [{ kind: 'record', name: 'state', label: 'S', fields: [{ name: 'other', kind: 'number', unit: 'kg', label: 'O', precision: 2 }] }], result: balance }], traps: [] };
  const library = await seed(join(root, 'l.jsonl'), [{ id: 'incer', bytes: inc, cap: stepCap('inc'), contract: 'Adds one to the balance.' }, { id: 'doubler', bytes: dbl, cap: other, contract: 'Doubles another shape.' }]);
  t.after(() => library.close());
  const tests = JSON.stringify([{ name: 'step', fn: 'step', args: [{ total: 3 }], expect: { total: 8 } }]);
  const plan = { exports: [{ name: 'step', stages: [{ entry: 'incer', fn: 'inc' }, { entry: 'doubler', fn: 'dbl' }] }] };
  assert.equal((await library.compose({ capability: stepCap('step'), files: frozen('Add one then double the balance.', tests) }, plan)).reason, 'plan_mismatch');
});
const count = { kind: 'integer', unit: '1', name: 'n', label: 'N' }, whole = { kind: 'integer', unit: '1' };
test('H7 a plan cannot hand the hidden output pointer to a scalar parameter', async t => {
  const root = await scratch(t);
  const cap = name => ({ exports: [{ name, args: [count], result: balance }], traps: [] });
  const library = await seed(join(root, 'l.jsonl'), [{ id: 'poker', bytes: poke, cap: cap('poke'), contract: 'Writes a balance.' }]);
  t.after(() => library.close());
  const tests = JSON.stringify([{ name: 'step', fn: 'step', args: [1], expect: { total: 0 } }]);
  const plan = { exports: [{ name: 'step', stages: [{ entry: 'poker', fn: 'poke', args: [{ input: 1 }] }] }] };
  assert.equal((await library.compose({ capability: cap('step'), files: frozen('Write a balance.', tests) }, plan)).reason, 'adapter_arity');
});
test('H7 a plan cannot pass a host buffer address as a scalar', async t => {
  const root = await scratch(t);
  const library = await seed(join(root, 'l.jsonl'), [
    { id: 'peeker', bytes: peek, cap: { exports: [{ name: 'peek', args: [count], result: whole }], traps: [] }, contract: 'Reads a word.' },
    { id: 'poker', bytes: poke, cap: { exports: [{ name: 'poke', args: [count], result: balance }], traps: [] }, contract: 'Writes a balance.' }]);
  t.after(() => library.close());
  const reading = { exports: [{ name: 'read', args: [{ ...balance, name: 'state' }], result: whole }], traps: [] };
  const readTests = JSON.stringify([{ name: 'read', fn: 'read', args: [{ total: 1 }], expect: 0 }]);
  const writeTests = JSON.stringify([{ name: 'write', fn: 'write', args: [{ total: 1 }], expect: { total: 0 } }]);
  const scalar = await library.compose({ capability: reading, files: frozen('Read a word.', readTests) }, { exports: [{ name: 'read', stages: [{ entry: 'peeker', fn: 'peek', args: [{ input: 0 }] }] }] });
  assert.equal(scalar.reason, 'plan_mismatch', JSON.stringify(scalar));
  const mixed = await library.compose({ capability: stepCap('write'), files: frozen('Write a balance.', writeTests) }, { exports: [{ name: 'write', stages: [{ entry: 'poker', fn: 'poke', args: [{ input: 0 }] }] }] });
  assert.equal(mixed.reason, 'plan_mismatch', JSON.stringify(mixed));
});
