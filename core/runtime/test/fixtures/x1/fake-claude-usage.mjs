#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const log = process.env.FAKE_CLAUDE_LOG, rate = process.env.FAKE_CLAUDE_RATE ? JSON.parse(process.env.FAKE_CLAUDE_RATE) : null;
const record = value => { if (log) appendFileSync(log, `${JSON.stringify(value)}\n`); };
record({ start: process.pid, argv: process.argv.slice(2), env: Object.keys(process.env) });
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const init = () => emit({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], apiKeySource: 'none', mcp_servers: [] });
const turn = (seen, text) => {
  init();
  record({ text, history: seen });
  if (rate) emit({ type: 'rate_limit_event', rate_limit_info: rate, uuid: '00000000-0000-0000-0000-000000000000', session_id: '00000000-0000-0000-0000-000000000000' });
  emit({ type: 'result', is_error: false, structured_output: { calls: [{ name: 'done' }], seen }, usage: { input_tokens: 2, output_tokens: 3 }, duration_api_ms: 5 });
};
if (process.argv.includes('--input-format')) {
  let seen = 0;
  createInterface({ input: process.stdin }).on('line', line => {
    const text = JSON.parse(line).message.content[0].text;
    if (text === '/clear') { seen = 0; init(); return emit({ type: 'result', is_error: false, result: '', usage: {}, duration_api_ms: 0 }); }
    seen += 1;
    return turn(seen, text);
  });
} else {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => turn(1, input));
}
