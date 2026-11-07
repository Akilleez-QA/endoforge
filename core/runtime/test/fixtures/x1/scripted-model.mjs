import { hash } from '../../../x1/host.mjs';
export const specification = input => ({ calls: [{ name: 'edit_file', path: 'CONTRACT.md', content: input.contract }, { name: 'edit_file', path: 'tests.json', content: input.tests }, { name: 'done' }] });
export const implementation = (input, id) => {
  const glue = JSON.parse(input.glue); glue.id = id;
  return { calls: [{ name: 'edit_file', path: 'kernel.ts', content: input.kernel }, { name: 'edit_file', path: 'glue.json', content: JSON.stringify(glue) }, { name: 'done' }] };
};
export const stageOf = messages => {
  const stages = messages.filter(message => message.role === 'user').map(message => { try { return JSON.parse(message.content).stage; } catch { return undefined; } }).filter(Boolean);
  return stages.at(-1);
};
export const idOf = messages => JSON.parse(messages[0].content).id;
export const reply = (value, usage = 10) => ({ text: typeof value === 'string' ? value : JSON.stringify(value), usage });
export const inputFor = (contract, tests, kernel, glue) => ({ contract, tests, kernel, glue, digest: hash(kernel) });
export function modelFor(input) {
  return ({ messages }) => {
    const stage = stageOf(messages);
    return reply(stage === 'specification' ? specification(input) : implementation(input, idOf(messages)));
  };
}
