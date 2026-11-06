#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const mode = process.env.FAKE_CLAUDE_MODE ?? '', log = process.env.FAKE_CLAUDE_LOG;
const record = value => { if (log) appendFileSync(log, `${JSON.stringify(value)}\n`); };
record({ start: process.pid, argv: process.argv.slice(2), cwd: process.cwd(), env: Object.keys(process.env) });
if (process.argv.includes('--output-format') && process.argv[process.argv.indexOf('--output-format') + 1] === 'json') {
  let input = '';
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    record({ text: input });
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, structured_output: { calls: [] }, usage: { input_tokens: 1, output_tokens: 1 }, duration_api_ms: 1 }));
  });
} else {
  const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  const init = () => emit({ type: 'system', subtype: 'init', tools: mode === 'tools' ? ['Bash'] : ['StructuredOutput'], apiKeySource: mode === 'apikey' ? 'ANTHROPIC_API_KEY' : 'none', mcp_servers: [] });
  let history = [];
  createInterface({ input: process.stdin }).on('line', line => {
    const text = JSON.parse(line).message.content[0].text;
    init();
    if (text === '/clear') { history = []; record({ clear: true }); emit({ type: 'conversation_reset' }); return emit({ type: 'result', is_error: false, result: '', usage: {}, duration_api_ms: 0 }); }
    history.push(text);
    record({ text, history: history.length });
    if (mode === 'die') process.exit(9);
    if (mode === 'hang') return;
    if (mode === 'refuse') return emit({ type: 'result', is_error: true, result: 'nope', usage: {} });
    if (mode === 'limit') emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600 } });
    emit({ type: 'result', is_error: false, structured_output: { calls: [{ name: 'done' }], seen: history.length }, usage: { input_tokens: 2, output_tokens: 3 }, duration_api_ms: 5 });
  });
}
