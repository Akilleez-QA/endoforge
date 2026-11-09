import { canonical, sha256 } from './key.mjs';
import { link, LinkError, signatureOf } from './link.mjs';
import { isBuffer, LayoutError, layoutOf, layoutTable, usesBuffers } from '../runtime/x1/measure.mjs';
const WASM = { number: 'f64', integer: 'i32', code: 'i32', boolean: 'i32' };
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
const stagesOf = item => item.stages ?? (item.entry ? [{ entry: item.entry, fn: item.fn, ...(item.args ? { args: item.args } : {}) }] : []);
export const partsOf = plan => [...new Set((plan?.exports ?? []).flatMap(item => stagesOf(item).map(stage => stage.entry)))];
const VALUE_KEYS = ['name', 'kind', 'unit', 'label', 'codes', 'range', 'fields', 'items', 'max', 'maxBytes'], RESULT_KEYS = ['kind', 'unit', 'precision', 'codes', 'labels', 'fields', 'items', 'max', 'maxBytes'];
const sizeOf = type => { try { return layoutOf(type).size; } catch (error) { if (error instanceof LayoutError) throw new LinkError('plan_mismatch', error.message); throw error; } };
const sameLayout = (a, b) => canonical(layoutTable(a)) === canonical(layoutTable(b));
const abiOf = entry => usesBuffers(entry) ? { args: entry.args.map(arg => (isBuffer(arg) ? sizeOf(arg) : null)), out: isBuffer(entry.result) ? sizeOf(entry.result) : null } : null;
const shapeRow = type => (isBuffer(type) ? layoutTable(type) : type.kind);
const sameShape = (a, b) => canonical([...a.args, a.result].map(shapeRow)) === canonical([...b.args, b.result].map(shapeRow));
const typeOf = kind => {
  if (['record', 'list', 'text'].includes(kind)) return 'i32';
  if (!WASM[kind]) throw new LinkError('plan_mismatch', `kind ${kind}`);
  return WASM[kind];
};
export function buildComposition({ plan, capability, parts }) {
  const planned = plan?.exports ?? [], ids = partsOf(plan);
  const names = planned.map(item => item.name).sort(), wanted = capability.exports.map(item => item.name).sort();
  if (canonical(names) !== canonical(wanted)) throw new LinkError('plan_mismatch', `plan exports ${names.join(', ')}, the need declares ${wanted.join(', ')}`);
  const declared = new Map(capability.exports.map(item => [item.name, item]));
  const buffers = ids.map(id => Buffer.from(parts.get(id).wasm, 'base64')), partIndex = new Map(ids.map((id, i) => [id, i]));
  const declaredBy = (id, fn) => parts.get(id).capability?.exports?.find(entry => entry.name === fn) ?? null;
  const refuseStage = detail => { throw new LinkError('plan_mismatch', detail); };
  const exports = [], wrappers = [];
  for (const item of planned) {
    const stages = stagesOf(item), shape = declared.get(item.name);
    if (!stages.length) throw new LinkError('plan_mismatch', `${item.name} has no stages`);
    if (stages.length === 1 && !stages[0].args && !item.output) {
      const own = declaredBy(stages[0].entry, stages[0].fn), buffered = own && abiOf(own);
      if ((buffered || usesBuffers(shape)) && (!own || !sameShape(own, shape))) refuseStage(`${item.name} does not match the layout of ${stages[0].fn}`);
      exports.push({ name: item.name, part: partIndex.get(stages[0].entry), fn: stages[0].fn, ...(buffered ? { buffers: buffered } : {}) });
      continue;
    }
    const inputs = shape.args.map(arg => typeOf(arg.kind)), bufferOut = isBuffer(shape.result);
    const params = bufferOut ? [...inputs, 'i32'] : inputs;
    let flowing = null;
    const staged = stages.map((stage, index) => {
      const part = partIndex.get(stage.entry), own = declaredBy(stage.entry, stage.fn), abi = own ? abiOf(own) : null;
      const fallback = index === 0 ? inputs.map((_, input) => ({ input })) : [{ previous: true }], args = stage.args ?? fallback;
      if (!abi) signatureOf(buffers[part], stage.fn);
      else {
        if (args.length !== own.args.length) throw new LinkError('adapter_arity', `${stage.fn} takes ${own.args.length} arguments, the plan gives ${args.length}`);
        args.forEach((arg, position) => {
          if (!isBuffer(own.args[position])) return;
          if (arg.const !== undefined || arg.scale !== undefined || arg.offset !== undefined || arg.narrow !== undefined) refuseStage(`${stage.fn} cannot adapt a buffer`);
          const source = arg.previous === true ? flowing : shape.args[arg.input];
          if (!source || !isBuffer(source) || !sameLayout(source, own.args[position])) refuseStage(`${stage.fn} argument ${position} does not match the layout given to it`);
        });
      }
      flowing = own?.result ?? null;
      return { part, fn: stage.fn, args, ...(abi ? { buffers: abi } : {}) };
    });
    if (bufferOut && (!flowing || !isBuffer(flowing) || !sameLayout(flowing, shape.result))) refuseStage(`${item.name} does not produce its declared layout`);
    wrappers.push({ name: item.name, params, ...(bufferOut ? { bufferResult: sizeOf(shape.result) } : { result: typeOf(shape.result.kind) }), ...(item.output ? { output: item.output } : {}), stages: staged });
  }
  const bytes = link(buffers, { exports, wrappers });
  const manifest = { plan, parts: ids.map(id => ({ id, sourceSha: parts.get(id).sourceSha, wasmSha: parts.get(id).wasmSha })) };
  const id = sha256(canonical(manifest)), glueId = `composed-${id.slice(0, 16)}`;
  const source = `export const composition = ${JSON.stringify(manifest)};\n`;
  const glue = JSON.stringify({ id: glueId, assumption: 'Inputs stay within the ranges declared by the composed entries.', question: 'Does this composition of promoted entries answer the need?',
    exports: capability.exports.map(item => ({ name: item.name, label: `Composed export ${item.name}`, args: item.args.map(arg => pick(arg, VALUE_KEYS)), result: pick(item.result, RESULT_KEYS) })),
    traps: (capability.traps ?? []).map(fn => ({ fn, when: 'an input is outside its declared range', message: 'the composed kernel refused this input' })) });
  const wasm = Buffer.from(bytes).toString('base64');
  return { id, glueId, wasm, wasmSha: sha256(bytes), source, sourceSha: sha256(source), glue, capability };
}
