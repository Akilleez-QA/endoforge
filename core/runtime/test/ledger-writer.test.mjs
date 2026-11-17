import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LedgerBridge } from '../isolate-ledger.mjs';
import { python } from './fixtures/ledger-fixture.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const crashSite = join(repository, 'tests/fixtures/crash_site');
const records = paths => python(`
import json, os, sys
from core.ledger.ledger import Ledger
out = {}
for path in json.load(sys.stdin):
    out[path] = [r['id'] for r in Ledger(path).records()] if os.path.exists(path) else None
print(json.dumps(out))
`, paths);

async function drive(bridge, root, width, notes) {
  const ledgers = [];
  await Promise.all(Array.from({ length: width }, async (_, n) => {
    const ledger = join(root, `task-${n}`, 'ledger.sqlite'), sent = [];
    ledgers.push({ ledger, sent });
    const steps = [['admit', { need: `need ${n}` }, 'task'], ...Array.from({ length: notes }, (_, k) => ['note', { id: `input-${k}` }, `input-${k}`])];
    for (const [action, result, id] of steps) {
      const entry = { id };
      sent.push(entry);
      try {
        entry.seq = (await bridge.request(action, { reference: { ledger } }, result)).seq;
        entry.acked = true;
      } catch (error) {
        Object.assign(entry, { acked: false, outcome: error.outcome ?? null });
        break;
      }
    }
  }));
  return ledgers;
}

const scratch = t => {
  const root = mkdtempSync(join(tmpdir(), 'ef-ledger-writer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test('requests for many ledgers share one journal sync and every answer follows its sync', { timeout: 60000 }, async t => {
  const root = scratch(t);
  const bridge = new LedgerBridge({ extension: 'tests.fixtures.ledger_notes', journal: join(root, 'journal') });
  await bridge.start();
  const ledgers = await drive(bridge, root, 32, 5);
  await bridge.close();
  const seen = await records(ledgers.map(entry => entry.ledger));
  for (const { ledger, sent } of ledgers) {
    assert(sent.every(entry => entry.acked));
    assert.deepEqual(sent.map(entry => entry.seq), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(seen[ledger], ['task', 'input-0', 'input-1', 'input-2', 'input-3', 'input-4']);
  }
  assert.deepEqual(readdirSync(join(root, 'journal')).filter(name => name.endsWith('.journal')), []);
});

for (const [point, lost] of [['after_apply', false], ['half_frame', true], ['after_sync', true], ['half_acks', false]]) {
  test(`SIGKILL of the writer at ${point}${lost ? ' with the ledger files lost' : ''} keeps every acknowledged event once`, { timeout: 60000 }, async t => {
    const root = scratch(t), journal = join(root, 'journal');
    const saved = { PYTHONPATH: process.env.PYTHONPATH, EF_WRITER_KILL: process.env.EF_WRITER_KILL };
    Object.assign(process.env, { PYTHONPATH: `${crashSite}:${repository}`, EF_WRITER_KILL: `${point}:4` });
    t.after(() => { for (const [name, value] of Object.entries(saved)) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
    const bridge = new LedgerBridge({ extension: 'tests.fixtures.ledger_notes', journal });
    await bridge.start();
    const ledgers = await drive(bridge, root, 32, 20);
    await bridge.close();
    delete process.env.EF_WRITER_KILL;
    if (lost) for (const { ledger } of ledgers) for (const suffix of ['', '-wal', '-shm']) rmSync(`${ledger}${suffix}`, { force: true });
    const recovery = new LedgerBridge({ extension: 'tests.fixtures.ledger_notes', journal });
    await recovery.start();
    await recovery.close();
    const seen = await records(ledgers.map(entry => entry.ledger));
    const unacked = ledgers.flatMap(({ sent }) => sent.filter(entry => !entry.acked));
    assert(unacked.length > 0, 'the writer was not killed');
    assert(unacked.every(entry => entry.outcome === 'outcome_unknown'));
    for (const { ledger, sent } of ledgers) {
      const ids = seen[ledger] ?? [];
      const acked = sent.filter(entry => entry.acked).map(entry => entry.id);
      assert.deepEqual(ids.slice(0, acked.length), acked, ledger);
      assert(ids.length <= sent.length, ledger);
      assert.deepEqual(ids, sent.slice(0, ids.length).map(entry => entry.id), ledger);
    }
    const names = readdirSync(journal);
    assert.deepEqual(names.filter(name => name.endsWith('.journal')), []);
    assert.equal(names.filter(name => name.includes('.torn-')).length, point === 'half_frame' ? 1 : 0);
  });
}
