import { spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';
import { spawnArguments, usageOf } from '../../core/runtime/x1/transports.mjs';
import { hash } from '../../core/runtime/x1/host.mjs';

const passed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'USER', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME'];
const credential = /^ANTHROPIC_|API_KEY|AUTH_TOKEN|OAUTH_TOKEN|^CLAUDE_CODE_USE_|^AWS_|^GOOGLE_|^VERTEX_/i;
export const flatten = messages => messages.map(message => `${message.role}: ${message.content}`).join('\n\n');
export const requestKey = messages => hash(flatten(messages));

export function childEnvironment(base = process.env, fineGrained = false) {
  const env = Object.fromEntries(passed.filter(name => base[name] !== undefined).map(name => [name, base[name]]));
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  if (fineGrained) env.CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING = '1';
  if (Object.keys(env).some(name => credential.test(name))) throw Error('credential variable in child environment');
  return env;
}

export class RecordingTransport {
  name = 'claude-spawn-recorded'; testDouble = false; calls = 0; inits = [];
  constructor({ model, effort, file, command = 'claude', timeoutMs = 300000, label = null, fineGrained = true }) {
    Object.assign(this, { model, effort, file, command, timeoutMs, label, fineGrained });
    this.arguments = [...spawnArguments({ model, effort }), '--include-partial-messages'];
    this.directory = mkdtempSync(join(tmpdir(), 'p64-rec-'));
  }
  async start() { return { startupMs: 0, lanes: 0 }; }
  send({ session, messages, remaining, timeoutMs = this.timeoutMs }) {
    if (remaining !== undefined && remaining <= 0) return Promise.reject(Error('model token budget reached'));
    this.calls += 1;
    const begin = performance.now(), events = [], key = requestKey(messages);
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.arguments, { cwd: this.directory, env: childEnvironment(process.env, this.fineGrained), stdio: ['pipe', 'pipe', 'ignore'], timeout: Math.min(timeoutMs, this.timeoutMs) });
      let result = null, acceptable = false;
      createInterface({ input: child.stdout }).on('line', line => {
        const t = performance.now() - begin;
        let event;
        try { event = JSON.parse(line); } catch { return; }
        events.push({ t, event });
        if (event.type === 'system' && event.subtype === 'init') {
          acceptable = event.apiKeySource === 'none' && !event.mcp_servers?.length && !event.tools?.some(tool => tool !== 'StructuredOutput');
          this.inits.push({ model: event.model ?? null, apiKeySource: event.apiKeySource ?? null });
        }
        if (event.type === 'result') result = event;
      });
      child.on('error', reject);
      child.stdin.on('error', () => {});
      child.stdin.end(flatten(messages));
      child.on('close', code => {
        const wallMs = performance.now() - begin;
        appendFileSync(this.file, `${JSON.stringify({ label: this.label, fineGrained: this.fineGrained, session, key, model: this.model, effort: this.effort, wallMs, code, events })}\n`);
        if (!acceptable) return reject(Error('transport is not a text-only subscription session'));
        if (code || !result || result.is_error) return reject(Error('transport refused the turn'));
        const reply = { text: result.structured_output ? JSON.stringify(result.structured_output) : result.result, usage: usageOf(result), wallMs, apiMs: result.duration_api_ms ?? null, usageDetail: result.usage ?? null };
        if (remaining !== undefined && reply.usage > remaining) return reject(Error('model token budget exceeded'));
        resolve(reply);
      });
    });
  }
  endSession() {}
  async close() { rmSync(this.directory, { recursive: true, force: true }); }
}
