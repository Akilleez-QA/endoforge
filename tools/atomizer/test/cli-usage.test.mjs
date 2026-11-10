import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin');
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `cli-usage-${p}-`));

function cli(name, args, ledger = tmp('ledger')) {
  const r = spawnSync(process.execPath, [path.join(BIN, name), ...args], { encoding: 'utf8', env: { ...process.env, ATOMIZER_LEDGER_DIR: ledger }, timeout: 60_000 });
  return { exit: r.status, stdout: r.stdout, stderr: r.stderr, ledger };
}

function refusesCleanly(r, name) {
  assert.equal(r.exit, 2, `${name} exit ${r.exit}: ${r.stderr}`);
  assert.match(r.stderr, new RegExp(`usage: ${name.replace('.', '\\.')}`));
  assert.doesNotMatch(r.stderr, /^\s+at |node:internal|^\w*Error: |throw /m);
}

function runDir() {
  const d = tmp('run');
  fs.writeFileSync(path.join(d, 'atoms.json'), JSON.stringify({ need: { id: 'cli-usage' }, atoms: [], acceptance: [] }));
  fs.mkdirSync(path.join(d, 'receipt'));
  fs.writeFileSync(path.join(d, 'receipt', 'run.json'), JSON.stringify({ runId: 'cli-usage-run', statuses: {} }));
  return d;
}

test('verify.mjs refuses a bare call and --help prints its usage', () => {
  refusesCleanly(cli('verify.mjs', []), 'verify.mjs');
  const h = cli('verify.mjs', ['--help']);
  assert.equal(h.exit, 0);
  assert.match(h.stdout, /usage: verify\.mjs <run-dir> \[--policy file\]/);
});

test('verify.mjs honours --policy and records which policy it used', () => {
  const d = runDir();
  const pol = path.join(tmp('policy'), 'custom.policy.json');
  const text = fs.readFileSync(path.join(BIN, '..', 'policy.json'), 'utf8').replace(/\s*$/, '\n');
  fs.writeFileSync(pol, text);
  const r = cli('verify.mjs', [d, '--policy', pol, '--no-archive']);
  assert.equal(r.exit, 0, r.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(d, 'receipt', 'verify.json'), 'utf8'));
  assert.equal(report.policy.path, pol);
  assert.equal(report.policy.sha256, crypto.createHash('sha256').update(text).digest('hex'));
  const def = runDir();
  assert.equal(cli('verify.mjs', [def, '--no-archive']).exit, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(def, 'receipt', 'verify.json'), 'utf8')).policy.path, path.resolve(BIN, '..', 'policy.json'));
});

test('verify.mjs refuses a missing, unreadable or malformed --policy before checking', () => {
  const d = runDir();
  refusesCleanly(cli('verify.mjs', [d, '--policy']), 'verify.mjs');
  const missing = cli('verify.mjs', [d, '--policy', path.join(tmp('nopolicy'), 'absent.json'), '--no-archive']);
  refusesCleanly(missing, 'verify.mjs');
  assert.match(missing.stderr, /policy/);
  const bad = path.join(tmp('badpolicy'), 'bad.json');
  fs.writeFileSync(bad, '{not json');
  refusesCleanly(cli('verify.mjs', [d, '--policy', bad, '--no-archive']), 'verify.mjs');
  assert.equal(fs.existsSync(path.join(d, 'receipt', 'verify.json')), false);
});

test('verify.mjs takes the run directory after its options too', () => {
  const d = runDir();
  const r = cli('verify.mjs', ['--policy', path.join(BIN, '..', 'policy.json'), '--no-archive', d]);
  assert.equal(r.exit, 0, r.stderr);
});

test('ledger-export.mjs refuses cleanly when the ledger has no events file', () => {
  const r = cli('ledger-export.mjs', []);
  refusesCleanly(r, 'ledger-export.mjs');
  assert.match(r.stderr, /no ledger events/);
  assert.equal(fs.existsSync(path.join(r.ledger, 'tables')), false);
});

test('ledger-export.mjs prints usage for --help and refuses bad arguments', () => {
  const h = cli('ledger-export.mjs', ['--help']);
  assert.equal(h.exit, 0);
  assert.match(h.stdout, /usage: ledger-export\.mjs \[--out dir\]/);
  refusesCleanly(cli('ledger-export.mjs', ['--out']), 'ledger-export.mjs');
  refusesCleanly(cli('ledger-export.mjs', ['--bogus']), 'ledger-export.mjs');
});

test('ledger-export.mjs still writes tables from an existing ledger', () => {
  const ledger = tmp('ledger');
  fs.writeFileSync(path.join(ledger, 'events.jsonl'), JSON.stringify({ event: 'run.start', runId: 'r1', need: 'n1', ts: '2026-11-09T00:00:00Z' }) + '\n');
  const out = path.join(tmp('out'), 'tables');
  const r = cli('ledger-export.mjs', ['--out', out], ledger);
  assert.equal(r.exit, 0, r.stderr);
  assert.match(fs.readFileSync(path.join(out, 'runs.csv'), 'utf8'), /^runId,/);
});

test('repair-noop.mjs refuses missing arguments with its usage', () => {
  refusesCleanly(cli('repair-noop.mjs', []), 'repair-noop.mjs');
  const f = path.join(tmp('fail'), 'failures.json');
  fs.writeFileSync(f, '[]');
  refusesCleanly(cli('repair-noop.mjs', ['--failures', f]), 'repair-noop.mjs');
  refusesCleanly(cli('repair-noop.mjs', ['--map', '[]']), 'repair-noop.mjs');
  refusesCleanly(cli('repair-noop.mjs', ['--failures', f, '--map']), 'repair-noop.mjs');
  refusesCleanly(cli('repair-noop.mjs', ['--failures', f, '--map', '{not json']), 'repair-noop.mjs');
  refusesCleanly(cli('repair-noop.mjs', ['--failures', f, '--map', '{"from":"a"}']), 'repair-noop.mjs');
  const h = cli('repair-noop.mjs', ['--help']);
  assert.equal(h.exit, 0);
  assert.match(h.stdout, /usage: repair-noop\.mjs --failures <failures\.json> --map/);
});

test('repair-noop.mjs keeps exit 10 so the model repair runs when tests fail or failures are unreadable', () => {
  const dir = tmp('fail');
  const f = path.join(dir, 'failures.json');
  fs.writeFileSync(f, '[{"test":"t1"}]');
  const r = cli('repair-noop.mjs', ['--failures', f, '--map', '[]']);
  assert.equal(r.exit, 10);
  assert.match(r.stderr, /1 failing tests/);
  assert.equal(cli('repair-noop.mjs', ['--failures', path.join(dir, 'absent.json'), '--map', '[]']).exit, 10);
});
