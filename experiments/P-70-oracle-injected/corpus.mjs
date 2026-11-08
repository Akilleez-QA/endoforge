import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const seed = 70;
export const perNeed = 30;
export const devShare = 0.3;
export const pools = ['P-32', 'P-33', 'P-34', 'P-35', 'P-36', 'P-37', 'P-38', 'P-39', 'P-41'];
export const sha = text => createHash('sha256').update(text).digest('hex');
export const specHash = (contract, tests) => sha(`${contract}\0${tests}`);
const order = (salt, key) => sha(`P-70:${seed}:${salt}:${key}`);
export const needOf = id => /^add-\d+$/.test(id) ? 'add' : id;
export const splitOf = hash => parseInt(order('split', hash).slice(0, 8), 16) / 2 ** 32 < devShare ? 'dev' : 'heldout';

function compiledOf(directory) {
  const db = new DatabaseSync(join(directory, 'ledger.sqlite'), { readOnly: true });
  try {
    for (const { body } of db.prepare('select body from records order by seq desc').all()) {
      const content = JSON.parse(body).data?.content;
      if (typeof content !== 'string') continue;
      try { const parsed = JSON.parse(content); if (parsed?.compiled?.wasm) return parsed.compiled; } catch { }
    }
    return null;
  } finally { db.close(); }
}

function promoted(root, study, runs) {
  const rows = [];
  for (const run of readdirSync(join(root, study)).filter(runs).sort()) {
    const thread = join(root, study, run, 'thread');
    if (!existsSync(thread)) continue;
    for (const name of readdirSync(thread).filter(n => n.endsWith('.json')).sort()) {
      const row = JSON.parse(readFileSync(join(thread, name), 'utf8'));
      if (!row.promoted) continue;
      const directory = join(thread, row.id), read = file => readFileSync(join(directory, 'candidate', file), 'utf8');
      rows.push({ key: `${study}/${run}/${row.id}`, id: row.id, need: needOf(row.id), directory, contract: read('CONTRACT.md'), tests: read('tests.json'), kernel: read('kernel.ts') });
    }
  }
  return rows;
}

export function excludedHashes(root, p69Corpus) {
  const out = new Set(promoted(root, 'P-42', n => /^cand-r\d+$/.test(n)).map(r => specHash(r.contract, r.tests)));
  for (const entry of JSON.parse(readFileSync(p69Corpus, 'utf8'))) if (typeof entry.contract === 'string' && typeof entry.tests === 'string') out.add(specHash(entry.contract, entry.tests));
  return out;
}

export function build(root, p69Corpus) {
  const excluded = excludedHashes(root, p69Corpus), seen = new Set(), counts = { promoted: 0, duplicate: 0, excluded: 0, noCompiled: 0, capped: 0 };
  const unique = [];
  for (const study of pools) for (const row of promoted(root, study, n => /^(base|cand)-r\d+$/.test(n))) {
    counts.promoted++;
    const hash = specHash(row.contract, row.tests);
    if (seen.has(hash)) { counts.duplicate++; continue; }
    seen.add(hash);
    if (excluded.has(hash)) { counts.excluded++; continue; }
    unique.push({ ...row, hash });
  }
  const kept = [];
  for (const [, rows] of Map.groupBy(unique, r => r.need)) {
    const sorted = rows.sort((a, b) => order('cap', a.hash).localeCompare(order('cap', b.hash)));
    counts.capped += Math.max(0, sorted.length - perNeed);
    kept.push(...sorted.slice(0, perNeed));
  }
  const specs = [];
  for (const row of kept.sort((a, b) => a.hash.localeCompare(b.hash))) {
    const compiled = compiledOf(row.directory);
    if (!compiled) { counts.noCompiled++; continue; }
    const { directory: _d, ...rest } = row;
    specs.push({ ...rest, compiled, split: splitOf(row.hash) });
  }
  const manifest = split => sha(specs.filter(s => s.split === split).map(s => s.hash).join('\n'));
  return { specs, counts, needs: Object.fromEntries([...Map.groupBy(specs, s => s.need)].map(([need, rows]) => [need, rows.length])),
    split: { seed, devShare, perNeed, dev: specs.filter(s => s.split === 'dev').length, heldout: specs.filter(s => s.split === 'heldout').length, devManifest: manifest('dev'), heldoutManifest: manifest('heldout') } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, p69Corpus, output] = process.argv.slice(2);
  const corpus = build(root, p69Corpus);
  const text = JSON.stringify(corpus);
  writeFileSync(output, text);
  console.log(JSON.stringify({ sha256: sha(text), counts: corpus.counts, needs: corpus.needs, split: corpus.split }, null, 1));
}
