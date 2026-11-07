import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export const sha = text => createHash('sha256').update(text).digest('hex');
// The 177 kernels P-51 calls the candidate corpus, with the need each was generated from (its ledger's admitted input).
export function corpus(root) {
  const rows = [];
  for (const run of readdirSync(root).filter(n => /^cand-r\d+$/.test(n)).sort()) {
    const thread = join(root, run, 'thread');
    for (const name of readdirSync(thread).filter(n => n.endsWith('.json')).sort()) {
      const row = JSON.parse(readFileSync(join(thread, name), 'utf8'));
      if (!row.promoted) continue;
      const directory = join(thread, row.id), read = file => readFileSync(join(directory, 'candidate', file), 'utf8');
      const ledger = execFileSync('python3', ['-I', '-c', 'import sqlite3,sys;db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True);print(db.execute("select body from records where id=?",("input",)).fetchone()[0])', join(directory, 'ledger.sqlite')], { encoding: 'utf8' });
      rows.push({ key: `${run}/${row.id}`, id: row.id, need: JSON.parse(ledger).data.content, contract: read('CONTRACT.md'), tests: read('tests.json'), glue: read('glue.json') });
    }
  }
  return rows;
}
