import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const A = await import(new URL('core/runtime/x1/contract.mjs', process.argv[3]).href);
const B = await import(new URL('core/runtime/x1/contract.mjs', process.argv[4]).href);
const { withCapability } = await import(new URL('core/runtime/test/fixtures/x1/candidate.mjs', process.argv[3]).href);
const cases = [];
for (const e of JSON.parse(readFileSync(process.argv[2], 'utf8'))) { const names = JSON.parse(e.glue).exports.map(x => x.name); cases.push([withCapability(e.contract, e.glue), names], [e.contract, names]); }
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' || n.startsWith('.') ? [] : walk(p)) : [p]; });
for (const p of walk(new URL(process.argv[3]).pathname)) if (/CONTRACT\.md$|contract.*\.md$/i.test(p)) { const t = readFileSync(p, 'utf8'); const names = [...new Set([...t.matchAll(/`(\w+)`|\b(\w+)\s*\(/g)].map(m => m[1] ?? m[2]))].slice(0, 30); cases.push([t, names]); }
const words = ['returns', 'result', 'finite', 'NaN', 'traps', 'non-finite', 'never', 'tests', 'outside', 'Infinity', 'propagates', 'must be finite', 'callers supply finite', 'output', 'rejects', '.', '\n', 'f(', '`g`', '# h', 'cases'];
let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
for (let i = 0; i < 20000; i++) { const t = Array.from({ length: 5 + rnd(40) }, () => words[rnd(words.length)]).join(rnd(3) ? ' ' : '. '); cases.push([t, ['f', 'g', 'h'].slice(0, 1 + rnd(3))]); }
let diff = 0;
for (const [t, n] of cases) if (JSON.stringify(A.nonFiniteExpectation(t, n)) !== JSON.stringify(B.nonFiniteExpectation(t, n))) diff++;
console.log('cases', cases.length, 'differ', diff);
