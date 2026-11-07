import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LedgerBridge } from '../../core/runtime/isolate-ledger.mjs';
import { prepared, repository } from './common.mjs';

const { output, trial, point, batch, lost } = JSON.parse(process.argv[2]);
const { streams } = JSON.parse(readFileSync(join(output, 'capture.json'), 'utf8'));
const directory = join(output, 'crash', `trial-${trial}`), journal = join(directory, 'journal');
rmSync(directory, { recursive: true, force: true });
mkdirSync(journal, { recursive: true });
const crashSite = join(repository, 'tests/fixtures/crash_site');
Object.assign(process.env, { PYTHONPATH: `${crashSite}:${repository}`, EF_WRITER_KILL: `${point}:${batch}` });
delete process.env.LD_PRELOAD;
delete process.env.ENDOFORGE_LEDGER_STATS;
const bridge = new LedgerBridge({ extension: 'tools.x1_loop', journal });
await bridge.start();
const candidates = [], width = 64, count = 1024;
let cursor = 0, stopped = false;
await Promise.all(Array.from({ length: width }, async () => {
  while (cursor < count && !stopped) {
    const index = cursor++, stream = streams[index % streams.length], state = { after: null };
    const ledger = join(directory, `${stream.name}-${index}`, 'ledger.sqlite'), sent = [];
    candidates.push({ index, name: stream.name, ledger, sent });
    for (const make of prepared(stream, ledger, state)) {
      if (stopped) break;
      const [action, job, result] = make();
      const entry = { action, after: result.after ?? null, continuation: result.continuation ?? null, sha256: result.sha256 ?? null };
      sent.push(entry);
      try {
        const answer = await bridge.request(action, job, result);
        entry.acked = true;
        if (action === 'admit') entry.identity = answer.identity;
        if (action === 'park') { entry.seq = answer.seq; state.after = answer.seq; }
        if (action === 'commit') Object.assign(entry, { candidate: answer.decision.candidate, receipt: answer.decision.receipt.id, decision: answer.decision.decision });
      } catch (error) {
        entry.acked = false;
        entry.outcome = error.outcome ?? null;
        entry.error = error.message;
        stopped = true;
        break;
      }
    }
  }
}));
await bridge.close();
delete process.env.EF_WRITER_KILL;
const touched = candidates.filter(c => c.sent.length);
if (lost) for (const c of touched) for (const suffix of ['', '-wal', '-shm']) rmSync(`${c.ledger}${suffix}`, { force: true });
process.env.ENDOFORGE_LEDGER_STATS = join(directory, 'recovery.json');
const recovery = new LedgerBridge({ extension: 'tools.x1_loop', journal });
await recovery.start();
await recovery.close();
const recovered = JSON.parse(readFileSync(join(directory, 'recovery.json'), 'utf8'));
const seen = JSON.parse(execFileSync('python3', ['-B', '-c', `
import json, os, sqlite3, sys
from core.ledger.ledger import Ledger
out = {}
for path in json.load(sys.stdin):
    if not os.path.exists(path):
        out[path] = dict(exists=False)
        continue
    entry = dict(exists=True, conflict=os.path.exists(path + '.journal-conflict'))
    try:
        records = Ledger(path).records()
        entry.update(chain=True, records=[[r['kind'], r['id']] for r in records])
    except Exception as error:
        entry.update(chain=False, error=str(error))
    db = sqlite3.connect(path)
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    entry['continuations'] = [list(r) for r in db.execute('SELECT seq, state, sha256 FROM x1_continuations ORDER BY seq')] if 'x1_continuations' in tables else []
    entry['decisions'] = [list(r) for r in db.execute('SELECT receipt, candidate FROM x1_decisions')] if 'x1_decisions' in tables else []
    db.close()
    out[path] = entry
print(json.dumps(out))
`], { cwd: repository, input: JSON.stringify(touched.map(c => c.ledger)), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));

const problems = [], counts = { acked: 0, unacked: 0, unknown: 0, present: 0, absent: 0 };
const fail = (c, message) => problems.push(`${c.name}-${c.index}: ${message}`);
for (const c of touched) {
  const ledger = seen[c.ledger], kinds = (ledger.records ?? []).map(([kind]) => kind), ids = (ledger.records ?? []).map(([, id]) => id);
  if (ledger.exists && !ledger.chain) fail(c, `chain: ${ledger.error}`);
  if (ledger.conflict) fail(c, 'journal conflict');
  if (new Set(ids).size !== ids.length) fail(c, 'duplicate record id');
  if (kinds.filter(kind => kind === 'receipt').length > c.sent.filter(s => s.action === 'commit').length) fail(c, 'more receipts than commits sent');
  if ((ledger.continuations ?? []).length > c.sent.filter(s => s.action === 'park').length) fail(c, 'more continuations than parks sent');
  if ((ledger.decisions ?? []).length > c.sent.filter(s => s.action === 'commit').length) fail(c, 'more decisions than commits sent');
  for (const s of c.sent) {
    counts[s.acked ? 'acked' : 'unacked'] += 1;
    if (!s.acked) {
      if (s.outcome === 'outcome_unknown') counts.unknown += 1;
      else fail(c, `unacknowledged ${s.action} rejected without outcome_unknown: ${s.error}`);
    }
    let present, partial = false;
    if (s.action === 'admit') {
      const admitted = ['task', 'admitted_input', 'frozen_evaluator'].map(kind => kinds.includes(kind));
      present = admitted.every(Boolean);
      partial = !present && admitted.some(Boolean);
      if (s.acked && !ids.includes(s.identity)) fail(c, 'acknowledged frozen evaluator missing');
    } else if (s.action === 'park') {
      const row = (ledger.continuations ?? []).find(([, , sha]) => sha === s.sha256);
      present = Boolean(row);
      const previous = s.after === null ? null : (ledger.continuations ?? []).find(([seq]) => seq === s.after);
      if (previous && present !== (previous[1] !== 'waiting')) partial = true;
      if (s.acked && (!row || row[0] !== s.seq)) fail(c, 'acknowledged continuation missing or renumbered');
    } else {
      const receipt = kinds.includes('receipt'), decision = (ledger.decisions ?? []).length > 0, candidate = kinds.includes('candidate');
      present = receipt;
      const closed = s.continuation === null ? receipt : (ledger.continuations ?? []).find(([seq]) => seq === s.continuation)?.[1] === 'closed';
      partial = [receipt, decision, candidate, closed].some(value => value !== receipt);
      if (s.acked && (!ids.includes(s.receipt) || !ids.includes(s.candidate) || !(ledger.decisions ?? []).some(([receipt]) => receipt === s.receipt))) fail(c, 'acknowledged commit missing');
    }
    if (partial) fail(c, `${s.acked ? '' : 'un'}acknowledged ${s.action} is partly applied`);
    if (!s.acked) counts[present ? 'present' : 'absent'] += 1;
  }
}
const summary = { trial, point, batch, lost, candidatesStarted: touched.length, requests: counts.acked + counts.unacked, ...counts, killed: counts.unacked > 0,
  recovery: { torn_tails: recovered.torn_tails, frames_replayed: recovered.frames_replayed, ledgers_replayed: recovered.ledgers_replayed, conflicts: recovered.conflicts, segments_recovered: recovered.segments_recovered },
  quarantined: existsSync(journal) ? execFileSync('ls', [journal], { encoding: 'utf8' }).split('\n').filter(name => name.includes('.torn-')).length : 0,
  problems: problems.slice(0, 20), problemCount: problems.length, pass: problems.length === 0 && counts.unacked > 0 };
writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
