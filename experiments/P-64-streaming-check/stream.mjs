export class CallScanner {
  text = ''; depth = 0; inString = false; escape = false; start = -1; calls = [];
  push(chunk) {
    const found = [];
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i], at = this.text.length + i;
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === '\\') this.escape = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') { this.inString = true; continue; }
      if (c === '{' || c === '[') {
        this.depth += 1;
        if (this.depth === 3 && c === '{') this.start = at;
      } else if (c === '}' || c === ']') {
        if (this.depth === 3 && c === '}' && this.start >= 0) {
          const text = this.text + chunk.slice(0, i + 1);
          let call = null;
          try { call = JSON.parse(text.slice(this.start)); } catch { }
          this.start = -1;
          if (call) { this.calls.push(call); found.push(call); }
        }
        this.depth -= 1;
      }
    }
    this.text += chunk;
    return found;
  }
}

export function timeline(record) {
  const scanner = new CallScanner(), calls = [];
  let firstEvent = null, firstOutput = null, lastToken = null, messageStop = null, assistant = null, result = null, toolStart = null, outputTokens = null, inputUsage = null;
  for (const { t, event } of record.events) {
    if (event.type === 'stream_event') {
      const inner = event.event;
      if (inner.type === 'message_start') { firstEvent ??= t; inputUsage = inner.message?.usage ?? null; }
      if (inner.type === 'content_block_start' && inner.content_block?.type === 'tool_use') toolStart ??= t;
      if (inner.type === 'content_block_delta') {
        firstOutput ??= t;
        lastToken = t;
        if (inner.delta?.type === 'input_json_delta') for (const call of scanner.push(inner.delta.partial_json ?? '')) calls.push({ t, call });
      }
      if (inner.type === 'message_delta') outputTokens = inner.usage?.output_tokens ?? outputTokens;
      if (inner.type === 'message_stop') messageStop ??= t;
    } else if (event.type === 'assistant' && event.message?.content?.some(part => part.type === 'tool_use')) assistant ??= t;
    else if (event.type === 'result') result = { t, event };
  }
  return { firstEvent, firstOutput, toolStart, lastToken, messageStop, assistant, result: result?.t ?? null, close: record.wallMs, calls, text: scanner.text, outputTokens, inputUsage,
    structured: result?.event?.structured_output ?? null, usage: result?.event?.usage ?? null, numTurns: result?.event?.num_turns ?? null };
}
