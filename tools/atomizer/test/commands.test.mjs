import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
import { resolveToolchainPath, toolchainFor, workerCommand } from '../lib/workers.mjs';
import { augment } from '../lib/augment.mjs';
import { makeHomeTemplate, runIsolated } from '../lib/isolate.mjs';
import { capabilityRule } from '../../../core/runtime/x1/generator.mjs';

const ATOMIZER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ATOMIZER, '../..');
const BIN = (name) => path.join(ATOMIZER, 'bin', name);
const FIX = (name) => path.join(ATOMIZER, 'test', 'fixtures', name);
const policy = JSON.parse(fs.readFileSync(path.join(ATOMIZER, 'policy.json'), 'utf8'));
let fails = 0;
const test = (name, fn) => { try { fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atomizer-commands-'));
const ledgerDir = path.join(tmp, 'ledger');
const claudeHost = path.join(tmp, 'claude-bin');
fs.mkdirSync(claudeHost, { recursive: true });
const env = () => {
  const e = { ...process.env, ATOMIZER_LEDGER_DIR: ledgerDir, ENDOFORGE_CLAUDE_ACCOUNTS: path.join(tmp, 'no-accounts'), ENDOFORGE_TOOLCHAIN_CLAUDE: claudeHost, ENDOFORGE_CODEX_POOL: path.join(tmp, 'no-codex-pool'), ENDOFORGE_THROTTLE: '0' };
  delete e.ENDOFORGE_CREDENTIAL_HOME; delete e.ENDOFORGE_WORKER;
  return e;
};
const run = (bin, args, opts = {}) => spawnSync(process.execPath, [BIN(bin), ...args], { encoding: 'utf8', env: env(), timeout: 120_000, ...opts });
const events = () => fs.existsSync(path.join(ledgerDir, 'events.jsonl'))
  ? fs.readFileSync(path.join(ledgerDir, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const pair = readJson(FIX('synthetic-pair.json'));
const withNeed = (doc, id) => ({ ...structuredClone(doc), need: { ...doc.need, id } });
const writeJson = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 1)); return p; };
const needFile = (id, body = 'Synthetic need for the atomizer command tests.') => { const p = path.join(tmp, 'needs', `${id}.md`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `# Request ${id}\n\n${body}\n`); return p; };

test('the pair fixture is a valid script-worker graph', () => {
  const v = validate(pair, policy);
  assert.ok(v.ok, v.errors.join('; '));
  assert.ok(pair.atoms.every((a) => a.worker.model === 'script'));
});

test('every command prints its usage and exits 2 without its required arguments', () => {
  for (const [bin, args, usage] of [
    ['atomize.mjs', [], /usage: atomize\.mjs/], ['atomize.mjs', [needFile('usage-a')], /usage: atomize\.mjs/],
    ['fanout.mjs', [], /usage: fanout\.mjs/], ['fanout.mjs', [FIX('synthetic-pair.json')], /usage: fanout\.mjs/],
    ['direct.mjs', [], /usage: direct\.mjs/], ['direct.mjs', [needFile('usage-d')], /usage: direct\.mjs/],
    ['report.mjs', [], /usage: report\.mjs/], ['report.mjs', [path.join(tmp, 'no-run')], /usage: report\.mjs/],
    ['cutover.mjs', [], /usage: cutover\.mjs/], ['cutover.mjs', [path.join(tmp, 'ladder.json')], /usage: cutover\.mjs/],
  ]) {
    const r = run(bin, args);
    assert.equal(r.status, 2, `${bin} ${args.length}: exit ${r.status} ${r.stderr.slice(-300)}`);
    assert.match(r.stderr, usage, `${bin}: ${r.stderr.slice(-300)}`);
    assert.doesNotMatch(r.stderr, /at file:|TypeError/, `${bin}: ${r.stderr.slice(-300)}`);
  }
});

test('atomize --fixture validates, plans and records a valid graph without a model', () => {
  const out = path.join(tmp, 'atomize-ok');
  const r = run('atomize.mjs', [needFile('synthetic-pair'), '--out', out, '--fixture', FIX('synthetic-pair.json')]);
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(summary.valid, true);
  assert.equal(summary.attempts.length, 1);
  assert.deepEqual({ atoms: summary.plan.atoms, total: summary.plan.total, critical: summary.plan.critical, width: summary.plan.width }, { atoms: 4, total: 4, critical: 3, width: 2 });
  assert.deepEqual(readJson(path.join(out, 'atoms.json')).atoms.map((a) => a.id), ['src', 'left', 'right', 'compose']);
  const p = readJson(path.join(out, 'plan.json'));
  assert.deepEqual(p.criticalPath.slice(0, 1).concat(p.criticalPath.slice(-1)), ['src', 'compose']);
  const receipt = readJson(path.join(out, 'receipt', 'atomize.json'));
  assert.equal(receipt.valid, true);
  assert.equal(receipt.needId, 'synthetic-pair');
  assert.match(receipt.promptSha256, /^[0-9a-f]{64}$/);
  const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  assert.match(report, /^# Atomization of synthetic-pair/);
  assert.match(report, /valid: true/);
  assert.match(report, /- A1: the composition holds both parts in order \[command\]/);
  assert.doesNotMatch(report, /Validation errors/);
  const ev = events().filter((e) => e.atomizeId === receipt.atomizeId);
  assert.deepEqual(ev.map((e) => e.event), ['atomize.start', 'atomize.attempt', 'atomize.end']);
  assert.equal(ev[0].fixture, FIX('synthetic-pair.json'));
  assert.equal(ev[2].valid, true);
  assert.equal(ev[2].plan.atoms, 4);
});

test('atomize --fixture refuses an invalid graph after the repair attempt and reports the errors', () => {
  const out = path.join(tmp, 'atomize-cycle');
  const r = run('atomize.mjs', [needFile('synthetic-cycle'), '--out', out, '--fixture', FIX('synthetic-cycle.json'), '--repair', '1']);
  assert.equal(r.status, 1, r.stderr);
  const receipt = readJson(path.join(out, 'receipt', 'atomize.json'));
  assert.equal(receipt.valid, false);
  assert.equal(receipt.attempts.length, 2);
  assert.ok(receipt.attempts.every((a) => a.errors.some((e) => /cycle/.test(e))), JSON.stringify(receipt.attempts));
  assert.match(fs.readFileSync(path.join(out, 'report.md'), 'utf8'), /## Validation errors\n\n- .*cycle/);
  const end = events().filter((e) => e.atomizeId === receipt.atomizeId && e.event === 'atomize.end');
  assert.equal(end.length, 1);
  assert.equal(end[0].valid, false);
  assert.equal(end[0].attempts, 2);
});

test('atomize --fixture reports output that is not JSON and writes no atoms.json', () => {
  const out = path.join(tmp, 'atomize-garbage');
  const garbage = path.join(tmp, 'garbage.txt'); fs.writeFileSync(garbage, 'not json at all');
  const r = run('atomize.mjs', [needFile('synthetic-garbage'), '--out', out, '--fixture', garbage, '--repair', '0']);
  assert.equal(r.status, 1, r.stderr);
  const receipt = readJson(path.join(out, 'receipt', 'atomize.json'));
  assert.equal(receipt.attempts.length, 1);
  assert.match(receipt.attempts[0].errors[0], /output is not JSON/);
  assert.ok(!fs.existsSync(path.join(out, 'atoms.json')));
  assert.ok(!fs.existsSync(path.join(out, 'plan.json')));
});

test('direct writes a valid one-atom direct graph named after the request', () => {
  const out = path.join(tmp, 'direct', 'nested', 'atoms.json');
  const r = run('direct.mjs', [needFile('synthetic-direct'), '--out', out, '--model', 'opus', '--effort', 'high']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), out);
  const doc = readJson(out);
  assert.equal(doc.arm, 'direct');
  assert.equal(doc.need.id, 'synthetic-direct');
  assert.match(doc.need.text, /^# Request synthetic-direct/);
  assert.equal(doc.atoms.length, 1);
  const [a] = doc.atoms;
  assert.deepEqual({ id: a.id, kind: a.kind, model: a.worker.model, effort: a.worker.effort }, { id: 'direct', kind: 'direct', model: 'opus', effort: 'high' });
  assert.ok(a.outputs.some((o) => o.path === 'gates.json'));
  assert.deepEqual(doc.acceptance.map((x) => x.id), ['A1']);
  const v = validate(doc, policy);
  assert.ok(v.ok, v.errors.join('; '));
  const plain = readJson(run('direct.mjs', [needFile('synthetic-direct'), '--out', path.join(tmp, 'direct', 'plain.json')]).stdout.trim());
  assert.equal(plain.atoms[0].worker.model, 'sonnet');
  assert.ok(!('effort' in plain.atoms[0].worker));
});

let fan = null;
const fanDir = path.join(tmp, 'fanout');
test('fanout runs several script graphs as one pool, verifies and reports each', () => {
  const a = writeJson(path.join(tmp, 'fan', 'pair-a.json'), withNeed(pair, 'synthetic-pair-a'));
  const b = writeJson(path.join(tmp, 'fan', 'pair-b.json'), withNeed(pair, 'synthetic-pair-b'));
  const r = run('fanout.mjs', [a, b, '--out-dir', fanDir, '--parallel-runs', '2', '--per-run-concurrency', '2', '--pool-id', 'pool-synthetic']);
  assert.equal(r.status, 0, r.stderr);
  const printed = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(printed.requests, 2);
  assert.equal(printed.verified, 2);
  fan = readJson(path.join(fanDir, 'fanout.json'));
  assert.equal(fan.poolId, 'pool-synthetic');
  assert.equal(fan.allDone, true);
  assert.equal(fan.verified, 2);
  assert.equal(fan.tokens.calls, 0);
  assert.deepEqual(fan.results.map((x) => x.id).sort(), ['synthetic-pair-a', 'synthetic-pair-b']);
  for (const res of fan.results) {
    assert.equal(res.scheduleExit, 0);
    assert.equal(res.verifyExit, 0);
    assert.deepEqual(res.statuses, { src: 'done', left: 'done', right: 'done', compose: 'done' });
    const runDir = path.join(fanDir, res.id);
    assert.equal(fs.readFileSync(path.join(runDir, 'atoms', 'compose', 'out', 'all.txt'), 'utf8'), 'seed left\nseed right\n');
    assert.ok(fs.existsSync(path.join(runDir, 'schedule.log')));
    assert.equal(readJson(path.join(runDir, 'receipt', 'verify.json')).ok, true);
    assert.match(fs.readFileSync(path.join(runDir, 'receipt', 'REPORT.md'), 'utf8'), new RegExp(`^# Run report: ${res.id}`));
  }
  const ev = events();
  const pool = ev.filter((e) => e.poolId === 'pool-synthetic');
  assert.deepEqual(pool.filter((e) => e.event.startsWith('pool.')).map((e) => e.event), ['pool.start', 'pool.end']);
  assert.deepEqual(pool.find((e) => e.event === 'pool.start').requests.sort(), ['synthetic-pair-a', 'synthetic-pair-b']);
  assert.deepEqual(pool.filter((e) => e.event === 'run.start').map((e) => e.need).sort(), ['synthetic-pair-a', 'synthetic-pair-b']);
});

test('fanout records a graph the scheduler refuses and keeps running the others', () => {
  const good = writeJson(path.join(tmp, 'fan2', 'good.json'), withNeed(pair, 'synthetic-pair-good'));
  const bad = writeJson(path.join(tmp, 'fan2', 'cycle.json'), readJson(FIX('synthetic-cycle.json')));
  const out = path.join(tmp, 'fanout-mixed');
  const r = run('fanout.mjs', [good, bad, '--out-dir', out, '--parallel-runs', '2', '--per-run-concurrency', '2']);
  assert.ok(fs.existsSync(path.join(out, 'fanout.json')), `no fanout.json; exit ${r.status} ${r.stderr.slice(-400)}`);
  const s = readJson(path.join(out, 'fanout.json'));
  assert.equal(s.requests, 2);
  assert.equal(s.allDone, false);
  assert.equal(s.verified, 1);
  const refused = s.results.find((x) => x.file === bad);
  assert.equal(refused.scheduleExit, 3);
  assert.notEqual(refused.verifyExit, 0);
  assert.equal(s.results.find((x) => x.file === good).allDone, true);
  assert.equal(r.status, 1, 'fanout must exit 1 when a request is not verified');
});

test('report renders the timeline, waves and verification of a run directory', () => {
  assert.ok(fan, 'fanout run missing');
  const runDir = path.join(fanDir, 'synthetic-pair-a');
  fs.rmSync(path.join(runDir, 'receipt', 'REPORT.md'));
  const r = run('report.mjs', [runDir]);
  assert.equal(r.status, 0, r.stderr);
  const md = fs.readFileSync(path.join(runDir, 'receipt', 'REPORT.md'), 'utf8');
  assert.equal(r.stdout, md);
  assert.match(md, /^# Run report: synthetic-pair-a/);
  assert.match(md, /Atoms 4; concurrency 2;/);
  assert.match(md, /all done: true/);
  assert.match(md, /Tokens: 0 model calls/);
  for (const id of ['src', 'left', 'right', 'compose']) assert.match(md, new RegExp(`^\\| ${id} \\| \\w+ \\| script \\| [0-9.]+ \\| [0-9.]+ \\| [0-9.]+ \\| 1 \\| done \\| 0 / 0 / 0 \\|$`, 'm'), id);
  assert.match(md, /## Waves \(planned\)\n\n- wave 0: src\n- wave 1: left, right\n- wave 2: compose/);
  assert.match(md, /## Verification\n\nok: true\n- A1: pass/);
});

test('cutover pairs the arms per case, refuses model work without a subscription login, and ledgers every case', () => {
  const ladderDir = path.join(tmp, 'ladder');
  fs.mkdirSync(ladderDir, { recursive: true });
  fs.writeFileSync(path.join(ladderDir, 'synthetic-case.md'), '# Request synthetic-case\n\nSynthetic case for the cutover command test.\n');
  fs.writeFileSync(path.join(ladderDir, 'synthetic-other.md'), '# Request synthetic-other\n\nSynthetic case that the filter excludes.\n');
  const ladder = writeJson(path.join(ladderDir, 'ladder.json'), { cases: [{ id: 'synthetic-case', tier: 1 }, { id: 'synthetic-other', tier: 2 }] });
  const out = path.join(tmp, 'cutover');
  const r = run('cutover.mjs', [ladder, '--out-dir', out, '--cases', 'synthetic-case', '--arms', 'direct,atomized', '--experiment-id', 'cutover-synthetic']);
  assert.equal(r.status, 0, r.stderr.slice(-600));
  const results = readJson(path.join(out, 'results-r1.json'));
  assert.deepEqual(results.map((x) => x.case), ['synthetic-case']);
  const [c] = results;
  assert.deepEqual(c.arms, ['direct', 'atomized']);
  assert.equal(c.winnerGated, 'neither');
  assert.equal(c.direct.promotable, false);
  assert.equal(c.atomized.planValid, false);
  assert.equal(c.atomized.promotable, false);
  assert.deepEqual(readJson(path.join(out, 'synthetic-case-r1', 'case.json')), c);
  const directRun = readJson(path.join(out, 'synthetic-case-r1', 'direct', 'receipt', 'run.json'));
  assert.equal(directRun.statuses.direct, 'failed');
  assert.equal(directRun.tokens.calls, 0);
  const directAtom = readJson(path.join(out, 'synthetic-case-r1', 'direct', 'receipt', 'atoms', 'direct.json'));
  assert.equal(directAtom.attempts.length, 1);
  assert.equal(directAtom.attempts[0].exit, 78);
  assert.match(directAtom.attempts[0].reason, /subscription login|claude\.ai login/);
  const planned = readJson(path.join(out, 'synthetic-case-r1', 'atomized-plan', 'receipt', 'atomize.json'));
  assert.equal(planned.valid, false);
  assert.equal(planned.attempts.length, 1);
  assert.match(planned.attempts[0].errors[0], /^model call refused: /);
  assert.ok(!fs.existsSync(path.join(out, 'synthetic-case-r1', 'atomized-plan', 'atoms.json')));
  assert.equal(readJson(path.join(out, 'synthetic-case-r1', 'direct-atoms.json')).need.id, 'synthetic-case');
  assert.ok(!fs.existsSync(path.join(out, 'synthetic-other-r1')));
  const ev = events().filter((e) => e.experimentId === 'cutover-synthetic');
  assert.deepEqual(ev.map((e) => e.event), ['cutover.start', 'cutover.case', 'cutover.end']);
  assert.deepEqual(ev[0].cases, ['synthetic-case']);
  assert.equal(JSON.parse(r.stdout.trim().split('\n').at(-1))[0].winner, 'neither');
});

test('cutover refuses an unknown arm and finishes cleanly when no case matches', () => {
  const ladder = path.join(tmp, 'ladder', 'ladder.json');
  const bad = run('cutover.mjs', [ladder, '--out-dir', path.join(tmp, 'cutover-bad'), '--arms', 'direct,sideways']);
  assert.equal(bad.status, 2, bad.stderr.slice(-400));
  assert.match(bad.stderr, /unknown arm: sideways/);
  assert.ok(!fs.existsSync(path.join(tmp, 'cutover-bad')));
  const none = run('cutover.mjs', [ladder, '--out-dir', path.join(tmp, 'cutover-none'), '--cases', 'absent', '--experiment-id', 'cutover-none'], { timeout: 30_000 });
  assert.equal(none.status, 0, none.stderr.slice(-400));
  assert.deepEqual(readJson(path.join(tmp, 'cutover-none', 'results-r1.json')), []);
  assert.deepEqual(events().filter((e) => e.experimentId === 'cutover-none').map((e) => e.event), ['cutover.start', 'cutover.end']);
});

process.env.ENDOFORGE_TOOLCHAIN_CLAUDE = claudeHost;
const rendered = (doc, atom) => workerCommand(doc, atom, [], policy, REPO, null).prompt;
const shippingGlue = { id: 'shipping', assumption: 'Weights are whole grams and only zones 1 and 2 ship.', question: 'Do any parcels ship outside zones 1 and 2?',
  exports: [{ name: 'shippingCents', label: 'Shipping price for one parcel', headline: true,
    args: [{ name: 'grams', kind: 'integer', unit: 'g' }, { name: 'zone', kind: 'code', unit: 'code', codes: { 1: 'domestic', 2: 'international' } }],
    result: { kind: 'integer', unit: 'cents' } }],
  traps: [{ fn: 'shippingCents', when: 'negative weight or unknown zone', message: 'Give a weight of 0 g or more and zone 1 or 2.' }] };
const shippingText = 'shippingCents(grams, zone): 500 cents base plus 2 cents per gram in zone 1, 4 cents per gram in zone 2.\nRefuse negative weights and any other zone.\n';
const shippingBlock = { exports: [{ name: 'shippingCents', args: [{ name: 'grams', kind: 'integer', unit: 'g' }, { name: 'zone', kind: 'code', unit: 'code', codes: { 1: 'domestic', 2: 'international' } }], result: { kind: 'integer', unit: 'cents' } }], traps: ['shippingCents'] };
const shippingParts = (root, contract) => {
  writeJson(path.join(root, 'in', 'glue', 'glue.json'), shippingGlue);
  fs.mkdirSync(path.join(root, 'in', 'contract'), { recursive: true });
  fs.writeFileSync(path.join(root, 'in', 'contract', 'CONTRACT.md'), contract);
  writeJson(path.join(root, 'in', 't-m1', 'tests-m1.json'), [
    { name: '1 kg, zone 1', fn: 'shippingCents', args: [1000, 1], expect: 2500 },
    { name: '1 kg, zone 2', fn: 'shippingCents', args: [1000, 2], expect: 4500 },
    { name: 'zone 3 is refused', fn: 'shippingCents', args: [1000, 3], expectError: true },
    { name: 'negative weight is refused', fn: 'shippingCents', args: [-1, 1], expectError: true }]);
  fs.mkdirSync(path.join(root, 'in', 'k-m1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'in', 'k-m1', 'm1.ts'), 'export function shippingCents(grams: i32, zone: i32): i32 {\n  if (grams < 0 || (zone != 1 && zone != 2)) unreachable();\n  return 500 + grams * (zone == 1 ? 2 : 4);\n}\n');
  for (const d of ['out', 'work']) fs.mkdirSync(path.join(root, d), { recursive: true });
};
const blocked = `${shippingText}\n\`\`\`capability\n${JSON.stringify(shippingBlock)}\n\`\`\`\n`;
const composeArgs = (root) => ['--id', 'shipping', '--in', path.join(root, 'in'), '--out', path.join(root, 'out'), '--work', path.join(root, 'work'), '--gate', path.join(REPO, 'tools', 'gate', 'gate.mjs')];

test('atomize asks for the capability block in its rendered prompt and names the gates G1-G9', () => {
  const out = path.join(tmp, 'atomize-prompt');
  const r = run('atomize.mjs', [needFile('synthetic-prompt'), '--out', out, '--fixture', FIX('synthetic-pair.json')]);
  assert.equal(r.status, 0, r.stderr);
  const prompt = fs.readFileSync(path.join(out, 'receipt', 'turn-1-prompt.md'), 'utf8');
  assert.ok(prompt.includes(capabilityRule), 'the atomizer prompt carries the pipeline capability rule');
  assert.match(prompt, /G1-G9/);
  assert.doesNotMatch(prompt, /G1-G7/);
  assert.match(prompt, /glue atom[^\n]*CONTRACT\.md/i);
});

test('a contract atom the atomizer plans gets the capability block in its rendered prompt', () => {
  const doc = { need: { id: 'synthetic-contract', text: '# Request synthetic-contract\n\nA need.' } };
  const atom = { id: 'contract', kind: 'contract', title: 'Contract', contract: 'CONTRACT.md for the interface, with the assumption and the question.', inputs: [{ from: 'need' }], outputs: [{ name: 'contract', path: 'CONTRACT.md' }], worker: { model: 'sonnet', tools: [], prompt: 'Write the contract.' } };
  assert.ok(rendered(doc, atom).includes(capabilityRule));
  const glue = rendered(doc, { ...atom, id: 'glue', kind: 'glue', outputs: [{ name: 'glue', path: 'glue.json' }] });
  assert.match(glue, /capability block/);
});

test('the direct worker prompt asks for the capability block before the freeze and the graph names the gates G1-G9', () => {
  const out = path.join(tmp, 'direct-prompt', 'atoms.json');
  const r = run('direct.mjs', [needFile('synthetic-direct-prompt'), '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const doc = readJson(out);
  const prompt = rendered(doc, doc.atoms[0]);
  assert.ok(prompt.includes(capabilityRule));
  assert.ok(prompt.indexOf(capabilityRule) < prompt.indexOf('freeze /work/'), 'the block is asked for before the freeze');
  assert.match(doc.acceptance[0].statement, /G1-G9/);
  assert.doesNotMatch(JSON.stringify(doc), /G1-G7/);
});

test('the templated planner asks its contract atom for the capability block and feeds the contract to glue', () => {
  const lines = path.join(tmp, 'plan-lines.txt');
  fs.writeFileSync(lines, 'E shippingCents(grams:i32:g, zone:i32:code) -> integer:i32:cents\nC shippingCents.zone 1=domestic;2=international\nM m1 shippingCents | price table\nA assumption: whole grams\nQ Which zones ship?\nR negative weight; unknown zone\n');
  const out = path.join(tmp, 'plan-template');
  const r = run('plan-template.mjs', [needFile('synthetic-plan'), '--out', out, '--fixture', lines, '--reviews', '0']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = readJson(path.join(out, 'atoms.json'));
  const contract = doc.atoms.find((a) => a.kind === 'contract');
  assert.match(contract.contract, /```capability block/);
  assert.ok(rendered(doc, contract).includes(capabilityRule));
  const glue = doc.atoms.find((a) => a.kind === 'glue');
  assert.ok(glue.inputs.some((i) => i.from === 'contract'), 'glue reads the contract it must agree with');
  assert.match(rendered(doc, glue), /capability block/);
  assert.match(doc.atoms.find((a) => a.kind === 'compose').contract, /G1-G9/);
  assert.match(doc.acceptance[0].statement, /G1-G9/);
  assert.doesNotMatch(JSON.stringify(doc), /G1-G7/);
});

test('S2: every atomizer prompt that asks for the capability block asks for the layout of records, lists and text', () => {
  for (const word of ['record, list or text', '"fields"', '"items"', '"max"', '"maxBytes"']) assert.ok(capabilityRule.includes(word), word);
  const out = path.join(tmp, 'atomize-layout');
  const r = run('atomize.mjs', [needFile('synthetic-layout'), '--out', out, '--fixture', FIX('synthetic-pair.json')]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.readFileSync(path.join(out, 'receipt', 'turn-1-prompt.md'), 'utf8').includes(capabilityRule));
  const doc = { need: { id: 'synthetic-layout', text: '# Request synthetic-layout\n\nA need.' } };
  const atom = { id: 'contract', kind: 'contract', title: 'Contract', contract: 'CONTRACT.md for the interface.', inputs: [{ from: 'need' }], outputs: [{ name: 'contract', path: 'CONTRACT.md' }], worker: { model: 'sonnet', tools: [], prompt: 'Write the contract.' } };
  assert.ok(rendered(doc, atom).includes(capabilityRule));
  assert.match(rendered(doc, { ...atom, id: 'glue', kind: 'glue', outputs: [{ name: 'glue', path: 'glue.json' }] }), /nested layout \(record fields with their kinds and units, list items and max, text maxBytes\)/);
  const directOut = path.join(tmp, 'direct-layout', 'atoms.json');
  assert.equal(run('direct.mjs', [needFile('synthetic-direct-layout'), '--out', directOut]).status, 0);
  const direct = readJson(directOut);
  const prompt = rendered(direct, direct.atoms[0]);
  assert.ok(prompt.includes(capabilityRule));
  assert.match(prompt, /nested layout and traps of the capability block/);
  assert.match(direct.atoms[0].contract, /declares the layout of every record, list or text value/);
  const lines = path.join(tmp, 'plan-layout-lines.txt');
  fs.writeFileSync(lines, 'E shippingCents(grams:i32:g, zone:i32:code) -> integer:i32:cents\nC shippingCents.zone 1=domestic;2=international\nM m1 shippingCents | price table\nA assumption: whole grams\nQ Which zones ship?\nR negative weight; unknown zone\n');
  const planned = path.join(tmp, 'plan-layout');
  const p = run('plan-template.mjs', [needFile('synthetic-plan-layout'), '--out', planned, '--fixture', lines, '--reviews', '0']);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const plan = readJson(path.join(planned, 'atoms.json'));
  assert.match(plan.atoms.find((a) => a.kind === 'contract').contract, /the layout of every record, list or text value at any depth \(record fields with names, kinds and units; list items and max; text maxBytes\)/);
  assert.match(plan.atoms.find((a) => a.kind === 'glue').contract, /the nested layout of every record, list or text value/);
});

test('compose-kernel refuses a contract atom whose CONTRACT.md has no capability block, before freezing', () => {
  const root = path.join(tmp, 'compose-blockless');
  shippingParts(root, shippingText);
  const r = run('compose-kernel.mjs', composeArgs(root));
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stderr, /contract\/CONTRACT\.md: CONTRACT\.md has no ```capability block/);
  assert.ok(!fs.existsSync(path.join(root, 'work', 'shipping', 'frozen.sha256')));
  assert.ok(!fs.existsSync(path.join(root, 'work', 'shipping', 'kernel.ts')));
  fs.writeFileSync(path.join(root, 'in', 'contract', 'CONTRACT.md'), `${shippingText}\n\`\`\`capability\n{ exports: shippingCents }\n\`\`\`\n`);
  const bad = run('compose-kernel.mjs', composeArgs(root));
  assert.equal(bad.status, 3, bad.stdout + bad.stderr);
  assert.match(bad.stderr, /capability block is not JSON/);
});

const withNodeEnv = (value, fn) => {
  const saved = process.env.ENDOFORGE_TOOLCHAIN_NODE;
  if (value === undefined) delete process.env.ENDOFORGE_TOOLCHAIN_NODE; else process.env.ENDOFORGE_TOOLCHAIN_NODE = value;
  try { return fn(); } finally { if (saved === undefined) delete process.env.ENDOFORGE_TOOLCHAIN_NODE; else process.env.ENDOFORGE_TOOLCHAIN_NODE = saved; }
};
const runningHome = path.dirname(path.dirname(process.execPath));

test('the policy names no fixed node home, so the node toolchain defaults to the Node running the atomizer', () => {
  assert.equal(policy.toolchain.node, undefined);
  withNodeEnv(undefined, () => {
    assert.equal(resolveToolchainPath('node', policy, REPO), runningHome);
    const [node] = toolchainFor(['node'], policy, REPO);
    assert.deepEqual(node, { host: runningHome, guest: runningHome, bin: path.join(runningHome, 'bin') });
    assert.ok(fs.existsSync(path.join(node.bin, 'node')), `${node.bin}/node exists`);
    assert.equal(fs.realpathSync(path.join(node.bin, 'node')), fs.realpathSync(process.execPath));
  });
});

test('ENDOFORGE_TOOLCHAIN_NODE overrides the node home when it holds bin/node', () => {
  const home = path.join(tmp, 'node-override');
  fs.mkdirSync(path.join(home, 'bin'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'bin', 'node'));
  withNodeEnv(home, () => {
    assert.equal(resolveToolchainPath('node', policy, REPO), home);
    assert.deepEqual(toolchainFor(['node'], policy, REPO)[0], { host: home, guest: home, bin: path.join(home, 'bin') });
  });
});

test('an explicitly configured node home without bin/node is refused before any sandbox starts', () => {
  const empty = path.join(tmp, 'node-empty');
  fs.mkdirSync(path.join(empty, 'bin'), { recursive: true });
  for (const [envValue, pol] of [[empty, policy], [undefined, { ...policy, toolchain: { ...policy.toolchain, node: empty } }], [path.join(tmp, 'node-absent'), policy]]) {
    withNodeEnv(envValue, () => {
      assert.throws(() => toolchainFor(['node', 'asc'], pol, REPO), (e) => /toolchain node home .* has no bin\/node/.test(e.message) && /ENDOFORGE_TOOLCHAIN_NODE/.test(e.message) && e.message.includes(runningHome));
      assert.throws(() => resolveToolchainPath('node', pol, REPO), /has no bin\/node/);
    });
  }
});

const asyncTest = async (name, fn) => { try { await fn(); console.log(`PASS ${name}`); } catch (e) { fails++; console.log(`FAIL ${name}: ${e.message}`); } };
await asyncTest('the compose helper composes and gates inside the atom isolate with the policy compose toolchain', async () => {
  const root = path.join(tmp, 'compose-isolated');
  shippingParts(root, blocked);
  const doc = augment({ schema: 'endoforge/atoms/1', need: { id: 'shipping', text: 'Shipping price.' }, acceptance: [], atoms: [
    { id: 'k-m1', kind: 'kernel', contract: 'kernel part', inputs: [], outputs: [{ name: 'kernel', path: 'm1.ts' }], worker: { model: 'sonnet', tools: ['Bash'] }, size: { work: 1, interface: 1 } },
    { id: 'compose', kind: 'compose', contract: 'compose', inputs: [{ from: 'k-m1', output: 'kernel' }], outputs: [{ name: 'gates', path: 'gates.json' }], worker: { model: 'sonnet', tools: ['Bash'] }, size: { work: 1, interface: 1 } }] }, { ...policy, repairStage: true, scriptFirst: true });
  const helper = doc.atoms.find((a) => a.id === 'compose').worker.preflight;
  const cmd = helper.command.map((x) => x.replaceAll('{in}', '/in').replaceAll('{out}', '/out').replaceAll('{work}', '/work').replaceAll('{atomizer}', path.join(REPO, policy.toolchain.atomizer)).replaceAll('{gate}', path.join(REPO, policy.toolchain.gate, 'gate.mjs')));
  const home = makeHomeTemplate(fs.mkdtempSync(path.join(os.tmpdir(), 'compose-home-')));
  try {
    const r = await runIsolated({ homeTemplate: home, toolchain: toolchainFor(helper.toolchain, policy, REPO), cmd, cwd: '/work', timeoutMs: 300_000,
      mounts: [{ host: path.join(root, 'in'), guest: '/in', mode: 'ro' }, { host: path.join(root, 'out'), guest: '/out', mode: 'rw' }, { host: path.join(root, 'work'), guest: '/work', mode: 'rw' }] });
    assert.equal(r.exit, 0, (r.stdout + r.stderr).slice(-1500));
    const gates = readJson(path.join(root, 'out', 'gates.json'));
    assert.equal(gates.promotable, true, JSON.stringify(gates.gates));
    assert.equal(gates.gates.G7_glue.ok, true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('atomizer commands: all passed');
