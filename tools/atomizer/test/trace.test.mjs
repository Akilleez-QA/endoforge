import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openTrace, readTrace, analyzeTrace, p } from '../lib/trace.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../..'), tmp = fs.mkdtempSync(path.join(here, 'trace-'));
let failures = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { failures++; console.log(`FAIL ${name}: ${e.stack}`); } };
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
try {
  test('diamond analysis and nearest-rank percentiles', () => {
    const atoms = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, inputs: [[], ['a'], ['a'], ['b', 'c']][i].map((from) => ({ from })) }));
    const lines = [], span = (name, start, end, attrs = {}) => lines.push({ v: 1, runId: 'test', type: 'span', name, start, end, dur: end - start, ...attrs });
    for (const [atom, start, end, queueStart] of [['a', 10, 20, 10], ['b', 25, 45, 22], ['c', 50, 80, 22], ['d', 85, 95, 82]]) {
      span('queue', queueStart, start, { atom }); span('atom', start, end, { atom, attempts: atom === 'c' ? 2 : 1, ok: true, backend: 'codex' });
      span('worker', start, end, { atom, backend: 'codex', tier: 'standard', failovers: atom === 'c' ? 1 : 0, modelFallback: atom === 'c' }); span('codex.exec', start + 1, end - 1, { atom });
    }
    span('run', 0, 100, { concurrency: 1, procStartEpoch: -5 }); span('verify', 100, 110, { ok: true });
    lines.unshift({ type: 'span', name: 'atom', runId: 'old', atom: 'bad', start: 0, end: 999, dur: 999 });
    const m = analyzeTrace(lines, atoms, { concurrency: 99 });
    assert.equal(m.criticalPathMs, 50); assert.deepEqual(m.criticalPath, ['a', 'c', 'd']); assert.deepEqual(m.realizedChain.map((x) => x.id), ['a', 'c', 'd']);
    assert(Math.abs(m.chain.leadMs + m.chain.gapMs + m.chain.queueMs + m.chain.durMs + m.chain.tailMs - m.wallMs) < 1);
    assert.deepEqual(m.concurrency.msAt, { 0: 30, 1: 70 }); assert.equal(m.parallelEfficiency, 0.7); assert.equal(m.concurrency.max, 1);
    assert.deepEqual(m.byTier.standard, { n: 4, totalMs: 70, medianMs: 10 }); assert.equal(m.errors.retries, 1); assert.equal(m.errors.failovers, 1); assert.equal(m.errors.modelFallbacks, 1); assert.equal(m.errors.verifyOk, true); assert.equal(m.processStartMs, 5);
    assert.equal(p([1,2,3,4,5,6,7,8,9,10], 0.9), 9); assert.equal(p([1,2,3,4,5,6,7,8,9,10], 0.5), 5); assert.equal(p([], 0.5), null);
  });
  test('overlap sweep, queued root identity and last-run isolation', () => {
    const span = (name, start, end, attrs = {}, runId = 'last') => ({ type: 'span', name, start, end, dur: end - start, runId, ...attrs });
    const lines = [span('run', 0, 999, {}, 'old'), span('atom', 0, 999, { atom: 'old' }, 'old'), span('queue', 5, 10, { atom: 'a' }), span('atom', 10, 30, { atom: 'a', attempts: 1, ok: true }), span('atom', 20, 40, { atom: 'b', attempts: 1, ok: true }), span('atom', 30, 40, { atom: 'c', attempts: 1, ok: false }), span('run', 0, 50, { concurrency: 2 }), { type: 'mark', name: 'trace.self', runId: 'last', selfMs: 2 }, { type: 'mark', name: 'trace.self', runId: 'last', selfMs: 3 }];
    const m = analyzeTrace(lines, ['a', 'b', 'c'].map((id) => ({ id })), {});
    assert.equal(m.atoms.length, 3); assert.equal(m.concurrency.max, 2); assert.equal(m.concurrency.avg, 1); assert.equal(m.parallelEfficiency, 0.5); assert.deepEqual(m.concurrency.msAt, { 0: 20, 1: 10, 2: 20 }); assert.equal(m.traceSelfMs, 5); assert.equal(m.errors.atomsFailed, 1); assert.equal(m.errors.verifyOk, null);
    const root = analyzeTrace(lines.filter((x) => !['b', 'c'].includes(x.atom)), [{ id: 'a' }], {});
    assert.equal(root.chain.leadMs, 10); assert.equal(root.chain.leadMs + root.chain.gapMs + root.chain.queueMs + root.chain.durMs + root.chain.tailMs, root.wallMs);
    assert.deepEqual(analyzeTrace([], [], {}), {});
  });
  test('disabled trace creates no file; enabled appends and accounts for itself', () => {
    const old = process.env.ENDOFORGE_TRACE;
    try {
      process.env.ENDOFORGE_TRACE = '0'; const t = openTrace(tmp, { runId: 'off' }); t.span('run', 0, 1); t.mark('test'); t.close(); assert(!fs.existsSync(t.file));
      process.env.ENDOFORGE_TRACE = '1'; for (let i = 0; i < 2; i++) { const t = openTrace(tmp, { runId: 'on' }); t.span('test', 1.234, 2.345); t.close(); }
      const lines = readTrace(path.join(tmp, 'trace.jsonl')); assert.equal(lines.length, 4); assert.equal(lines[0].start, 1.2); assert.equal(lines[1].lines, 1); assert(lines[1].selfMs >= 0);
    } finally { if (old == null) delete process.env.ENDOFORGE_TRACE; else process.env.ENDOFORGE_TRACE = old; }
  });
  const probe = spawnSync('bwrap', ['--ro-bind', '/', '/', 'true']);
  if (probe.error || probe.status !== 0) console.log('SKIP trace integration: bwrap unusable (sandbox permissions)');
  else test('stub bench and alternating trace arms', () => {
    const replay = path.join(tmp, 'replay'), atoms = ['other', 'review'].map((kind, i) => ({ id: `a${i}`, kind, contract: 'Return the requested model evidence.', inputs: [], outputs: [{ name: 'result', path: 'result.txt' }], verify: { kind: 'manual' }, size: { work: 1, interface: 1 }, worker: { model: 'sonnet', tools: [], prompt: 'Return the result.' } }));
    for (const a of atoms) { const dir = path.join(replay, 'atoms', a.id, 'out'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'result.txt'), `replayed ${a.id}\n`); }
    atoms.push({ id: 'join', kind: 'compose', contract: 'Join both replayed evidence files into one completion marker.', inputs: atoms.map((a) => ({ from: a.id })), outputs: [{ name: 'done', path: 'done.txt' }], verify: { kind: 'manual' }, size: { work: 1, interface: 1 }, worker: { model: 'script', command: ['sh', '-c', 'echo done > /out/done.txt'] } });
    const input = path.join(tmp, 'atoms.json'); fs.writeFileSync(input, JSON.stringify({ schema: 'endoforge/atoms/1', need: { id: 'trace', text: 'Return evidence.' }, acceptance: [{ id: 'A1', statement: 'Outputs exist.', check: { kind: 'manual' } }], atoms }));
    const bench = (extra = []) => {
      const r = spawnSync(process.execPath, [path.join(here, '../bin/bench.mjs'), '--atoms', input, '--stub', '--replay', replay, '--n', '2', '--no-augment', '--no-verify', '--out-dir', tmp, ...extra], { cwd: repo, env: { ...process.env, ENDOFORGE_TRACE: '1' }, encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 0, JSON.stringify({ status: r.status, error: r.error?.message, stdout: r.stdout, stderr: r.stderr, tmp })); const file = r.stdout.split('\n')[0]; assert(fs.existsSync(file)); return read(file);
    };
    const b = bench(); assert.equal(b.reps.length, 2); assert.equal(b.summary.okReps, 2); assert(b.summary.wallMs.median > 0);
    for (const r of b.reps) {
      const lines = readTrace(path.join(r.dir, 'trace.jsonl')); for (const name of ['run', 'atom', 'queue', 'setup', 'worker', 'pool.acquire', 'codex.exec', 'post']) assert(lines.some((x) => x.type === 'span' && x.name === name), name);
      assert.equal(lines.filter((x) => x.name === 'codex.exec').length, 2);
      for (const id of ['a0', 'a1']) assert.equal(fs.readFileSync(path.join(r.dir, 'atoms', id, 'out/result.txt'), 'utf8'), `replayed ${id}\n`);
    }
    const ab = bench(['--trace-ab']); assert.equal(ab.summary.okReps, 2); assert(fs.existsSync(path.join(ab.reps[0].dir, 'trace.jsonl'))); assert(!fs.existsSync(path.join(ab.reps[1].dir, 'trace.jsonl'))); assert(ab.summary.traceAB.off.scheduleMs.median > 0);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
process.exitCode = failures ? 1 : 0;
