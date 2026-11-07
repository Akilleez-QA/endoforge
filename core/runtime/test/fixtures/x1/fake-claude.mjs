#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const mode = process.env.FAKE_CLAUDE_MODE ?? '', log = process.env.FAKE_CLAUDE_LOG, turnMs = Number(process.env.FAKE_CLAUDE_MS ?? 0), limitS = Number(process.env.FAKE_CLAUDE_LIMIT_S ?? 3600);
const record = value => { if (log) appendFileSync(log, `${JSON.stringify(value)}\n`); };
record({ start: process.pid, argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env) });
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const init = () => { if (mode !== 'noinit') emit({ type: 'system', subtype: 'init', tools: mode === 'tools' ? ['Bash'] : ['StructuredOutput'], apiKeySource: mode === 'apikey' ? 'ANTHROPIC_API_KEY' : 'none', mcp_servers: [] }); };
const answer = (seen, text) => ({ type: 'result', is_error: false, structured_output: { calls: [{ name: 'done' }], seen, to: text.slice(0, 40) }, usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: Number(process.env.FAKE_CLAUDE_CACHE_READ ?? 0) }, duration_api_ms: 5 });
if (process.argv.includes('--input-format')) {
  let history = [], chain = Promise.resolve();
  createInterface({ input: process.stdin }).on('line', line => {
    const text = JSON.parse(line).message.content[0].text;
    chain = chain.then(async () => {
      init();
      if (text === '/clear') { history = []; record({ clear: true }); emit({ type: 'conversation_reset' }); return emit({ type: 'result', is_error: false, result: '', usage: {}, duration_api_ms: 0 }); }
      history.push(text);
      record({ text, history: history.length });
      if (mode === 'die') process.exit(9);
      if (mode === 'hang') return;
      if (mode === 'refuse') return emit({ type: 'result', is_error: true, result: 'nope', usage: {} });
      if (mode === 'limit') emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Date.now() / 1000 + limitS } });
      if (turnMs) await new Promise(resolve => setTimeout(resolve, turnMs));
      emit(answer(history.length, text));
    });
  });
} else {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    init();
    record({ text: input });
    emit(answer(1, input));
  });
}
