import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Serves recorded claude -p replies inside P-51's unmodified harness. The harness passes no
// need text, so the case file it writes (P51_CASE) identifies the kernel by its frozen contract.
// A binding reply is served only when the request is byte-identical to the recorded one.
const sha = text => createHash('sha256').update(text).digest('hex');
let index = null;
export function createProvider(env) {
  index ??= new Map(readFileSync(env.P56_RECORDED, 'utf8').split('\n').filter(Boolean).map(line => { const r = JSON.parse(line); return [r.contract, r]; }));
  return {
    name: 'p56-replay', testDouble: true,
    async send({ session, messages }) {
      const record = index.get(sha(JSON.parse(readFileSync(env.P51_CASE, 'utf8')).contract));
      if (!record) throw Error('no recorded synthesis for this contract');
      const [step, k] = session.split('-'), member = record.members[Number(k)], reply = member?.[step === 'need' ? 'need' : 'binding'];
      if (!reply || reply.error) throw Error(`recorded ${step} failed`);
      if (step === 'binding' && sha(messages[0].content) !== reply.request) throw Error('binding request differs from the recorded one');
      return { text: reply.text, usage: reply.usage ?? 0 };
    },
  };
}
