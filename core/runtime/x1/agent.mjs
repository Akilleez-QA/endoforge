import { readFileSync } from 'node:fs';
import { testProblems } from './gates.mjs';
import { capabilityProblems, capabilityRule, glueRules, glueTemplate, exactRule } from './generator.mjs';
import { analyzeSpecification, freezeSpecification, oracleProblems, referenceFile, referenceRule } from './oracle.mjs';

const glueSchema = JSON.parse(readFileSync(new URL('./glue.schema.json', import.meta.url)));
export const LIMIT = 65536;
export const MAX_REPLY = 4 * LIMIT;
export const MAX_CALLS = 16;
export const replySchema = Object.freeze({
  type: 'object', additionalProperties: false, required: ['calls'],
  properties: { calls: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name'],
    properties: { name: { enum: ['read_file', 'edit_file', 'check', 'done'] }, path: { type: 'string' }, content: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } } } } },
});
export const transportSystem = 'You turn prompts into structured replies. You have no tools and no files except the ones each prompt describes. Reply with one object: {"calls":[...]} and nothing else. Each call is {"name":"read_file","path":...}, {"name":"edit_file","path":...,"content":...}, {"name":"edit_file","path":...,"old":...,"new":...} replacing exactly one match, {"name":"check"} to compile and run the frozen checks, or {"name":"done"} when finished.';
export const stateRules = Object.freeze([
  'A kernel is application logic: state in, event in, state out, as data. An argument or result of kind record, list or text is structured state passed through a host-owned linear-memory buffer, and its glue entry declares the layout: a record has fields (each a named glue value), a list has items and max, a text has maxBytes. Scalar values inside them keep their kind, unit, codes, labels and precision rules.',
  'The layout is little-endian with natural alignment: integer, code and boolean are 4-byte i32 (boolean is 0 or 1), number is an 8-byte f64. A record lays out its fields in order, each at the next multiple of its alignment, and its size rounds up to its largest alignment (at least 4). A list is a u32 count followed by max item slots, the first at the item alignment and each slot the item size. A text is a u32 UTF-8 byte length followed by maxBytes bytes.',
  'The kernel takes one usize pointer for each structured argument, in order, and when the result is structured one more trailing usize pointer to a zeroed output buffer; it then returns void and writes the result there. Read inputs with load<T>() and write the result with store<T>(), memory.copy or memory.fill. Never write to an input buffer, never allocate, and trap with abort() on any state or event it cannot apply.',
  'In tests.json, structured arguments and expected results are JSON: an object with exactly the declared fields for a record, an array for a list, a string for a text and true or false for a boolean.',
]);
export const stagePrompts = {
  specification: ({ need, id, oracle = false }) => JSON.stringify({ stage: 'specification', need, id, glueRules, stateRules, instructions:
    `Write only CONTRACT.md and tests.json${oracle ? ` and ${referenceFile}` : ''}, CONTRACT.md under 40 lines. Do not write kernel.ts or glue.json yet. Define a pure bounded AssemblyScript kernel, explicit assumptions, exports and tests. tests.json is a nonempty array of {name,fn,args,expect,tol?} or {name,fn,args,expectError:true}. Include boundary and trap cases. For every number result, state in CONTRACT.md the decimal places to show. Every value test needs expect (a finite number, boolean or string, or for a kernel over structured state an object or array of these following stateRules); tol is at most 1% of every number it applies to; expectError tests must trap in the kernel. When the need keeps state, such as a list of items, make the kernel a reducer over records, lists and text: state and event in, next state out. ${capabilityRule} These files will be frozen before implementation. ${exactRule}${oracle ? ` ${referenceRule}` : ''} Send every file in one reply, then done.` }),
  implementation: ({ id, overlay }) => JSON.stringify({ stage: 'implementation', id, ...(overlay ? { frozen: { 'CONTRACT.md': overlay['CONTRACT.md'], 'tests.json': overlay['tests.json'] } } : {}), glueSchema, glueRules, glueTemplate, stateRules, instructions:
    'CONTRACT.md and tests.json are frozen; you can read them but not change them. Write kernel.ts and glue.json only. Use AssemblyScript 0.28.20, runtime stub, no imports except env.abort, explicit bounded memory. The compiler runs with --noAssert, which deletes assert() calls, so never use assert; make every expectError case trap with an explicit if (condition) abort() or throw. Implement all frozen tests and the closed glue schema; glue.id must equal id. Records, lists and text at the boundary follow stateRules exactly. glue.json must satisfy every rule in glueRules and declare the exports, kinds, units, ranges, precision and traps of the capability block in CONTRACT.md; glueTemplate shows the shape. Send every file in one reply, then done. A failed check comes back as your next prompt.' }),
};
export function parseReply(text) {
  if (typeof text !== 'string' || text.length > MAX_REPLY) return null;
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value?.calls) ? value : null;
  } catch { return null; }
}
export function applyCall(overlay, editable, call) {
  const { name, path, content, old, new: replacement } = call ?? {};
  if (name === 'read_file') {
    if (!Object.hasOwn(overlay, path)) return { error: 'no such file' };
    return { content: overlay[path] };
  }
  if (name !== 'edit_file') return { error: 'unknown call' };
  if (typeof path !== 'string' || !editable.includes(path)) return { error: 'path refused' };
  let next;
  if (typeof content === 'string' && old === undefined && replacement === undefined) next = content;
  else if (typeof old === 'string' && typeof replacement === 'string' && content === undefined) {
    const current = overlay[path] ?? '';
    if (!old || current.split(old).length !== 2) return { error: 'replacement must match exactly once' };
    next = current.replace(old, () => replacement);
  } else return { error: 'use content or old and new' };
  if (Buffer.byteLength(next) > LIMIT) return { error: 'file too large' };
  overlay[path] = next;
  return { written: Buffer.byteLength(next) };
}
export function applyReply(overlay, editable, text) {
  const parsed = parseReply(text);
  if (!parsed || parsed.calls.length > MAX_CALLS) return;
  for (const call of parsed.calls) if (call?.name === 'edit_file') applyCall(overlay, editable, call);
}
export const specificationFiles = ({ oracle = false } = {}) => oracle ? ['CONTRACT.md', 'tests.json', referenceFile] : ['CONTRACT.md', 'tests.json'];
export function frozenSpecification(overlay) {
  const frozen = freezeSpecification(overlay);
  if (!frozen) return null;
  overlay['tests.json'] = frozen.text;
  return { changes: frozen.changes, report: frozen.report };
}
export function specificationProblems(overlay, { oracle = false } = {}) {
  const problems = [];
  if (!overlay['CONTRACT.md']?.trim()) problems.push('CONTRACT.md is empty');
  let tests = null;
  try { tests = JSON.parse(overlay['tests.json'] ?? ''); } catch { problems.push('tests.json is not JSON'); }
  if (tests !== null) problems.push(...testProblems(tests));
  if (tests !== null) problems.push(...capabilityProblems(overlay['CONTRACT.md'], tests));
  if (oracle && !problems.length) problems.push(...oracleProblems(analyzeSpecification(overlay)));
  return problems.length ? { problems } : null;
}
export async function agentStage({ ask, messages, overlay, editable, prompt, check, receipt, limits }) {
  messages.push({ role: 'user', content: prompt });
  for (let turn = 0; turn < limits.maxTurns; turn++) {
    const exit = await takeReply({ messages, overlay, editable, check, receipt, limits }, await ask(messages, limits.maxTokens - receipt.tokens));
    if (exit) return exit;
  }
  return 'max_turns';
}
export async function takeReply({ messages, overlay, editable, check, receipt, limits: { maxTokens } }, reply) {
  receipt.turns += 1;
  if (!Number.isSafeInteger(reply?.usage) || reply.usage < 0) throw Error('invalid usage');
  receipt.tokens += reply.usage;
  if (receipt.tokens >= maxTokens) return 'max_tokens';
  messages.push({ role: 'assistant', content: reply.text });
  const parsed = parseReply(reply.text);
  if (!parsed) { messages.push({ role: 'user', content: JSON.stringify({ error: 'reply must be one JSON object with a calls array' }) }); return null; }
  if (parsed.calls.length > MAX_CALLS) { messages.push({ role: 'user', content: JSON.stringify({ error: 'too many calls' }) }); return null; }
  const results = [];
  let finished = parsed.calls.length === 0, failures = null, checked = false;
  for (const call of parsed.calls) {
    receipt.tool_calls += 1;
    if (call?.name === 'done') { finished = true; continue; }
    if (call?.name === 'check') { failures = await check(); checked = true; results.push({ check: failures ?? 'passed' }); continue; }
    results.push({ path: call?.path, ...applyCall(overlay, editable, call) });
  }
  if (finished) {
    if (!checked) { failures = await check(); checked = true; }
    if (!failures) return 'stop';
    results.push({ check: failures });
  }
  messages.push({ role: 'user', content: JSON.stringify({ results, instructions: 'Fix what failed, then done.' }) });
  return null;
}
