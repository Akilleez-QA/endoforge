// Markdown per-arm table from analyze.mjs output: node table.mjs <analysis.json>
import { readFileSync } from 'node:fs';
const { table, decision } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const f = (value, digits = 1) => value === null || value === undefined ? '–' : Number(value).toFixed(digits);
const pct = value => value === null || value === undefined ? '–' : `${Math.round(value * 100)}%`;
console.log('| Arm | Accepted | First pass | Failed candidates (per accepted) | Repair rounds | Escapes / H promoted | s per accepted | Wall p50 / p95 s | Model p50 s | Non-model p50 / p95 s | Turns p50 | Output tokens p50 | List-equivalent $ | Loaded runs | Gates (Q/E/F) |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const row of table) {
  const gates = ['quality', 'escapes', 'failedCandidates'].map(gate => row.gates[gate] ? 'pass' : '**fail**').join(' / ');
  console.log(`| \`${row.arm}\` | ${row.accepted}/${row.runs} (${pct(row.acceptedRate)}) | ${pct(row.firstPassAccepted)} | ${row.failedCandidates} (${f(row.failedPerAccepted, 2)}) | ${f(row.repairRoundsMean, 2)} | ${row.escapes}/${row.hPromoted} | ${f(row.secondsPerAccepted)} | ${f(row.wallP50)} / ${f(row.wallP95)} | ${f(row.modelP50)} | ${f(row.nonModelP50, 2)} / ${f(row.nonModelP95, 2)} | ${row.turnsP50} | ${row.outputTokensP50} | ${f(row.listCostUsd, 2)} | ${row.loadedRuns} | ${gates} |`);
}
console.log(`\nQualifying, fastest first: ${decision.qualifying.map(arm => `\`${arm}\``).join(', ') || 'none'}. Recommended: ${decision.recommended ? `\`${decision.recommended}\`` : 'none'}.`);
