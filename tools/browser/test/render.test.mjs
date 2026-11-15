import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { IsolatePool } from '../../../core/runtime/isolate-pool.mjs';
import { FILES, verifyArtifact } from '../artifact.mjs';
import { KITESURF_COMMIT, KITESURF_CORE } from '../pin.mjs';
import { NETWORK_REFUSED, PROCESS_ONLY, browserCellFlags, createBrowserPool, refuseFetch, warm } from '../port.mjs';

const PINNED_PNG_SHA256 = '122359543130c077c128d838dcbefcfea084374685ae135d15b41f33e94525e9';
const html = readFileSync(new URL('fixtures/box.html', import.meta.url), 'utf8');
const artifact = verifyArtifact();
const needsEngine = artifact.status === 'ready' ? {} : { skip: `kitesurf artifact ${artifact.reason}` };
const job = (width = 240, height = 180) => ({ ledger: 'caller', reference: {}, candidates: ['page'], portOptions: { html, width, height } });

function pixel(png, x, y) {
  const width = png.readUInt32BE(16), depth = png[24], type = png[25];
  assert.equal(depth, 8);
  const channels = { 2: 3, 6: 4 }[type];
  assert.ok(channels, `unsupported PNG colour type ${type}`);
  const chunks = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) {
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + png.readUInt32BE(at)));
  }
  const data = inflateSync(Buffer.concat(chunks)), stride = width * channels;
  let previous = new Uint8Array(stride), row;
  for (let line = 0; line <= y; line++) {
    const filter = data[line * (stride + 1)], raw = data.subarray(line * (stride + 1) + 1, (line + 1) * (stride + 1));
    row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? row[i - channels] : 0, up = previous[i], corner = i >= channels ? previous[i - channels] : 0;
      const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
      const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      row[i] = raw[i] + [0, left, up, (left + up) >> 1, paeth][filter];
    }
    previous = row;
  }
  return [...row.subarray(x * channels, x * channels + 3)];
}

const render = async (pool, ...size) => {
  const result = await pool.run(job(...size));
  assert.equal(result.status, 'completed', result.reason);
  return result;
};

test('a missing or tampered kitesurf artifact reports skip, never ready, and warm refuses it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'ef-browser-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(verifyArtifact(`${dir}/`), { status: 'skip', reason: `missing ${FILES.wasm[0]}` });
  const wasm = artifact.status === 'ready' ? Buffer.from(artifact.bytes.wasm) : Buffer.from('\0asm\x01\0\0\0');
  wasm[wasm.length - 1] ^= 1;
  mkdirSync(join(dir, 'fonts'));
  writeFileSync(join(dir, FILES.wasm[0]), wasm);
  assert.deepEqual(verifyArtifact(`${dir}/`), { status: 'skip', reason: `digest mismatch for ${FILES.wasm[0]}` });
  await assert.rejects(warm({ dir: `${dir}/` }), /kitesurf artifact not usable \(digest mismatch/);
});

test('a process workcell renders the fixture at the requested size with the blue box', { ...needsEngine, timeout: 120000 }, async t => {
  const pool = createBrowserPool();
  t.after(() => pool.close());
  const result = await render(pool, 240, 180);
  const png = Buffer.from(result.report.png);
  assert.equal(result.isolation, 'process');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [240, 180]);
  assert.deepEqual(pixel(png, 60, 50), [0, 0, 255]);
  assert.deepEqual(pixel(png, 200, 150), [255, 255, 255]);
  assert.deepEqual(result.toolingWasmModules.map(entry => entry.sha256), [KITESURF_CORE.sha256]);
  assert.deepEqual(result.evidence.pin, { commit: KITESURF_COMMIT, wasm: KITESURF_CORE.sha256 });
  assert.equal(result.evidence.bytes, png.length);
  assert.deepEqual([result.evidence.width, result.evidence.height], [240, 180]);
});

test('two process cells and two runs each give one pinned PNG digest', { ...needsEngine, timeout: 120000 }, async t => {
  const pool = createBrowserPool({ size: 2 });
  t.after(() => pool.close());
  await pool.ready();
  const results = [...await Promise.all([render(pool), render(pool)]), ...await Promise.all([render(pool), render(pool)])];
  assert.equal(new Set(results.map(result => result.workcell)).size, 2);
  assert.deepEqual([...new Set(results.map(result => result.evidence.sha256))], [PINNED_PNG_SHA256]);
});

test('thread cells are refused with the process-isolation error', { timeout: 60000 }, async t => {
  assert.throws(() => createBrowserPool({ isolation: 'thread' }), new RegExp(PROCESS_ONLY));
  const pool = new IsolatePool({ hostPort: fileURLToPath(new URL('../port.mjs', import.meta.url)), size: 1, isolation: 'thread' });
  t.after(() => pool.close());
  const result = await pool.run(job());
  assert.equal(result.status, 'outcome_unknown');
  assert.equal(result.reason, PROCESS_ONLY);
});

test('the fetch bridge refuses every request without global fetch, and cells get no network grant', async t => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls += 1; return original('data:,'); };
  t.after(() => { globalThis.fetch = original; });
  assert.throws(() => refuseFetch(1, 'https://example.invalid/style.css', 'GET', ''), new RegExp(`^Error: ${NETWORK_REFUSED}: https://example.invalid/style.css$`));
  assert.equal(calls, 0);
  const flags = browserCellFlags();
  assert.ok(flags.some(flag => /^--(experimental-)?permission$/.test(flag)));
  assert.ok(!flags.some(flag => /allow-net|allow-child-process|allow-fs-write/.test(flag)));
});
