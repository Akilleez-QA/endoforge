import { canonical, sha256 } from './key.mjs';
import { link, LinkError, signatureOf } from './link.mjs';
const WASM = { number: 'f64', integer: 'i32', code: 'i32', boolean: 'i32' };
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const stagesOf = item => item.stages ?? (item.entry ? [{ entry: item.entry, fn: item.fn, ...(item.args ? { args: item.args } : {}) }] : []);
export const partsOf = plan => [...new Set((plan?.exports ?? []).flatMap(item => stagesOf(item).map(stage => stage.entry)))];
const typeOf = kind => {
  if (!WASM[kind]) throw new LinkError('plan_mismatch', `kind ${kind}`);
  return WASM[kind];
};
export function buildComposition({ plan, capability, parts }) {
  const planned = plan?.exports ?? [], ids = partsOf(plan);
  const names = planned.map(item => item.name).sort(), wanted = capability.exports.map(item => item.name).sort();
  if (canonical(names) !== canonical(wanted)) throw new LinkError('plan_mismatch', `plan exports ${names.join(', ')}, the need declares ${wanted.join(', ')}`);
  const declared = new Map(capability.exports.map(item => [item.name, item]));
  const buffers = ids.map(id => Buffer.from(parts.get(id).wasm, 'base64')), partIndex = new Map(ids.map((id, i) => [id, i]));
  const exports = [], wrappers = [];
  for (const item of planned) {
    const stages = stagesOf(item), shape = declared.get(item.name);
    if (!stages.length) throw new LinkError('plan_mismatch', `${item.name} has no stages`);
    if (stages.length === 1 && !stages[0].args && !item.output) { exports.push({ name: item.name, part: partIndex.get(stages[0].entry), fn: stages[0].fn }); continue; }
    const params = shape.args.map(arg => typeOf(arg.kind));
    wrappers.push({ name: item.name, params, result: typeOf(shape.result.kind), ...(item.output ? { output: item.output } : {}),
      stages: stages.map((stage, index) => {
        const part = partIndex.get(stage.entry), fallback = index === 0 ? params.map((_, input) => ({ input })) : [{ previous: true }];
        signatureOf(buffers[part], stage.fn);
        return { part, fn: stage.fn, args: stage.args ?? fallback };
      }) });
  }
  const bytes = link(buffers, { exports, wrappers });
  const manifest = { plan, parts: ids.map(id => ({ id, sourceSha: parts.get(id).sourceSha, wasmSha: parts.get(id).wasmSha })) };
  const id = sha256(canonical(manifest)), glueId = `composed-${id.slice(0, 16)}`;
  const source = `export const composition = ${JSON.stringify(manifest)};\n`;
  const glue = JSON.stringify({ id: glueId, assumption: 'Inputs stay within the ranges declared by the composed entries.', question: 'Does this composition of promoted entries answer the need?',
    exports: capability.exports.map(item => ({ name: item.name, label: `Composed export ${item.name}`, args: item.args.map(arg => pick(arg, ['name', 'kind', 'unit', 'label', 'codes', 'range'])), result: pick(item.result, ['kind', 'unit', 'precision', 'codes', 'labels']) })),
    traps: (capability.traps ?? []).map(fn => ({ fn, when: 'an input is outside its declared range', message: 'the composed kernel refused this input' })) });
  const wasm = Buffer.from(bytes).toString('base64');
  return { id, glueId, wasm, wasmSha: sha256(bytes), source, sourceSha: sha256(source), glue, capability };
}
