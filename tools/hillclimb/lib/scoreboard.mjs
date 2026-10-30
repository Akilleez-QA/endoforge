// Scoreboard: one row per round, and the stop rule.
import { byOwner } from './fixlist.mjs';

/** Score one round's fix list against the previous one. */
export function scoreRound(fl, previous) {
  const items = fl.items;
  const sev = (s) => items.filter((i) => i.severity === s).length;
  const carried = items.filter((i) => i.carried_from != null).length;
  return {
    round: fl.round,
    open: items.length,
    blockers: sev('blocker'), major: sev('major'), minor: sev('minor'),
    weighted: 5 * sev('blocker') + 2 * sev('major') + sev('minor'),
    new: items.length - carried, carried,
    resolved: (fl.resolved_from_previous ?? []).length,
    previous_open: previous ? previous.items.length : null,
    by_owner: Object.fromEntries(Object.entries(byOwner(fl)).map(([k, v]) => [k, v.length])),
  };
}

/**
 * Stop when the target is met, the round limit is reached, or the weighted score has not improved for `patience`
 * rounds (a plateau means the critic and the fixers are no longer moving the work).
 */
export function decide(history, stop) {
  const last = history.at(-1);
  if (!last) return { stop: false, why: 'no rounds yet' };
  if (stop.targetOpen != null && last.open <= stop.targetOpen && last.blockers === 0) return { stop: true, why: `target met: ${last.open} open, no blockers` };
  if (history.length >= stop.maxRounds) return { stop: true, why: `round limit ${stop.maxRounds} reached` };
  const p = stop.patience ?? 2;
  if (history.length > p) {
    const best = Math.min(...history.slice(0, -p).map((h) => h.weighted));
    if (history.slice(-p).every((h) => h.weighted >= best)) return { stop: true, why: `no improvement in weighted score for ${p} rounds (best ${best})` };
  }
  return { stop: false, why: `continue: ${last.open} open, weighted ${last.weighted}` };
}
