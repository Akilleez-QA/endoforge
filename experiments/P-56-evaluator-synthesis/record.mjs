import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { parseReply } from '../../core/runtime/x1/agent.mjs';
import { createProvider, prompts } from '../../core/runtime/x1/synth/stage.mjs';
import { corpus, sha } from './corpus.mjs';
// Records two candidate-blind syntheses per corpus kernel through the real claude -p transport.
// The model sees the need, then its own need sheet and the frozen contract; never tests, kernel or glue.
const [root, output, width = '6'] = process.argv.slice(2);
const done = new Set(existsSync(output) ? readFileSync(output, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).key) : []);
const rows = corpus(root).filter(r => !done.has(r.key)), provider = await createProvider(process.env);
const sheetOf = text => parseReply(text)?.calls?.find(c => c?.name === 'edit_file' && c.path === 'sheet.json')?.content;
async function send(session, content) {
  for (let attempt = 0; ; attempt++) {
    try { const r = await provider.send({ session, messages: [{ role: 'user', content }] }); return { text: r.text, usage: r.usage, wallMs: r.wallMs, request: sha(content) }; }
    catch (error) { if (attempt) return { error: error.message, request: sha(content) }; }
  }
}
let cursor = 0;
await Promise.all(Array.from({ length: Number(width) }, async () => {
  while (cursor < rows.length) {
    const row = rows[cursor++], members = [];
    for (let k = 0; k < 2; k++) {
      const need = await send(`need-${k}`, JSON.stringify(prompts.need(row.need)));
      let sheet = null;
      try { sheet = JSON.parse(sheetOf(need.text)); } catch {}
      const binding = sheet ? await send(`binding-${k}`, JSON.stringify(prompts.binding(sheet, row.contract))) : { error: 'no need sheet' };
      members.push({ need, binding });
    }
    appendFileSync(output, `${JSON.stringify({ key: row.key, contract: sha(row.contract), members, at: new Date().toISOString() })}\n`);
    console.error(`${row.key} ${members.map(m => (m.binding.error ? 'x' : 'ok')).join(' ')}`);
  }
}));
