import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseReply } from '../../core/runtime/x1/agent.mjs';
import { combine, compileMember, judge } from '../../core/runtime/x1/synth/stage.mjs';
import { corpus } from './corpus.mjs';
// Stage non-model time per candidate (compile + qualify + judge), qualification and M3 counts per member.
const [root, prep, recorded, output] = process.argv.slice(2);
const kernels = corpus(root), baselines = JSON.parse(readFileSync(join(prep, 'baselines.json'), 'utf8'));
const records = Object.fromEntries(readFileSync(recorded, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.key, r]; }));
const content = text => parseReply(text)?.calls?.find(c => c?.name === 'edit_file' && c.path === 'binding.json')?.content;
const rows = [];
for (const k of kernels) {
  const tests = JSON.parse(k.tests), members = [];
  for (const m of records[k.key].members) { let b = null; try { b = JSON.parse(content(m.binding.text)); } catch {} members.push(b); }
  const load = loadavg()[0], t0 = performance.now();
  const member = members[0] ? await compileMember(members[0], tests) : null;
  const t1 = performance.now();
  const verdict = member ? judge({ confirmation: { approved: true }, checks: await combine([member]) }, { compiled: { wasm: baselines[k.key] }, files: { 'glue.json': k.glue } }) : null;
  const t2 = performance.now();
  const second = members[1] ? await compileMember(members[1], tests) : null;
  const m3 = [member, second].map(x => (x ? Object.values(x.exports).flatMap(e => e.failures.filter(f => f.startsWith('M3'))) : null));
  rows.push({ key: k.key, load, compileMs: t1 - t0, judgeMs: t2 - t1, decision: verdict?.decision ?? 'no binding',
    exports: [member, second].map(x => (x ? Object.values(x.exports).map(e => (e.qualified ? 'q' : e.failures.map(f => f.slice(0, 2)).join('+'))) : null)), m3 });
}
writeFileSync(output, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.ceil(s.length * p) - 1]; };
const ms = rows.filter(r => r.decision !== 'no binding').map(r => r.compileMs + r.judgeMs), exps = rows.flatMap(r => r.exports[0] ?? []);
console.log(JSON.stringify({ kernels: rows.length, stageP50Ms: q(ms, 0.5), stageP95Ms: q(ms, 0.95), judgeP50Ms: q(rows.map(r => r.judgeMs), 0.5), loadMin: Math.min(...rows.map(r => r.load)), loadMax: Math.max(...rows.map(r => r.load)),
  member0Exports: exps.length, member0Qualified: exps.filter(e => e === 'q').length, failureKinds: exps.filter(e => e !== 'q').reduce((a, e) => ({ ...a, [e]: (a[e] ?? 0) + 1 }), {}),
  m3BothMembers: rows.filter(r => r.m3[0]?.length && r.m3[1]?.length).map(r => [r.key, r.m3[0][0], r.m3[1][0]]) }, null, 1));
