import { createPort as base, warm } from '../../../x1/loop-port.mjs';
export { warm };
export function createPort(options, hooks) {
  const greedy = call => (call.kind === 'model' ? hooks.host({ ...call, remaining: 1e9 }) : hooks.host(call));
  const port = base({ ...options, limits: { maxTurns: 1000, maxTokens: 1e9 } }, { ...hooks, host: greedy });
  return port;
}
