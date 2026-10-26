// Fix lists (`endoforge/hillclimb-fixlist/1`): the critic's numbered problems, each owned by one fix lane.
export const SCHEMA = 'endoforge/hillclimb-fixlist/1';
export const SEVERITIES = ['blocker', 'major', 'minor'];

/** Check a fix list against the campaign: owners exist, ids are 1..n and unique, carried items name a previous id. */
export function validateFixlist(fl, { owners, count, previous } = {}) {
  const errors = [];
  const E = (m) => errors.push(m);
  if (fl?.schema !== SCHEMA) E(`schema must be ${SCHEMA}`);
  const items = Array.isArray(fl?.items) ? fl.items : (E('items must be a list'), []);
  if (count && items.length > count) E(`at most ${count} items (got ${items.length})`);
  const prevIds = new Set((previous?.items ?? []).map((i) => i.id));
  const seen = new Set();
  items.forEach((it, k) => {
    const where = `item ${it?.id ?? k + 1}`;
    if (!Number.isInteger(it?.id) || it.id < 1) E(`${where}: id must be a positive integer`);
    else if (seen.has(it.id)) E(`${where}: duplicate id`); else seen.add(it.id);
    if (!it?.still) E(`${where}: still (which image) is required`);
    if (!it?.problem || it.problem.length < 12) E(`${where}: problem must say what is wrong (at least 12 characters)`);
    if (owners && !Object.prototype.hasOwnProperty.call(owners, it?.owner)) E(`${where}: owner ${it?.owner} is not a campaign owner`);
    if (!SEVERITIES.includes(it?.severity)) E(`${where}: severity must be ${SEVERITIES.join(' | ')}`);
    if (it?.carried_from != null && previous && !prevIds.has(it.carried_from)) E(`${where}: carried_from ${it.carried_from} is not an id in the previous list`);
  });
  for (const r of fl?.resolved_from_previous ?? []) if (previous && !prevIds.has(r)) E(`resolved_from_previous names unknown previous id ${r}`);
  return { ok: !errors.length, errors };
}

export const byOwner = (fl) => {
  const m = {};
  for (const it of fl.items) (m[it.owner] ??= []).push(it);
  return m;
};

/** The human view: one table, then counts. */
export function toMarkdown(fl, campaign) {
  const owners = campaign.owners;
  const rows = fl.items.map((i) => `| ${i.id} | ${i.still} | ${String(i.problem).replace(/\|/g, '/')} | ${i.owner} | ${i.severity}${i.needs_reference ? ' · ref' : ''}${i.carried_from ? ` · was ${i.carried_from}` : ''} |`);
  const counts = Object.entries(byOwner(fl)).map(([o, v]) => `- **${o}** (${owners[o]?.describe ?? '?'}): ${v.length}`);
  return [`# ${campaign.id}: fix list round ${fl.round}`, '', fl.summary ?? '', '', '| # | Still | Problem | Owner | Severity |', '|---|---|---|---|---|', ...rows, '', '**By owner:**', ...counts,
    '', `**Resolved from the previous round:** ${(fl.resolved_from_previous ?? []).length}`, ''].join('\n');
}
