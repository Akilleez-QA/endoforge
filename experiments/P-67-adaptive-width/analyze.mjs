import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || new URL('./receipt/measured/', import.meta.url).pathname;
const node = process.argv[3] || '26.13.0';
const read = name => { const file = join(dir, `${name}-${node}.json`); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; };
const rounds = prefix => [1, 2].map(round => read(`${prefix}round${round}`)).filter(Boolean);
const worse = (sets, arm) => {
  const rows = sets.map(set => set.rows.find(row => row.arm === arm)).filter(Boolean);
  if (!rows.length) return null;
  const pick = rows.reduce((low, row) => row.perSecond < low.perSecond ? row : low);
  return { arm, rounds: rows.length, perSecond: pick.perSecond, all: rows.map(row => row.perSecond), cpuMsPerAccepted: Math.max(...rows.map(row => row.cpuMsPerAccepted)),
    ipc: pick.ipc, nearCachePerAttempt: pick.perAttempt?.['ls_any_fills_from_sys.near_cache'] ?? null, dramPerAttempt: pick.perAttempt?.['ls_any_fills_from_sys.dram_io_all'] ?? null,
    busyCpus: pick.busyCpus, sliceCpus: pick.slice?.cpus ?? null, throttledMs: pick.slice?.throttledMs ?? null, loadedRows: rows.filter(row => row.loaded).length, loads: rows.map(row => [row.loadStart, row.loadEnd]),
    verdictDigests: [...new Set(rows.map(row => row.verdictDigest))], finalWidth: pick.widths.at(-1)?.[1] ?? null };
};
const arms = rounds('arms-');
const table = ['1x16', '2x8', '4x4', '4x4-pinned', '2x8-pinned', 'planner'].map(arm => worse(arms, arm)).filter(Boolean);
const by = Object.fromEntries(table.map(row => [row.arm, row]));
const fixedArms = table.filter(row => row.arm !== 'planner');
const bestFixed = fixedArms.reduce((best, row) => row.perSecond > best.perSecond ? row : best, fixedArms[0]);
const planner = by.planner, base = by['1x16'];
const stability = arms.map(set => {
  const row = set.rows.find(item => item.arm === 'planner');
  if (!row?.tunerLog?.length) return null;
  const start = row.tunerLog[0].at;
  const settledEntry = row.tunerLog.find(entry => entry.phase === 'settled');
  const firstSettle = settledEntry ? { at: settledEntry.at } : null;
  const after = firstSettle ? row.tunerHistory.filter(change => change.at > firstSettle.at) : [];
  const spanMin = firstSettle ? Math.max(1 / 60, (start + row.wallMs - firstSettle.at) / 60000) : null;
  return { label: set.label, settleSeconds: firstSettle ? +((firstSettle.at - start) / 1000).toFixed(1) : null, changesAfterSettle: after.length, perMinuteAfterSettle: spanMin ? +(after.length / spanMin).toFixed(2) : null, peers: Math.max(...(row.tunerLog || []).map(entry => entry.peers ?? 0)) };
}).filter(Boolean);
const sweep = prefix => {
  const sets = rounds(prefix);
  if (!sets.length) return null;
  const names = [...new Set(sets.flatMap(set => set.rows.map(row => row.arm)))];
  const rows = names.map(name => worse(sets, name));
  const fixed = rows.filter(row => row.arm !== 'planner');
  const best = fixed.reduce((top, row) => row.perSecond > top.perSecond ? row : top, fixed[0]);
  const plannerRow = rows.find(row => row.arm === 'planner');
  return { prefix, rows: rows.map(row => ({ arm: row.arm, perSecond: row.perSecond, all: row.all, cpuMsPerAccepted: row.cpuMsPerAccepted, loadedRows: row.loadedRows, rounds: row.rounds })), best: best?.arm, bestPerSecond: best?.perSecond,
    planner: plannerRow?.perSecond ?? null, plannerWidth: plannerRow?.finalWidth ?? null, ratio: plannerRow && best ? +(plannerRow.perSecond / best.perSecond).toFixed(3) : null, met: plannerRow && best ? plannerRow.perSecond >= 0.9 * best.perSecond : null,
    allRowsLoaded: rows.every(row => row.loadedRows === row.rounds) };
};
const portability = ['sweep-cpus4-', 'sweep-cpus8-', 'sweep-all-'].map(sweep).filter(Boolean);
const digests = new Set(table.flatMap(row => row.verdictDigests).concat(portability.length ? [] : []));
const sweepDigests = new Set(['sweep-cpus4-', 'sweep-cpus8-', 'sweep-all-'].flatMap(prefix => rounds(prefix).flatMap(set => set.rows.map(row => row.verdictDigest))));
const bars = planner && base ? {
  bar1: { planner: planner.perSecond, bestFixed: `${bestFixed.arm} ${bestFixed.perSecond}`, needAtLeast: +Math.max(0.95 * bestFixed.perSecond, 1.1 * base.perSecond).toFixed(1), met: planner.perSecond >= 0.95 * bestFixed.perSecond && planner.perSecond >= 1.1 * base.perSecond },
  bar2: { planner: planner.cpuMsPerAccepted, base: base.cpuMsPerAccepted, met: planner.cpuMsPerAccepted <= base.cpuMsPerAccepted },
  bar3: { rounds: stability, met: stability.length > 0 && stability.every(round => round.settleSeconds !== null && round.settleSeconds <= 30 && round.perMinuteAfterSettle <= 1) },
  bar4: { sweeps: portability.map(item => ({ prefix: item.prefix, ratio: item.ratio, met: item.met })), met: portability.length === 3 && portability.every(item => item.met) },
  bar5: { armDigests: [...digests], sweepDigests: [...sweepDigests], met: digests.size === 1 && sweepDigests.size <= 1 && (!sweepDigests.size || [...sweepDigests][0] === [...digests][0]) },
  decision: planner.perSecond >= base.perSecond && planner.cpuMsPerAccepted <= base.cpuMsPerAccepted ? 'tuned stays default' : `fallback default: best fixed arm ${bestFixed.arm}`,
  allArmRowsLoaded: table.every(row => row.loadedRows === row.rounds),
} : null;
const out = { node, arms: table, bestFixed: bestFixed?.arm, prediction: by['4x4-pinned'] && base ? { gain4x4PinnedOver1x16: +(by['4x4-pinned'].perSecond / base.perSecond - 1).toFixed(3) } : null, portability, bars };
writeFileSync(new URL('./receipt/analysis.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
