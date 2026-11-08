import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hash } from '../../core/runtime/x1/host.mjs';
import { classify } from './classify.mjs';
import { race, evaluateNeed, passAtK, failureIcc, decide } from './strategies.mjs';
import { pick } from './router.mjs';

const [smokeDir] = process.argv.slice(2);

const reply = (begin, end, cumulative) => ({ beginMs: begin, endMs: end, costUsd: cumulative, usage: 100 });
const sample = (arm, n, promoted, wall, replies, rounds = []) => ({ arm, sample: n, promoted, wall, accepted: promoted, escaped: false, rounds, replies: replies.map((r, i) => ({ begin: r.beginMs, end: r.endMs, cost: r.costUsd - (replies[i - 1]?.costUsd ?? 0), tokens: 100 })) });
const a = sample('sonnet-low', 0, true, 10000, [reply(0, 6000, 0.03), reply(6000, 10000, 0.05)]);
const b = sample('sonnet-low', 1, true, 20000, [reply(0, 8000, 0.04), reply(8000, 14000, 0.06), reply(14000, 20000, 0.07)], [{ failed: true, at: 14000 }]);
const won = race([a, b]);
assert.equal(won.pass, 1); assert.equal(won.time, 10);
assert.ok(Math.abs(won.cost - (0.05 + 0.06)) < 1e-12, 'in-flight reply at the cut counts in full');
assert.ok(Math.abs(won.costLower - (0.05 + 0.04)) < 1e-12, 'lower bound counts only finished replies');
assert.equal(won.calls, 4); assert.equal(won.failed, 0);
const lost = race([{ ...a, promoted: false, accepted: false }, b]);
assert.equal(lost.time, 20); assert.equal(lost.failed, 1);
const none = race([{ ...a, promoted: false }, { ...b, promoted: false }]);
assert.equal(none.pass, 0); assert.ok(Math.abs(none.cost - 0.12) < 1e-12);
const low = Array.from({ length: 8 }, (_, i) => sample('sonnet-low', i, i < 2, 1000 * (i + 1), [reply(0, 1000 * (i + 1), 0.01)]));
const e = evaluateNeed(low);
assert.ok(Math.abs(e.bo1.pass - 2 / 8) < 1e-12);
assert.ok(Math.abs(e.bo2.pass - (1 - 15 / 28)) < 1e-12);
assert.equal(e.bo8.pass, 1);
const curve = passAtK([8, 0], 8);
assert.equal(curve[0].observed, 0.5); assert.equal(curve[7].observed, 0.5); assert.ok(curve[7].independent > 0.99);
assert.equal(failureIcc([8, 0, 8, 0], 8), 1);
assert.ok(Math.abs(failureIcc([4, 4, 4, 4], 8)) < 0.2);
assert.equal(decide([{ strategy: 'x', passRate: 1, costPerPromoted: 1, timeP50: 30 }, { strategy: 'y', passRate: 0.96, costPerPromoted: 0.95, timeP50: 10 }, { strategy: 'z', passRate: 0.9, costPerPromoted: 0.1, timeP50: 5 }]).winner, 'y');
assert.equal(decide([{ strategy: 'x', passRate: 1, costPerPromoted: 1, timeP50: 30 }, { strategy: 'y', passRate: 1, costPerPromoted: 1.05, timeP50: 10 }]).winner, 'y');
const state = s => ({ a: s[0], b: s[1], costSum: s[2], costN: 1 });
assert.equal(pick({ bo1: state([9, 1, 1]), bo2: state([10, 0, 2]), bo4: state([10, 0, 4]), bo8: state([10, 0, 8]), 'opus-high': state([10, 0, 3]), 'sonnet-medium': state([9.9, 0.1, 1.2]) }).choice, 'sonnet-medium');

if (smokeDir) {
  const dir = mkdtempSync(join(tmpdir(), 'p66-classify-'));
  const contents = readdirSync(join(smokeDir, 'smoke')).filter(name => name.startsWith('H01--') && name.endsWith('.content.json'));
  assert.ok(contents.length >= 3, 'smoke contents needed');
  const rows = [];
  contents.forEach((name, index) => {
    const [, arm, rest] = name.split('--');
    const sampleNo = Number(rest.split('.')[0]);
    let content = readFileSync(join(smokeDir, 'smoke', name), 'utf8');
    const promoted = index !== 0;
    if (!promoted) {
      const candidate = JSON.parse(content);
      const tests = JSON.parse(candidate.files['tests.json']).map(test => test.name === 'one' ? { ...test, expect: 1.3412 } : test);
      candidate.files['tests.json'] = JSON.stringify(tests);
      candidate.files['frozen.sha256'] = JSON.stringify({ contract: hash(candidate.files['CONTRACT.md']), tests: hash(candidate.files['tests.json']) });
      content = JSON.stringify(candidate);
    }
    for (const need of ['H01', 'CC-999']) {
      writeFileSync(join(dir, `${need}--${arm}--${sampleNo}.content.json`), content);
      rows.push({ need, arm, sample: sampleNo, promoted, agent: { exit_reason: promoted ? 'stop' : 'max_turns' } });
    }
  });
  const classes = classify(rows, dir);
  assert.equal(classes.length, 2);
  for (const c of classes) assert.equal(c.class, 'frozen-wrong', `${c.need}: ${JSON.stringify(c.evidence)}`);
  const lone = classify(rows.filter(row => row.need === 'CC-999').slice(0, 2), dir);
  assert.equal(lone[0].class, 'other', 'one sibling is not enough to call a frozen test wrong');
  console.log('classifier: H reference and R sibling checks flag the seeded wrong expectation; one sibling does not');
}
console.log('selftest passed');
