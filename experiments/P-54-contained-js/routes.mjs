import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createContainedRoute } from '../../tools/tscheck/contained-route.mjs';
import { typecheck } from '../../tools/tscheck/checker.mjs';
import { projectFor } from '../../tools/tscheck/contained-route.mjs';

const [output, ascPath] = process.argv.slice(2);
mkdirSync(output, { recursive: true });
const asc = await import(pathToFileURL(resolve(ascPath, 'node_modules/assemblyscript/dist/asc.js')).href);
const kernels = new URL('../P-15-workcell-concurrency/kernels/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', kernels)));
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2); };
const extract = (source, signature) => {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  let depth = 0;
  for (let at = source.indexOf('{', start); at < source.length; at++) {
    if (source[at] === '{') depth += 1;
    if (source[at] === '}' && --depth === 0) return source.slice(start, at + 1);
  }
  return null;
};
const compileAsc = async source => {
  const files = {}, overlay = { 'kernel.ts': source };
  const started = performance.now();
  const result = await asc.main(['kernel.ts', '-O3', '--runtime', 'stub', '--noColors', '--initialMemory', '1', '--maximumMemory', '16', '--noAssert', '--outFile', 'out.wasm'],
    { stdout: asc.createMemoryStream(), stderr: asc.createMemoryStream(), readFile: name => overlay[name] ?? null, writeFile: (name, data) => { files[name] = data; }, listFiles: () => [] });
  return { error: result.error, bytes: files['out.wasm'], compileMs: performance.now() - started };
};
const argumentSets = [[1, 0, 1], [2.5, 1, 2], [100, 3, 4], [7, 4, 0], [3, 6, 5], [1, 0, 99], [0, 2, 2], [12345.5, 5, 6]];
const needs = [];
for (const { name } of manifest) {
  const source = readFileSync(new URL(`${name}.ts`, kernels), 'utf8');
  const helper = extract(source, 'function toBaseFactor'), convert = extract(source, 'export function convertUnit');
  needs.push({ name, full: source, scalar: helper && convert ? `${helper}\n${convert}\n` : null });
}
const whole = await Promise.all(needs.map(async need => { const report = await typecheck(projectFor(need.full), { emit: false }); return report.diagnostics.length; }));
const route = createContainedRoute({ deadlineMs: 2000 });
await route.ready();
const rows = [];
for (const need of needs.filter(item => item.scalar)) {
  const compiled = await compileAsc(need.scalar);
  if (compiled.error) { rows.push({ name: need.name, asc: 'compile failed' }); continue; }
  const moduleStart = performance.now();
  const module = new WebAssembly.Module(compiled.bytes);
  const moduleMs = performance.now() - moduleStart;
  const golden = [];
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('abort'); } } });
  for (const [index, args] of argumentSets.entries()) { const value = instance.exports.convertUnit(...args); if (Number.isFinite(value)) golden.push({ name: `c${index}`, fn: 'convertUnit', args, expect: value, tol: 1e-9 }); }
  const wasmRun = [];
  for (let rep = 0; rep < 20; rep++) {
    const started = performance.now();
    const fresh = new WebAssembly.Instance(module, { env: { abort() { throw new Error('abort'); } } });
    for (const test of golden) if (Math.abs(fresh.exports[test.fn](...test.args) - test.expect) > test.tol) throw new Error('wasm disagreed with itself');
    wasmRun.push(performance.now() - started);
  }
  const candidate = { files: { 'kernel.ts': need.scalar, 'tests.json': JSON.stringify(golden) } };
  const first = await route.check(candidate);
  const again = [];
  for (let rep = 0; rep < 4; rep++) again.push(await route.check(candidate));
  rows.push({ name: need.name, sourceHash: createHash('sha256').update(need.scalar).digest('hex').slice(0, 16), tests: golden.length,
    asc: { compileMs: +compiled.compileMs.toFixed(1), moduleMs: +moduleMs.toFixed(2), wasmBytes: compiled.bytes.length, runP50: percentile(wasmRun, 0.5) },
    js: { status: first.status, reason: first.reason, passed: first.passed, checkMs: percentile(again.map(item => item.checkMs), 0.5), runTwiceMs: percentile(again.map(item => item.runMs), 0.5), jsBytes: first.artifact ? null : null } });
  console.log(JSON.stringify(rows.at(-1)));
}
await route.close();
writeFileSync(join(output, `routes-${process.versions.node}.json`), JSON.stringify({ node: process.versions.node, wholeKernelDiagnostics: whole.map((count, index) => ({ name: needs[index].name, count })), scalarNeeds: rows, distinctScalar: new Set(rows.map(row => row.sourceHash)).size }, null, 1));
