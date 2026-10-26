// The job card: what the coordinator shows the user before any spend, and what the user confirms once (Pontificate's
// exit, checked at Decide; I1). Compact markdown: the verbatim goal, the decompressed brief, what governs what (with
// reference thumbnails), the atoms and their inputs, the checks, the gates, which invariants hold, and the open
// lessons from earlier jobs of the same kind. The confirmation names the card's hash, so any later change to what
// was confirmed voids it (FMEA "intent distorted", detection).
import crypto from 'node:crypto';
import { INVARIANTS, GATES } from './invariants.mjs';

const CONFIRMED_FIELDS = ['title', 'kind', 'goal', 'brief', 'sources', 'references', 'truth', 'criteria', 'atoms', 'contracts', 'seams', 'gates', 'criticalPath', 'rival', 'deadline'];
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
/** sha256 of what the user confirms (not proofs, receipts or approvals, which arrive later). */
export function cardHash(job) {
  const gates = (job.gates ?? []).map(({ approval, ...g }) => g);
  const body = Object.fromEntries(CONFIRMED_FIELDS.map((k) => [k, k === 'gates' ? gates : job[k] ?? null]));
  return crypto.createHash('sha256').update(JSON.stringify(canon(body))).digest('hex');
}
/** The confirmation check the validator uses: present, direct, and for this exact card. */
export function confirmationOf(job) {
  const c = job.proofs?.confirmed ?? job.confirmed;
  if (!c) return null;
  if (c.via !== 'direct') return { ok: false, why: `the card was confirmed via ${c.via ?? 'an unknown route'}; only the user's own words count` };
  if (!c.cardSha256) return { ok: false, why: 'the confirmation does not name the card it confirmed (cardSha256)' };
  if (c.cardSha256 !== cardHash(job)) return { ok: false, why: 'the job changed after the user confirmed its card; show the new card and confirm again' };
  return { ok: true };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const list = (xs) => (xs ?? []).join(', ') || '-';
const MARK = { holds: 'holds', partial: 'partial', pending: 'pending', broken: 'BROKEN', 'not checked': '-' };

export function renderCard(job, v, lessons = []) {
  const b = job.brief ?? {}, inputs = [...(job.sources ?? []).map((s) => ({ ...s, kind: s.primary ? 'primary source' : 'source' })), ...(job.references ?? []).map((r) => ({ ...r, kind: 'reference' }))];
  const L = [];
  L.push(`# Job card: ${job.title ?? job.id} (${job.kind})`, '');
  L.push(`> ${esc(job.goal?.verbatim)}`, `> — ${job.goal?.by ?? '?'}${job.goal?.at ? `, ${job.goal.at}` : ''}`, '');
  L.push('| Brief | |', '|---|---|', ...['objective', 'acceptance', 'scope', 'authority'].map((k) => `| ${k} | ${esc(b[k])} |`),
    `| stated | ${esc(list(b.assumptions?.stated))} |`, `| inferred (check these) | ${esc(list(b.assumptions?.inferred))} |`, '');
  L.push('## What governs what', '| input | kind | governs | path |', '|---|---|---|---|', ...inputs.map((r) => `| ${r.id} | ${r.kind} | ${list(r.governs)} | \`${r.path}\` |`), '');
  for (const r of job.references ?? []) for (const t of (r.thumbnails ?? []).slice(0, 3)) L.push(`![${r.id}](${t})`);
  if ((job.references ?? []).some((r) => r.thumbnails?.length)) L.push('');
  if ((job.truth ?? []).length) L.push('## Truth package', ...job.truth.map((t) => `- ${t.id}: ${esc(t.what)}, tolerance ${esc(t.tolerance)} (\`${t.path}\`)`), '');
  L.push('## Atoms', '| atom | engine | works on | inputs | files | checks |', '|---|---|---|---|---|---|',
    ...(job.atoms ?? []).map((a) => `| ${a.id}${a.id === job.criticalPath ? ' (critical path)' : ''}${(a.speculate ?? 1) > 1 ? ` x${a.speculate}` : ''} | ${a.engine ?? '-'} | ${list(a.aspects)} | ${list([...(a.sources ?? []), ...(a.references ?? [])])} | ${list(a.files)} | ${list(a.checks)} |`), '');
  if ((job.seams ?? []).length || (job.contracts ?? []).length) L.push(`Seams: ${(job.seams ?? []).map((s) => `${s.id} (${list(s.between)}) → ${s.owner}`).join('; ') || '-'}. Contracts: ${(job.contracts ?? []).map((k) => `${k.path} → ${k.owner}`).join('; ') || '-'}.`, '');
  L.push('## Acceptance', '| criterion | check | proxy | calibrated |', '|---|---|---|---|',
    ...(job.criteria ?? []).map((c) => { const cal = job.proofs?.calibration?.[c.id]; return `| ${c.id}: ${esc(c.statement)} | ${c.check?.kind ?? 'NONE'}${c.check?.reference ? ` vs ${c.check.reference}` : ''} | ${c.check?.proxy == null ? '-' : c.check.proxy ? 'yes' : 'no'} | ${cal ? (cal.good === 0 && cal.bad > 0 ? 'yes' : 'NO') : '-'} |`; }), '');
  L.push(`Human gates: ${(job.gates ?? []).map((g) => `${g.id} ${esc(g.what)} (${g.who}${g.criticalPath ? ', ON the critical path' : ''})`).join('; ') || 'none'}. Rival: ${esc(job.rival ?? '-')}. Deadline: ${job.deadline ?? '-'}.`, '');
  L.push('## Invariants', INVARIANTS.map((i) => `${i.id} ${MARK[v.status[i.id]] ?? v.status[i.id]}`).join(' · '), '',
    `POODO gates: ${GATES.map((g) => `${g.name} ${v.gates[g.id]}`).join(' → ')}`, '');
  if (v.errors.length) L.push('Refused:', ...v.errors.map((e) => `- ${e.gate} ${e.inv}: ${e.msg}`), '');
  if (lessons.length) L.push(`## Open lessons from earlier ${job.kind} jobs`, ...lessons.slice(0, 15).map((l) => `- [${l.from}] ${esc(l.text)}${l.fix ? ` → ${esc(l.fix)}` : ''}`), '');
  L.push(`Confirm this card (sha256 \`${cardHash(job).slice(0, 12)}\`) or correct it. Nothing launches before your confirmation.`);
  return L.join('\n') + '\n';
}
