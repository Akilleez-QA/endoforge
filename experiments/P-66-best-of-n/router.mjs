import { strategies, rng } from './strategies.mjs';

export const routerSettings = Object.freeze({ priorWeight: 2, epsilon: 0.1, passSlack: 0.02, seeds: 1000 });
const p56Arm = { bo1: 'sonnet-low', 'opus-high': 'opus-high', 'sonnet-medium': 'sonnet-medium' };

export function features(need, p56Rows) {
  const past = p56Rows.filter(row => row.need === need && !row.arm.startsWith('haiku'));
  const pastFail = past.some(row => !row.promoted || (row.heldOut && row.heldOut.clean !== true));
  return { kind: need.startsWith('H') ? 'H' : 'R', pastFail, group: `${need.startsWith('H') ? 'H' : 'R'}:${pastFail ? 'failed-before' : 'clean-before'}` };
}

function p56Prior(group, groupOf, p56Rows) {
  const rows = p56Rows.filter(row => groupOf(row.need) === group && !row.arm.startsWith('haiku'));
  const cost = row => Math.max(0, ...row.replies.map(reply => reply.costUsd).filter(Number.isFinite));
  const stats = arm => { const own = rows.filter(row => row.arm === arm); return own.length ? { pass: own.filter(row => row.promoted).length / own.length, cost: own.reduce((s, row) => s + cost(row), 0) / own.length } : null; };
  const all = p56Rows.filter(row => !row.arm.startsWith('haiku'));
  const fallback = arm => { const own = all.filter(row => row.arm === arm); return { pass: own.filter(row => row.promoted).length / own.length, cost: own.reduce((s, row) => s + cost(row), 0) / own.length }; };
  const base = Object.fromEntries(Object.entries(p56Arm).map(([strategy, arm]) => [strategy, stats(arm) ?? fallback(arm)]));
  const prior = {};
  for (const s of strategies) {
    const n = s.startsWith('bo') ? Number(s.slice(2)) : null;
    const p = n ? 1 - (1 - base.bo1.pass) ** n : base[s].pass, c = n ? n * base.bo1.cost : base[s].cost;
    prior[s] = { p, c };
  }
  return prior;
}

export function makeState(groups, groupOf, p56Rows, weight = routerSettings.priorWeight) {
  const state = {};
  for (const group of groups) {
    const prior = p56Prior(group, groupOf, p56Rows);
    state[group] = Object.fromEntries(strategies.map(s => [s, { a: weight * prior[s].p, b: weight * (1 - prior[s].p), costSum: weight * prior[s].c, costN: weight }]));
  }
  return state;
}

export function update(cell, outcome) {
  cell.a += outcome.pass; cell.b += 1 - outcome.pass; cell.costSum += outcome.cost; cell.costN += 1;
}

export function pick(groupState, slack = routerSettings.passSlack) {
  const est = strategies.map(s => { const c = groupState[s]; const p = c.a / (c.a + c.b); return { s, p, cost: c.costSum / c.costN }; });
  const best = Math.max(...est.map(e => e.p));
  const feasible = est.filter(e => e.p >= best - slack).sort((x, y) => x.cost / Math.max(x.p, 1e-9) - y.cost / Math.max(y.p, 1e-9));
  return { choice: feasible[0].s, estimates: est };
}

export function fitRouter({ fitNeeds, perNeed, groupOf, p56Rows }) {
  const groups = [...new Set(Object.keys(perNeed).map(groupOf))];
  const state = makeState(groups, groupOf, p56Rows);
  for (const need of fitNeeds) for (const s of strategies) if (perNeed[need][s]) update(state[groupOf(need)][s], perNeed[need][s]);
  return state;
}

export function runHeldOut({ state, heldNeeds, perNeed, groupOf, epsilon, seed }) {
  const local = structuredClone(state), random = rng(seed ?? 0);
  const order = seed === null ? [...heldNeeds] : heldNeeds.map(n => [random(), n]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const decisions = [];
  for (const need of order) {
    const group = groupOf(need);
    const { choice, estimates } = pick(local[group]);
    let chosen = choice, explored = false;
    if (epsilon > 0 && random() < epsilon) { const others = strategies.filter(s => s !== choice && perNeed[need][s]); chosen = others[Math.floor(random() * others.length)]; explored = true; }
    const outcome = perNeed[need][chosen];
    decisions.push({ need, group, greedy: choice, chosen, explored, estimates: estimates.map(e => ({ s: e.s, p: +e.p.toFixed(3), cost: +e.cost.toFixed(4) })) });
    update(local[group][chosen], outcome);
  }
  return decisions;
}

export function oracle(perNeed, needs) {
  return needs.map(need => {
    const cells = strategies.filter(s => perNeed[need][s]).map(s => ({ s, ...perNeed[need][s] }));
    const best = Math.max(...cells.map(c => c.pass));
    const pick = cells.filter(c => c.pass >= best - 1e-12).sort((a, b) => a.cost - b.cost)[0];
    return { need, chosen: pick.s };
  });
}

export function score(perNeed, decisions) {
  const cells = decisions.map(d => perNeed[d.need][d.chosen]);
  const sum = key => cells.reduce((s, c) => s + c[key], 0);
  const passed = sum('pass');
  return { needs: cells.length, passRate: cells.length ? passed / cells.length : null, costPerPromoted: passed ? sum('cost') / passed : null, callsPerPromoted: passed ? sum('calls') / passed : null,
    failedPerPromoted: passed ? sum('failed') / passed : null, times: cells.flatMap(c => c.times) };
}
