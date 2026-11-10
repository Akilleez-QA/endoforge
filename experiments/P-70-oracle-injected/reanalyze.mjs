import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, verdicts } from './analyze.mjs';
import { needClustered, verdicts as p71Verdicts } from '../P-71-oracle-round2/analyze.mjs';

const experiments = fileURLToPath(new URL('../', import.meta.url));
export const targets = {
  'P-70-oracle-injected/receipt/heldout': 'p70-heldout/rows.json',
  'P-70-oracle-injected/receipt/dev': 'p70-dev/rows.json',
  'P-71-oracle-round2/receipt/heldout': 'p71-heldout/rows.json',
  'P-71-oracle-round2/receipt/dev': 'p70-dev/rows.json',
  'P-71-oracle-round2/receipt/p70-heldout-comparison': 'p70-heldout-comparison/rows.json',
};

const recorded = (experiment, name) => {
  for (const line of readFileSync(join(experiments, experiment, 'receipt/outside-git.sha256'), 'utf8').split('\n')) {
    const [digest, file] = line.split(/\s+/);
    if (file === name) return digest;
  }
  return null;
};

export function regenerate(rowsPath, receipt) {
  const name = targets[receipt];
  if (!name) throw new Error(`${receipt}: no recorded rows for this receipt`);
  const experiment = receipt.split('/')[0], text = readFileSync(rowsPath), digest = createHash('sha256').update(text).digest('hex');
  const expected = recorded(experiment, name);
  if (digest !== expected) throw new Error(`${rowsPath}: sha256 ${digest} is not the ${expected} recorded for ${experiment} ${name}`);
  const rows = JSON.parse(text), summary = summarize(rows);
  if (experiment === 'P-70-oracle-injected') return { summary, verdicts: verdicts(summary) };
  const need = needClustered(rows);
  return { summary, byNeed: need, verdicts: p71Verdicts(summary, need) };
}

const changes = (before, after, path = '') => {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return JSON.stringify(before) === JSON.stringify(after) ? [] : [`${path}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changes(before[key], after[key], path ? `${path}.${key}` : key));
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const pairs = process.argv.slice(2);
  if (!pairs.length || pairs.length % 2) {
    console.error('usage: reanalyze.mjs <rows.json> <receipt> [<rows.json> <receipt> ...]');
    console.error(`receipts: ${Object.keys(targets).join(', ')}`);
    process.exit(2);
  }
  for (let i = 0; i < pairs.length; i += 2) {
    const [rowsPath, receipt] = [pairs[i], pairs[i + 1]], output = join(experiments, receipt, 'analysis.json');
    const result = regenerate(rowsPath, receipt), before = JSON.parse(readFileSync(output, 'utf8'));
    writeFileSync(output, JSON.stringify(result, null, 1));
    console.log(`${receipt}:`);
    for (const line of changes(before, result)) console.log(`  ${line}`);
  }
}
