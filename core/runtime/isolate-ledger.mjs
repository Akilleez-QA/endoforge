import { execFile, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const operation = `
def process(request, prior, append):
    job = request['job']
    receipts = job['receipts']
    if [r['data']['candidate'] for r in receipts] != job['candidates'] or not receipts:
        raise ValueError('one receipt per candidate in candidate order required')
    prepared = dict(prior)
    for record in receipts:
        data = record['data']
        if record['kind'] != 'receipt' or data['frozen_evaluator'] != job['reference']['identity']:
            raise ValueError('receipt must bind the job frozen evaluator')
        data.update(delivery_state='running', outcome_state='unobserved', observations=[])
        validate(record, prepared)
        prepared[record['id']] = record
    if request['action'] == 'prepare':
        return {}
    else:
        result = request['result']
        report = result['report']
        output = []
        for record in receipts:
            data = record['data']
            attempts = [a for a in (report or {}).get('attempts', []) if a['candidate'] == data['candidate']]
            unknown = result['status'] == 'outcome_unknown'
            outcome = 'inconclusive' if unknown else ('failed' if result['status'] == 'rejected' or any(a['stage'] == 'rejected' for a in attempts)
                      else 'passed' if attempts and all(a['stage'] == 'passed' for a in attempts) else 'unobserved')
            data.update(delivery_state='outcome_unknown' if unknown else 'finished', outcome_state=outcome,
                        observations=[result])
            output.append(dict(record=record, hash=append(record)))
        return output
`;

const bridge = `
import json, sys
from core.ledger.ledger import Ledger, validate
${operation}
request = json.load(sys.stdin)
ledger = Ledger(request['job']['reference']['ledger'])
print(json.dumps(process(request, {r['id']: r for r in ledger.records()}, ledger.append)))
`;

export function ledgerRequest(action, job, result) {
  const input = JSON.stringify({ action,
    job: { reference: job.reference, candidates: job.candidates, receipts: job.receipts }, result });
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-B', '-c', bridge], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)), timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`isolate ledger ${action} failed: ${stderr.trim() || error.message}`));
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export const persistentBridge = `
import importlib, json, os, select, sqlite3, sys
from core.ledger.ledger import Ledger, validate
extension = importlib.import_module(sys.argv[1]) if len(sys.argv) > 1 else None
LOOP = extension.LOOP if extension else {}
write_decision = extension.write_decision if extension else (lambda result: None)
${operation}
paths = {}
sys.stdout.write(json.dumps(dict(id=0, result='ready')) + '\\n')
sys.stdout.flush()
buffer = b''
while True:
    chunk = os.read(0, 65536)
    if not chunk:
        break
    buffer += chunk
    while select.select([0], [], [], 0)[0]:
        chunk = os.read(0, 65536)
        if not chunk:
            break
        buffer += chunk
    lines = buffer.split(b'\\n')
    buffer = lines.pop()
    groups = {}
    for line in lines:
        request = json.loads(line)
        groups.setdefault(request['job']['reference']['ledger'], []).append(request)
    for path, requests in groups.items():
        responses = []
        try:
            if path not in paths:
                if any(r['action'] == 'admit' for r in requests):
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    wal = sqlite3.connect(path)
                    wal.execute('PRAGMA journal_mode=WAL')
                else:
                    wal = None
                ledger = Ledger(path)
                paths[path] = (ledger, ledger._connect(), [])
                if wal:
                    wal.close()
            ledger, db, cache = paths[path]
            db.execute('BEGIN IMMEDIATE')
            try:
                prior, previous = ledger._read(db, cache)
                def append(record):
                    global previous
                    previous = ledger._append(db, record, prior, previous)
                    return previous
                for request in requests:
                    db.execute('SAVEPOINT request')
                    saved_prior, saved_previous = dict(prior), previous
                    try:
                        action = LOOP.get(request['action'])
                        result = action(request, prior, append, process, db) if action else process(request, prior, append)
                        responses.append(dict(id=request['id'], result=result))
                    except Exception as error:
                        db.execute('ROLLBACK TO request')
                        prior, previous = saved_prior, saved_previous
                        responses.append(dict(id=request['id'], error=str(error)))
                    db.execute('RELEASE request')
                db.commit()
            except Exception:
                db.rollback()
                cache.clear()
                raise
        except Exception as error:
            responses = [dict(id=r['id'], error=str(error)) for r in requests]
        for response in responses:
            try:
                write_decision(response.get('result'))
            except Exception as error:
                response = dict(id=response['id'], error=str(error))
            print(json.dumps(response), flush=True)
    while len(paths) > 64:
        paths.pop(next(iter(paths)))[1].close()
`;

export class LedgerBridge {
  #child;
  #pending = new Map();
  #next = 0;
  #failure;
  #exit;
  #started;
  #extension;
  #restart;
  #restarts = 0;
  #ready = false;
  #closing = false;

  constructor({ extension, restart = false } = {}) {
    this.#extension = extension;
    this.#restart = restart;
  }

  get failed() {
    return Boolean(this.#failure);
  }

  request(action, job, result) {
    if (this.#failure) return Promise.reject(this.#failure);
    const id = ++this.#next;
    let input;
    try {
      input = JSON.stringify({ id, action,
        job: { reference: job.reference, candidates: job.candidates, receipts: job.receipts }, result }) + '\n';
    } catch (error) { return Promise.reject(error); }
    this.start().catch(() => {});
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, action });
      this.#child.stdin.write(input);
    });
  }

  start() {
    if (this.#failure) return Promise.reject(this.#failure);
    if (!this.#child) {
      const child = this.#child = spawn('python3', ['-B', '-c', persistentBridge, ...(this.#extension ? [this.#extension] : [])], {
        cwd: fileURLToPath(new URL('../../', import.meta.url)), stdio: ['pipe', 'pipe', 'pipe'],
      });
      const fail = error => {
        if (this.#child !== child) return;
        const failure = new Error(`isolate ledger bridge failed: ${error.message}`);
        if (this.#restart && this.#ready && !this.#closing && this.#restarts < 3) {
          this.#restarts += 1;
          this.#child = this.#started = null;
          this.#ready = false;
        } else this.#failure ||= failure;
        for (const pending of this.#pending.values()) pending.reject(this.#failure ?? failure);
        this.#pending.clear();
      };
      this.#exit = new Promise(resolve => child.once('close', (code, signal) => {
        fail(new Error(`exit ${code}, signal ${signal}`));
        resolve();
      }));
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.stderr.resume();
      createInterface({ input: child.stdout }).on('line', line => {
        try {
          const response = JSON.parse(line);
          const pending = this.#pending.get(response.id);
          if (!pending) throw new Error('unknown response id');
          this.#pending.delete(response.id);
          if (response.id === 0) this.#ready = true;
          else if (response.error === undefined) this.#restarts = 0;
          if (response.error !== undefined) pending.reject(new Error(`isolate ledger ${pending.action} failed: ${response.error}`));
          else pending.resolve(response.result);
        } catch (error) { fail(error); child.kill(); }
      });
      this.#started = new Promise((resolve, reject) => this.#pending.set(0, { resolve, reject, action: 'start' }));
    }
    return this.#started;
  }

  async close() {
    this.#closing = true;
    if (!this.#child) { this.#failure ||= new Error('isolate ledger bridge closed'); return; }
    await Promise.allSettled([...this.#pending.values()].map(pending => new Promise(resolve => {
      const done = pending.resolve, failed = pending.reject;
      pending.resolve = value => { done(value); resolve(); };
      pending.reject = error => { failed(error); resolve(); };
    })));
    this.#failure ||= new Error('isolate ledger bridge closed');
    this.#child.kill();
    await this.#exit;
  }
}
