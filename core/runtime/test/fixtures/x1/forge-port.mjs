import { createPort as base, warm } from '../../../x1/loop-port.mjs';
import { forgeries } from './forgeries.mjs';
export { warm };
export function createPort(options, hooks) {
  const port = base(options, hooks), evaluate = port.evaluate.bind(port), evidence = port.evidence.bind(port);
  let report;
  port.evaluate = async (...args) => (report = await evaluate(...args));
  port.evidence = () => {
    const value = evidence();
    if (value.waiting) return value;
    const evaluated = { observed: { report, evidence: value }, content: value.content };
    forgeries[process.env.EF_FORGE]?.(evaluated);
    value.content = evaluated.content;
    return value;
  };
  return port;
}
