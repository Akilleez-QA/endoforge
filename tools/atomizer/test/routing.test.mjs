import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRouting, assertModelAllowed, classify, escalate, resolve, codexArgs } from '../lib/routing.mjs';
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const r = loadRouting(), eq = assert.deepEqual;
const pick = (atom) => classify(atom, r);
test('default config loads', () => eq(r.default, 'standard'));
test('declared kinds precede heuristics', () => {
  for (const [kind, tier] of [['interface', 'light'], ['review', 'deep'], ['kernel', 'standard']]) {
    eq(pick({ kind, prompt: 'refactor a typo' }), { tier, reason: `kind:${kind}` });
  }
});
test('keywords and default', () => {
  for (const [prompt, tier, reason] of [['refactor the module', 'deep', 'keyword:refactor'], ['fix a typo', 'light', 'keyword:typo'], ['implement the module', 'standard', 'default']]) {
    eq(pick({ kind: 'other', prompt }), { tier, reason });
  }
  eq(pick({ prompt: 'typo REFACTOR' }).tier, 'deep');
  eq(pick({ title: 'Audit', description: 'a typo' }).tier, 'deep');
  eq(pick({ description: 'fix a typo' }).tier, 'light');
});
test('file and prompt size thresholds are strict', () => {
  const consumes = Array(3).fill('in'), produces = Array(3).fill('out');
  eq(pick({ consumes, produces }).tier, 'standard');
  eq(pick({ consumes, produces: [...produces, 'extra'] }), { tier: 'deep', reason: 'files:7' });
  eq(pick({ prompt: 'x'.repeat(24000) }).tier, 'standard');
  eq(pick({ prompt: 'x'.repeat(24001) }), { tier: 'deep', reason: 'size:24001' });
});
test('override wins, worker override has priority', () => {
  eq(pick({ kind: 'review', tier: 'light' }), { tier: 'light', reason: 'override' });
  eq(pick({ tier: 'deep', worker: { tier: 'throwaway' } }), { tier: 'throwaway', reason: 'override' });
});
test('unknown override throws', () => {
  for (const tier of ['missing', '', 'toString']) assert.throws(() => pick({ worker: { tier } }), /unknown tier/);
});
test('automatic classification never picks throwaway', () => {
  for (const kind of [...Object.keys(r.kindTier), 'other', 'throwaway']) {
    for (const prompt of ['', 'throwaway luna', 'refactor', 'typo']) assert.notEqual(pick({ kind, prompt }).tier, 'throwaway');
  }
});
test('escalation caps and preserves throwaway', () => {
  eq([1, 2, 3, 4].map((n) => escalate('light', n, r)), ['light', 'standard', 'deep', 'deep']);
  eq(escalate('standard', 2, r), 'deep');
  eq(escalate('throwaway', 8, r), 'throwaway');
});
test('resolve tiers, retries, fallback and codex args', () => {
  for (const [tier, model, effort] of [['light', 'gpt-6.1-sol', 'low'], ['standard', 'gpt-6.1-sol', 'medium'], ['deep', 'gpt-6-astra', 'high']]) {
    eq(resolve({ tier }, 1, r), { tier, baseTier: tier, reason: 'override', model, effort, scratch: false });
  }
  const sel = resolve({ kind: 'interface' }, 3, r, { fallback: true });
  eq(sel, { tier: 'deep', baseTier: 'light', reason: 'kind:interface', model: 'gpt-6.1-sol', effort: 'high', scratch: false });
  eq(codexArgs(sel), ['-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort=high']);
  eq(resolve({ tier: 'light' }, 1, r, { fallback: true }).model, 'gpt-6.1-sol');
});
const dir = fs.mkdtempSync(fileURLToPath(new URL('./routing-', import.meta.url))), file = `${dir}/config.json`;
const rejects = (mutate, pattern) => {
  const config = structuredClone(r); mutate(config);
  fs.writeFileSync(file, JSON.stringify(config));
  assert.throws(() => loadRouting(file), pattern);
};
try {
  test('load guards luna models and fallbacks', () => {
    rejects((c) => { c.tiers.standard.model = 'GPT-6-Luna'; }, /luna.*standard/);
    rejects((c) => { c.tiers.deep.fallback.model = 'gpt-5.6-luna'; }, /luna.*deep/);
  });
  test('load validates models, efforts and tier references', () => {
    rejects((c) => { c.tiers.light.model = ' '; }, /model/);
    rejects((c) => { c.tiers.light.effort = 'extreme'; }, /effort/);
    for (const tier of ['missing', 'throwaway']) {
      rejects((c) => { c.default = tier; }, /tier/);
      rejects((c) => { c.escalation.push(tier); }, /tier/);
      rejects((c) => { c.kindTier.other = tier; }, /tier/);
    }
  });
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
test('selection guards luna after config mutation', () => {
  assert.throws(() => assertModelAllowed('gpt-5.6-luna', 'light'), /luna.*light/);
  const config = structuredClone(r); config.tiers.light.model = 'GPT-6-Luna';
  assert.throws(() => resolve({ tier: 'light' }, 1, config), /luna.*light/);
  config.tiers.deep.fallback.model = 'GPT-6-Luna';
  assert.throws(() => resolve({ tier: 'deep' }, 1, config, { fallback: true }), /luna.*deep/);
});
test('explicit throwaway resolves to scratch luna without escalation', () => {
  eq(resolve({ worker: { tier: 'throwaway' } }, 4, r), { tier: 'throwaway', baseTier: 'throwaway', reason: 'override', model: 'gpt-6-luna', effort: 'low', scratch: true });
});
console.log(fails ? `${fails} failure(s)` : 'all routing tests passed');
process.exitCode = fails ? 1 : 0;
