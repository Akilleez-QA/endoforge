import { readFileSync } from 'node:fs';
import { hash } from '../../core/runtime/x1/host.mjs';
import { needOrder, seededOrder } from '../P-66-best-of-n/order.mjs';

const here = path => new URL(path, import.meta.url);
export const armNames = Object.freeze(['main', 'fixed', 'oracle', 'overlap', 'compact']);
export const comparisonOf = Object.freeze({ fixed: 'main', oracle: 'fixed', overlap: 'fixed', compact: 'fixed' });
export const callCeiling = 1300;
export const loadLimit = 16;
export const resamples = 10000;
export const tokenBudgetErrors = Object.freeze(['model token budget exceeded', 'model token budget reached']);
export const budgetRefusal = 'call budget reached';

export function recordedHash(directory = here('./')) {
  return readFileSync(new URL('receipt/precommit.sha256', directory), 'utf8').trim().split('\n').at(-1).split(/\s/)[0];
}

export function verifiedPrecommit(directory = here('./')) {
  const actual = hash(readFileSync(new URL('PRECOMMIT.md', directory)));
  if (actual !== recordedHash(directory)) throw Error(`PRECOMMIT.md differs from its recorded hash (${actual} against ${recordedHash(directory)})`);
  return actual;
}

export const seedOf = precommit => parseInt(precommit.slice(0, 8), 16) >>> 0;

export function slotsOf(arms, perArm) {
  return arms.flatMap(arm => Array.from({ length: perArm }, (_, sample) => ({ arm, sample })));
}

export function startOrder(precommit, need, count) {
  return seededOrder(Array.from({ length: count }, (_, index) => index), `${precommit}:${need}:start`);
}

export function p66Needs(count = 27) {
  const environment = JSON.parse(readFileSync(here('../P-66-best-of-n/receipt/environment.json'), 'utf8'));
  const plan = JSON.parse(readFileSync(here('../P-66-best-of-n/plan.json'), 'utf8'));
  const recorded = environment.order.slice(0, count).map(entry => entry.need);
  const seeded = needOrder(environment.precommit, plan.stages.main.needs).slice(0, count).map(entry => entry.need);
  if (JSON.stringify(recorded) !== JSON.stringify(seeded)) throw Error('P-66 recorded order differs from its seeded order');
  const ran = new Set(readFileSync(here('../P-66-best-of-n/receipt/rows.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).need));
  if (ran.size !== count || recorded.some(need => !ran.has(need))) throw Error('P-66 did not run exactly these needs');
  return recorded;
}
