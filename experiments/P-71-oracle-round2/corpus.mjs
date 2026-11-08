import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build as buildP70, excludedHashes, needOf, pools, sha, specHash } from '../P-70-oracle-injected/corpus.mjs';

export const seed = 71;
export const perNeed = 30;
const order = (salt, key) => sha(`P-71:${seed}:${salt}:${key}`);

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

function promoted(root, study) {
  const rows = [];
  for (const run of readdirSync(join(root, study)).filter(n => /^(base|cand)-r\d+$/.test(n)).sort()) {
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

export function build(root, p69Corpus) {
  const p70 = buildP70(root, p69Corpus);
  const spent = new Set(p70.specs.map(s => s.hash));
  const excluded = excludedHashes(root, p69Corpus), seen = new Set(), counts = { promoted: 0, duplicate: 0, excluded: 0, p70: 0, noCompiled: 0, capped: 0 };
  const unique = [];
  for (const study of pools) for (const row of promoted(root, study)) {
    counts.promoted++;
    const hash = specHash(row.contract, row.tests);
    if (seen.has(hash)) { counts.duplicate++; continue; }
    seen.add(hash);
    if (excluded.has(hash)) { counts.excluded++; continue; }
    if (spent.has(hash)) { counts.p70++; continue; }
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
    specs.push({ ...rest, compiled, split: 'heldout' });
  }
  return { specs, counts, needs: Object.fromEntries([...Map.groupBy(specs, s => s.need)].map(([need, rows]) => [need, rows.length])),
    split: { seed, perNeed, heldout: specs.length, heldoutManifest: sha(specs.map(s => s.hash).join('\n')), p70DevManifest: p70.split.devManifest, p70HeldoutManifest: p70.split.heldoutManifest } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [root, p69Corpus, output] = process.argv.slice(2);
  const corpus = build(root, p69Corpus);
  const text = JSON.stringify(corpus);
  writeFileSync(output, text);
  console.log(JSON.stringify({ sha256: sha(text), counts: corpus.counts, needs: corpus.needs, split: corpus.split }, null, 1));
}
