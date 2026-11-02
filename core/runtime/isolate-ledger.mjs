import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bridge = `
import json, sys
from core.ledger.ledger import Ledger, validate
request = json.load(sys.stdin)
job = request['job']
ledger = Ledger(job['reference']['ledger'])
prior = {r['id']: r for r in ledger.records()}
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
    print('{}')
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
        output.append(dict(record=record, hash=ledger.append(record)))
    print(json.dumps(output))
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
