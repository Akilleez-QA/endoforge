import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || new URL('./receipt/measured/', import.meta.url).pathname;
const node = process.argv[3] || '26.13.0';
const read = (block, round) => { const file = join(dir, block, `${block === 'pool' ? 'pool' : block.startsWith('cpus') || block === 'full' ? 'sweep' : block}-round${round}-${node}.json`); return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null; };
const rounds = block => [1, 2].map(round => read(block, round)).filter(Boolean);
const counted = row => row.quiet || row.peer > 0 && row.arm !== 'tuned-peer';
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const sd = values => { const m = mean(values); return Math.sqrt(mean(values.map(v => (v - m) ** 2))); };
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const worse = (sets, arm) => {
  const rows = sets.map(set => set.rows.find(row => row.arm === arm)).filter(Boolean);
  if (!rows.length) return null;
  const pick = rows.reduce((low, row) => row.perSecond < low.perSecond ? row : low);
  return { arm, rounds: rows.length, perSecond: pick.perSecond, all: rows.map(row => row.perSecond), cpuMsPerAccepted: Math.max(...rows.map(row => row.cpuMsPerAccepted)), allCpu: rows.map(row => row.cpuMsPerAccepted),
    ownCgroupMsPerAccepted: Math.max(...rows.map(row => row.ownCgroupMsPerAccepted)), busyCpus: rows.map(row => row.busyCpus), sliceCpus: rows.map(row => row.slice?.cpus ?? null), throttledMs: rows.map(row => row.slice?.throttledMs ?? null),
    quiet: rows.map(row => row.quiet), loads: rows.map(row => [row.loadStart, row.loadAtStop, row.loadEnd]), psi: rows.map(row => [row.psiStart, row.psiAtStop, row.psiEnd]),
    verdictDigests: [...new Set(rows.map(row => row.verdictDigest))], finalWidths: rows.map(row => row.widths.at(-1)?.[1] ?? null), finalCohortWidths: rows.map(row => row.tunerLog?.at(-1)?.next ?? null) };
};
const stability = row => {
  const timedEnd = row.timedStartAt === undefined ? Infinity : row.timedStartAt + row.wallMs;
  const log = row.tunerLog?.filter(entry => entry.at + 1000 <= timedEnd);
  if (!log?.length) return null;
  const start = log[0].at, end = Math.min(timedEnd, log.at(-1).at + 1000);
  const settled = log.find(entry => entry.phase === 'settled');
  const settleAt = settled ? settled.at : null;
  const after = settleAt === null ? [] : row.tunerHistory.filter(change => change.at > settleAt && change.at <= end);
  const minutes = settleAt === null ? null : Math.max(1 / 60, (end - settleAt) / 60000);
  const bounds = log.filter((entry, index) => index && entry.bound !== log[index - 1].bound && (settleAt === null || entry.at > settleAt)).length;
  const raws = log.map(entry => entry.uRaw).filter(value => typeof value === 'number');
  return { arm: row.arm, settleSeconds: settleAt === null ? null : +((settleAt - start) / 1000).toFixed(1), changesAfterSettle: after.length, perMinuteAfterSettle: minutes ? +(after.length / minutes).toFixed(2) : null,
    boundChangesAfterSettle: bounds, boundPerMinute: minutes ? +(bounds / minutes).toFixed(2) : null, totalChanges: row.tunerHistory.length,
    u: raws.length ? { mean: +mean(raws).toFixed(3), sd: +sd(raws).toFixed(3), cv: +(sd(raws) / mean(raws)).toFixed(3), final: log.at(-1).u } : null, finalCap: log.at(-1).cap ?? null, finalWidth: log.at(-1).next, quiet: row.quiet };
};
const arms = rounds('arms');
const armTable = ['2x8-pinned', '1x16', 'tuned', 'tuned-p67'].map(arm => worse(arms, arm)).filter(Boolean);
const by = Object.fromEntries(armTable.map(row => [row.arm, row]));
const armRowsCounted = arms.flatMap(set => set.rows).every(counted);
const tunedStability = arms.map(set => set.rows.find(row => row.arm === 'tuned')).filter(Boolean).map(stability);
const p67Stability = arms.map(set => set.rows.find(row => row.arm === 'tuned-p67')).filter(Boolean).map(stability);
const sweep = block => {
  const sets = rounds(block);
  if (!sets.length) return null;
  const names = [...new Set(sets.flatMap(set => set.rows.map(row => row.arm)))];
  const rows = names.map(name => worse(sets, name));
  const fixed = rows.filter(row => row.arm !== 'tuned');
  const best = fixed.reduce((top, row) => row.perSecond > top.perSecond ? row : top, fixed[0]);
  const tuned = rows.find(row => row.arm === 'tuned');
  const tunedRows = sets.map(set => set.rows.find(row => row.arm === 'tuned')).filter(Boolean);
  return { block, calibration: sets.map(set => set.calibration), allotment: sets[0].probe.allotment, cpus: sets[0].affinity, plan: sets[0].plan.cohorts.map(cohort => cohort.width), tunedPlan: sets[0].tunedPlan.cohorts.map(cohort => [cohort.width, cohort.max]),
    rows: rows.map(row => ({ arm: row.arm, perSecond: row.perSecond, all: row.all, cpuMsPerAccepted: row.cpuMsPerAccepted, busyCpus: row.busyCpus, quiet: row.quiet, loads: row.loads, psi: row.psi, finalWidths: row.finalWidths })),
    best: best?.arm, bestPerSecond: best?.perSecond, tuned: tuned?.perSecond ?? null, tunedWidths: tuned?.finalWidths ?? null, ratio: tuned && best ? +(tuned.perSecond / best.perSecond).toFixed(3) : null,
    met: tuned && best ? tuned.perSecond >= 0.9 * best.perSecond : null, allCounted: sets.flatMap(set => set.rows).every(counted), stability: tunedRows.map(stability) };
};
const portability = ['cpus4', 'cpus8', 'cpus16', 'full'].map(sweep).filter(Boolean);
const fair = rounds('fair').map(set => {
  const allotment = set.probe.allotment, half = allotment / 2;
  const alone = set.rows.find(row => row.arm === 'tuned-alone'), peer = set.rows.find(row => row.arm === 'tuned-peer');
  const out = { label: set.label, allotment };
  if (alone?.tunerLog?.length) {
    const log = alone.tunerLog.filter(entry => entry.at + 1000 <= alone.timedStartAt + alone.wallMs), last = log.at(-1), cohorts = alone.capacity.cohorts.length;
    const loneShare = log.filter(entry => entry.mode === 'lone' && entry.share === allotment).length / log.length;
    const needed = last.u ? Math.ceil(last.share / cohorts / last.u) : null;
    out.alone = { windows: log.length, loneWholeFraction: +loneShare.toFixed(3), finalCap: last.cap, capNeeded: needed, ownCpus: alone.ownCgroupCpus, perSecond: alone.perSecond, quiet: alone.quiet, met: loneShare >= 0.9 && needed !== null && last.cap >= needed };
  }
  if (peer?.tunerLog?.length) {
    const from = peer.peerStartedAt + 10000;
    const log = peer.tunerLog.filter(entry => entry.at >= from && entry.at + 1000 <= peer.timedStartAt + peer.wallMs);
    const inBand = log.filter(entry => entry.mode === 'shared' && entry.share >= 0.9 * half && entry.share <= 1.1 * half).length / Math.max(1, log.length);
    const decision = log.length ? median(log.map(entry => entry.share)) : null;
    out.peer = { windows: log.length, sharedInBandFraction: +inBand.toFixed(3), medianShare: decision, ownCpus: peer.ownCgroupCpus, peerCpus: peer.peerCpus, perSecond: peer.perSecond, finalWidth: peer.tunerLog.at(-1).next,
      cpuWithinShare: decision !== null && peer.ownCgroupCpus <= 1.15 * decision, met: inBand >= 0.8 && decision !== null && peer.ownCgroupCpus <= 1.15 * decision, loads: [peer.loadStart, peer.loadAtStop, peer.loadEnd], psi: [peer.psiStart, peer.psiAtStop, peer.psiEnd] };
  }
  return out;
});
const pools = rounds('pool');
const poolTable = ['plan', 'old'].map(arm => {
  const rows = pools.map(set => set.rows.find(row => row.arm === arm)).filter(Boolean);
  if (!rows.length) return null;
  return { arm, size: rows[0].size, perSecond: Math.min(...rows.map(row => row.perSecond)), all: rows.map(row => row.perSecond), cpuMsPerJob: Math.max(...rows.map(row => row.cpuMsPerJob)), peakCgroupMb: rows.map(row => row.peakCgroupMb), quiet: rows.map(row => row.quiet), failed: rows.map(row => row.failed) };
}).filter(Boolean);
const poolBy = Object.fromEntries(poolTable.map(row => [row.arm, row]));
const digests = new Set([...arms, ...rounds('fair'), ...['cpus4', 'cpus8', 'cpus16', 'full'].flatMap(rounds)].flatMap(set => set.rows.map(row => row.verdictDigest)));
const bars = by.tuned && by['2x8-pinned'] ? {
  bar1: { tuned: by.tuned.perSecond, base: by['2x8-pinned'].perSecond, needAtLeast: +(0.95 * by['2x8-pinned'].perSecond).toFixed(1), tunedCpu: by.tuned.cpuMsPerAccepted, baseCpu: by['2x8-pinned'].cpuMsPerAccepted, cpuAtMost: +(1.05 * by['2x8-pinned'].cpuMsPerAccepted).toFixed(3),
    met: by.tuned.perSecond >= 0.95 * by['2x8-pinned'].perSecond && by.tuned.cpuMsPerAccepted <= 1.05 * by['2x8-pinned'].cpuMsPerAccepted, rowsCounted: armRowsCounted },
  bar2: { rounds: tunedStability, met: tunedStability.length === 2 && tunedStability.every(round => round.settleSeconds !== null && round.settleSeconds <= 30 && round.perMinuteAfterSettle <= 1) },
  bar3: { sweeps: portability.map(item => ({ block: item.block, ratio: item.ratio, best: item.best, met: item.met })), met: portability.length === 4 && portability.every(item => item.met) },
  bar4: { digests: [...digests], met: digests.size === 1 },
  bar5: { rounds: fair, met: fair.length === 2 && fair.every(round => round.alone?.met && round.peer?.met) },
} : null;
if (bars) bars.decision = bars.bar1.met && bars.bar2.met && bars.bar3.met && bars.bar4.met ? 'tuned becomes the default' : 'default stays fixed';
const quietTuned = [...tunedStability, ...portability.flatMap(item => item.stability)].filter(item => item?.quiet);
const rival = { rows: quietTuned.length, maxCv: quietTuned.length ? Math.max(...quietTuned.map(item => item.u?.cv ?? 0)) : null, maxBoundPerMinute: quietTuned.length ? Math.max(...quietTuned.map(item => item.boundPerMinute ?? 0)) : null };
rival.holds = rival.rows ? rival.maxCv > 0.15 || rival.maxBoundPerMinute > 1 : null;
const poolDecision = poolBy.plan && poolBy.old ? (poolBy.old.perSecond > 1.05 * poolBy.plan.perSecond && poolBy.old.cpuMsPerJob <= 1.05 * poolBy.plan.cpuMsPerJob ? 'revert IsolatePool to availableParallelism' : 'IsolatePool keeps defaultWidth()') : null;
const out = { node, arms: armTable, stability: { tuned: tunedStability, tunedP67: p67Stability }, portability, fair, pool: { rows: poolTable, decision: poolDecision }, rival, bars };
writeFileSync(new URL('./receipt/analysis.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
