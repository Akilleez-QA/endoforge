export const strategies = ['bo1', 'bo2', 'bo4', 'bo8', 'opus-high', 'sonnet-medium'];
export const fixedArms = strategies;
export const namedArms = ['bo2', 'bo4', 'bo8', 'opus-high', 'sonnet-medium'];

export function sampleOf(row) {
  let previous = 0;
  const replies = row.replies.filter(reply => !reply.failed).map(reply => {
    const cost = Number.isFinite(reply.costUsd) ? Math.max(0, reply.costUsd - previous) : 0;
    if (Number.isFinite(reply.costUsd)) previous = Math.max(previous, reply.costUsd);
    return { begin: reply.beginMs, end: reply.endMs, cost, tokens: reply.usage ?? 0 };
  });
  const failedReplies = row.replies.filter(reply => reply.failed).map(reply => ({ begin: reply.beginMs, end: reply.endMs, cost: 0, tokens: 0 }));
  const roundTimes = row.rounds.map((round, index) => ({ failed: round.failed, at: replies[replies.length - row.rounds.length + index]?.end ?? row.wallMs }));
  return { arm: row.arm, sample: row.sample, promoted: row.promoted, wall: row.wallMs, replies: [...replies, ...failedReplies], rounds: roundTimes, accepted: row.promoted && (row.heldOut === null || row.heldOut.clean === true), escaped: row.promoted && row.heldOut !== null && row.heldOut.clean !== true };
}

function spend(sample, cut) {
  let cost = 0, costLower = 0, calls = 0, modelSeconds = 0, tokens = 0;
  for (const reply of sample.replies) {
    if (reply.begin >= cut) continue;
    calls += 1; cost += reply.cost; tokens += reply.tokens;
    modelSeconds += (Math.min(reply.end, cut) - reply.begin) / 1000;
    if (reply.end <= cut) costLower += reply.cost;
  }
  const failed = sample.rounds.filter(round => round.failed && round.at <= cut).length;
  return { cost, costLower, calls, modelSeconds, tokens, failed };
}

export function race(samples) {
  const winners = samples.filter(sample => sample.promoted).sort((a, b) => a.wall - b.wall);
  const winner = winners[0] ?? null, cut = winner ? winner.wall : Infinity;
  const total = { cost: 0, costLower: 0, calls: 0, modelSeconds: 0, tokens: 0, failed: 0 };
  for (const sample of samples) {
    const used = spend(sample, cut);
    for (const key of Object.keys(total)) total[key] += used[key];
    if (!sample.promoted && cut !== Infinity && sample.wall <= cut) total.failedRuns = (total.failedRuns ?? 0) + 1;
  }
  return { pass: winner ? 1 : 0, accepted: winner?.accepted ? 1 : 0, escaped: winner?.escaped ? 1 : 0, time: winner ? winner.wall / 1000 : null, ...total };
}

function* subsets(items, k, start = 0, picked = []) {
  if (picked.length === k) { yield picked; return; }
  for (let i = start; i <= items.length - (k - picked.length); i++) yield* subsets(items, k, i + 1, [...picked, items[i]]);
}

export function evaluateNeed(samples) {
  const low = samples.filter(sample => sample.arm === 'sonnet-low');
  const result = {};
  const summarize = outcomes => {
    const n = outcomes.length, keys = ['pass', 'accepted', 'escaped', 'cost', 'costLower', 'calls', 'modelSeconds', 'tokens', 'failed'];
    const mean = Object.fromEntries(keys.map(key => [key, outcomes.reduce((total, o) => total + o[key], 0) / n]));
    return { ...mean, times: outcomes.filter(o => o.time !== null).map(o => ({ t: o.time, w: 1 / n })), outcomes: n };
  };
  for (const n of [1, 2, 4, 8]) if (low.length >= n) result[`bo${n}`] = summarize([...subsets(low, n)].map(race));
  for (const arm of ['opus-high', 'sonnet-medium']) {
    const own = samples.filter(sample => sample.arm === arm);
    if (own.length) result[arm] = summarize(own.map(sample => race([sample])));
  }
  return result;
}

export function quantile(weighted, q) {
  const sorted = [...weighted].sort((a, b) => a.t - b.t), total = sorted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of sorted) { acc += x.w; if (acc >= q * total - 1e-12) return x.t; }
  return null;
}

export function aggregate(perNeed, needs, strategy) {
  const cells = needs.map(need => perNeed[need]?.[strategy]).filter(Boolean);
  const sum = key => cells.reduce((total, cell) => total + cell[key], 0);
  const passed = sum('pass');
  const times = cells.flatMap(cell => cell.times);
  return { strategy, needs: cells.length, passRate: cells.length ? passed / cells.length : null, acceptedRate: cells.length ? sum('accepted') / cells.length : null, escapes: sum('escaped'),
    costPerPromoted: passed ? sum('cost') / passed : null, costLowerPerPromoted: passed ? sum('costLower') / passed : null, callsPerPromoted: passed ? sum('calls') / passed : null,
    modelSecondsPerPromoted: passed ? sum('modelSeconds') / passed : null, tokensPerPromoted: passed ? sum('tokens') / passed : null, failedPerPromoted: passed ? sum('failed') / passed : null,
    timeP50: quantile(times, 0.5), timeP90: quantile(times, 0.9), meanCostPerNeed: cells.length ? sum('cost') / cells.length : null };
}

export function decide(table, passTolerance = 0.05) {
  const rated = table.filter(row => row.passRate !== null && row.costPerPromoted !== null);
  if (!rated.length) return { winner: null, reason: 'no arm promoted anything' };
  const best = Math.max(...rated.map(row => row.passRate));
  const eligible = rated.filter(row => row.passRate >= best - passTolerance - 1e-12).sort((a, b) => a.costPerPromoted - b.costPerPromoted);
  const cheapest = eligible[0];
  const tied = eligible.filter(row => row.costPerPromoted <= cheapest.costPerPromoted * 1.1 + 1e-12).sort((a, b) => (a.timeP50 ?? Infinity) - (b.timeP50 ?? Infinity));
  return { winner: tied[0].strategy, bestPassRate: best, eligible: eligible.map(row => row.strategy), costTie: tied.map(row => row.strategy) };
}

const choose = (n, k) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; };
export function passAtK(perNeedCounts, m) {
  const curve = [];
  const pBar = perNeedCounts.reduce((s, c) => s + c, 0) / (perNeedCounts.length * m);
  for (let k = 1; k <= m; k++) {
    const observed = perNeedCounts.reduce((s, c) => s + 1 - choose(m - c, k) / choose(m, k), 0) / perNeedCounts.length;
    curve.push({ k, observed, independent: 1 - (1 - pBar) ** k });
  }
  return curve;
}

export function failureIcc(perNeedCounts, m) {
  const g = perNeedCounts.length, fails = perNeedCounts.map(c => m - c), grand = fails.reduce((s, f) => s + f, 0) / (g * m);
  const msb = m * fails.reduce((s, f) => s + (f / m - grand) ** 2, 0) / (g - 1);
  const msw = fails.reduce((s, f) => s + f * (1 - f / m), 0) / (g * (m - 1));
  const denominator = msb + (m - 1) * msw;
  return denominator > 0 ? (msb - msw) / denominator : null;
}

export function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; state = (state ^ (state >>> 13)) >>> 0; return state / 2 ** 32; };
}
