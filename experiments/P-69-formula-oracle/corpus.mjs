import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const sources = [
  { study: 'P-56', stage: 'pilot', rows: 'endoforge-models-scratch/out/rows.jsonl', dir: 'endoforge-models-scratch/out/pilot', key: row => row.rep },
  { study: 'P-56', stage: 'main', rows: 'endoforge-models-scratch/out/rows.jsonl', dir: 'endoforge-models-scratch/out/main', key: row => row.rep },
  { study: 'P-66', stage: 'main', rows: 'p66-scratch/out/rows.jsonl', dir: 'p66-scratch/out/main', key: row => row.sample },
];

function fromLedger(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    let candidate = null, frozen = null;
    for (const { body } of db.prepare('select body from records order by seq').all()) {
      const data = JSON.parse(body).data ?? {};
      if (typeof data.content !== 'string') continue;
      let content;
      try { content = JSON.parse(data.content); } catch { continue; }
      if (content?.files?.['CONTRACT.md'] !== undefined && content.files['tests.json'] !== undefined) candidate = content;
      else if (content?.files && data.freeze) frozen = content;
    }
    if (!candidate && frozen) {
      const text = name => Buffer.from(frozen.files[name] ?? '', 'hex').toString();
      candidate = { files: { 'CONTRACT.md': text('CONTRACT.md'), 'tests.json': text('tests.json') } };
    }
    return candidate;
  } finally { db.close(); }
}

export function buildCorpus(root) {
  const out = [];
  for (const source of sources) {
    const rows = readFileSync(join(root, source.rows), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row => row.stage === source.stage);
    for (const row of rows) {
      const id = `${row.need}--${row.arm}--${source.key(row)}`, dir = join(root, source.dir);
      const contentPath = join(dir, `${id}.content.json`), ledgerPath = join(dir, id, 'ledger.sqlite');
      let content = null;
      if (existsSync(contentPath)) content = JSON.parse(readFileSync(contentPath, 'utf8'));
      else if (existsSync(ledgerPath)) content = fromLedger(ledgerPath);
      if (!content) { out.push({ study: source.study, stage: source.stage, id, need: row.need, arm: row.arm, promoted: row.promoted, missing: true }); continue; }
      out.push({ study: source.study, stage: source.stage, id, need: row.need, arm: row.arm, promoted: row.promoted, exit: row.agent?.exit_reason ?? row.error ?? null,
        contract: content.files['CONTRACT.md'], tests: content.files['tests.json'], kernel: content.files['kernel.ts'] ?? null, glue: content.files['glue.json'] ?? null, compiled: content.compiled ?? null });
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, target] = process.argv.slice(2);
  const corpus = buildCorpus(root);
  writeFileSync(target, JSON.stringify(corpus));
  console.log(JSON.stringify({ entries: corpus.length, missing: corpus.filter(e => e.missing).length, withKernel: corpus.filter(e => e.kernel).length }));
}
