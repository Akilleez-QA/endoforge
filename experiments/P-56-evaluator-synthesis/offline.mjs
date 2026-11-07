import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseReply } from '../../core/runtime/x1/agent.mjs';
import { combine, compileMember, judge } from '../../core/runtime/x1/synth/stage.mjs';
import { corpus } from './corpus.mjs';
// The synthesized evaluator alone, without the pool: builds each kernel's frozen evaluator from the
// recorded replies exactly as the stage does, then judges the pristine kernel and every mutant row.
const [root, prep, recorded, width, output, surfaces = 'control,kernel,glue'] = process.argv.slice(2);
const kernels = Object.fromEntries(corpus(root).map(k => [k.key, k]));
const records = Object.fromEntries(readFileSync(recorded, 'utf8').split('\n').filter(Boolean).map(l => { const r = JSON.parse(l); return [r.key, r]; }));
const baselines = JSON.parse(readFileSync(join(prep, 'baselines.json'), 'utf8'));
const content = (text, path) => parseReply(text)?.calls?.find(c => c?.name === 'edit_file' && c.path === path)?.content;
const evaluators = new Map();
async function evaluatorFor(key) {
  if (evaluators.has(key)) return evaluators.get(key);
  const record = records[key], tests = JSON.parse(kernels[key].tests), members = [];
  for (const m of (record?.members ?? []).slice(0, Number(width))) {
    let binding = null;
    try { binding = JSON.parse(content(m.binding.text, 'binding.json')); } catch {}
    members.push(binding ? await compileMember(binding, tests) : { error: 'no binding', exports: {} });
  }
  const usable = members.length === Number(width) && members.every(m => !m.error);
  const evaluator = { confirmation: { approved: true }, checks: usable ? await combine(members) : { vectors: [], ranges: [], codes: [], monotone: [], glue: [] },
    members: members.map(m => Object.fromEntries(Object.entries(m.exports).map(([fn, e]) => [fn, { qualified: e.qualified, failures: e.failures, dropped: e.dropped }]))) };
  evaluators.set(key, evaluator);
  return evaluator;
}
const lines = [], wanted = surfaces.split(',');
const judgeRow = async (row, wasm, glue) => {
  const evaluator = await evaluatorFor(row.key), verdict = judge(evaluator, { compiled: { wasm }, files: { 'glue.json': glue } });
  lines.push(JSON.stringify({ mutant: row.mutant, key: row.key, cohort: row.cohort, surface: row.surface, class: row.class, op: row.op, decision: verdict.decision, failures: verdict.failures?.slice(0, 3) ?? [], reason: verdict.reason ?? null }));
};
if (wanted.includes('control')) for (const key of Object.keys(kernels)) if (records[key]) await judgeRow({ mutant: `${key}#control`, key, cohort: key.includes('/add-') ? 'add' : 'P21', surface: 'control', class: 'control', op: 'pristine' }, baselines[key], kernels[key].glue);
for await (const line of createInterface({ input: createReadStream(join(prep, 'mutants.jsonl')) })) {
  if (!line) continue;
  const row = JSON.parse(line);
  if (!wanted.includes(row.surface) || !records[row.key]) continue;
  await judgeRow(row, row.wasm ?? baselines[row.key], row.surface === 'glue' ? row.glue : kernels[row.key].glue);
}
writeFileSync(output, `${lines.join('\n')}\n`);
const control = lines.map(l => JSON.parse(l)).filter(r => r.surface === 'control');
console.log(JSON.stringify({ control: control.length, refused: control.filter(r => r.decision === 'refuse').map(r => [r.key, r.failures]), abstained: control.filter(r => r.decision === 'abstain').map(r => [r.key, r.reason]),
  evaluators: [...evaluators].map(([k, e]) => [k, Object.entries(e.members[0] ?? {}).map(([fn, x]) => `${fn}:${x.qualified ? 'q' : x.failures.join('|').slice(0, 160)}`).join(' ')]) }, null, 1));
