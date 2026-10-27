// Prompt compiler: JOB manifest → one prompt per atom. Atom prompts are never hand-written: a brief written from a
// summary loses the source and the references (see docs/PLAYBOOK-deadline-fanout.md). Each prompt carries, in this order:
// the goal verbatim; the decompressed brief; the inputs that govern this atom, references first, with paths, what
// they govern and thumbnails to look at; primary-source excerpts read from disk; the truth package; its checks; its
// files, contracts and seams; this round's findings and outputs; knowledge and lessons that bear on it; the return format.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { lessonsForAtom } from './lessons.mjs';
import { interfacesFor, interfaceText } from './sources.mjs';

const MAX_EXCERPT = 6000;
const bullets = (xs) => xs.map((x) => `- ${x}`).join('\n');

/** A source's excerpt: `excerpt.lines` "a-b", or `excerpt.match` (a regex, with `context` lines), else the whole
 *  file when it is short. Read from disk at compile time, so the atom gets the source itself, not a summary. */
export function excerpt(src, { offline = false } = {}) {
  if (offline) return null;
  let text; try { text = fs.readFileSync(src.path, 'utf8'); } catch { return null; }
  const lines = text.split('\n'), e = src.excerpt ?? {};
  let out = text;
  if (e.lines) { const [a, b] = String(e.lines).split('-').map(Number); out = lines.slice(a - 1, b || a).join('\n'); }
  else if (e.match) {
    const re = new RegExp(e.match, 'i'), n = e.context ?? 3, keep = new Set();
    lines.forEach((l, i) => { if (re.test(l)) for (let k = Math.max(0, i - n); k <= Math.min(lines.length - 1, i + n); k++) keep.add(k); });
    out = [...keep].sort((x, y) => x - y).map((k) => lines[k]).join('\n');
  }
  return out.length > MAX_EXCERPT ? `${out.slice(0, MAX_EXCERPT)}\n[… excerpt cut at ${MAX_EXCERPT} characters; read the file for the rest]` : out;
}

/** Knowledge entries (job.knowledge: [{ id, text, source, tags }]) whose tags name this atom, one of its aspects or
 *  capabilities, or "*". Knowledge is data written during the run (`endoforge job knowledge add`), never tool code. */
export function knowledgeFor(job, a) {
  const tags = new Set(['*', a.id, ...(a.aspects ?? []), ...(a.capabilities ?? [])].map((t) => String(t).toLowerCase()));
  return (job.knowledge ?? []).filter((k) => (k.tags ?? ['*']).some((t) => tags.has(String(t).toLowerCase())));
}

export function compileAtom(job, id, { lessons = [], found = [], outputs = [], round = null, note = '', offline = false } = {}) {
  const a = (job.atoms ?? []).find((x) => x.id === id);
  if (!a) throw new Error(`job ${job.id} has no atom ${id}`);
  const byId = Object.fromEntries([...(job.sources ?? []), ...(job.references ?? [])].map((r) => [r.id, r]));
  const refs = (a.references ?? []).map((r) => byId[r]).filter(Boolean), srcs = (a.sources ?? []).map((r) => byId[r]).filter(Boolean);
  const crit = Object.fromEntries((job.criteria ?? []).map((c) => [c.id, c])), b = job.brief ?? {};
  const seams = (job.seams ?? []).filter((s) => (s.between ?? []).includes(id) || s.owner === id);
  const mine = lessonsForAtom(a, lessons);
  const P = [];
  P.push(`You are atom ${id} of job "${job.title ?? job.id}" (${job.kind}), one of ${(job.atoms ?? []).length} atoms working at once. Each atom owns different files.${round ? ` Round ${round}.` : ''}`);
  P.push(`THE GOAL, in ${job.goal?.by ?? 'the user'}'s own words (this, not any summary, is what you build):\n> ${job.goal?.verbatim}`);
  P.push(`The brief:\n${bullets(['objective', 'acceptance', 'scope', 'authority'].map((k) => `${k}: ${b[k] ?? '-'}`))}\n- stated by the user: ${(b.assumptions?.stated ?? []).join('; ') || '-'}\n- inferred (not confirmed; do not build on these alone): ${(b.assumptions?.inferred ?? []).join('; ') || '-'}`);
  if (refs.length) P.push(`READ AND LOOK AT THESE FIRST. They govern your work; match them:\n${bullets(refs.map((r) => `${r.id} governs ${r.governs.join(', ')}: ${r.what}. Path: ${r.path}${r.thumbnails?.length ? `. Look at: ${r.thumbnails.join(', ')}` : ''}${r.private ? '. Private: view locally, never copy it into git or the output' : ''}`))}`);
  for (const s of srcs) {
    const ex = excerpt(s, { offline });
    P.push(`Source ${s.id}${s.primary ? ' (primary)' : ''} governs ${s.governs.join(', ')}: ${s.what}. Path: ${s.path}${ex ? `\n<<<${s.id}\n${ex}\n${s.id}>>>` : ' (read it before you start)'}`);
  }
  if ((job.truth ?? []).length) P.push(`Ground truth and tolerances (measure against these):\n${bullets(job.truth.map((t) => `${t.id}: ${t.what}, tolerance ${t.tolerance}. Path: ${t.path}`))}`);
  const itfs = interfacesFor(job, a, { offline }).map((itf) => [itf, offline ? null : interfaceText(job, itf)]).filter(([, t]) => t);
  if (itfs.length) P.push(`INTERFACES, verbatim from the source files (build to these exactly; never from memory):\n${itfs.map(([itf, t]) => `<<<${itf.id} (${itf.file})${itf.what ? `: ${itf.what}` : ''}\n${t}\n${itf.id}>>>`).join('\n')}`);
  P.push(`Your checks (they will be run; leave them passing):\n${bullets((a.checks ?? []).map((c) => `${c}: ${crit[c]?.statement ?? '?'} [${crit[c]?.check?.kind ?? '?'}${crit[c]?.check?.run ? `: ${crit[c].check.run}` : ''}]`))}`);
  P.push(`You own ONLY these paths; edit nothing else:\n${bullets(a.files ?? [])}${a.contract ? `\nYour contract with the other atoms: ${a.contract}` : ''}${a.capabilities?.length ? `\nYour contract can express: ${a.capabilities.join(', ')}. Use all of it the criteria need.` : ''}`);
  const owes = (job.criteria ?? []).filter((c) => (c.satisfiedBy ?? []).includes(id));
  if (owes.length) P.push(`The acceptance criteria you help satisfy:\n${bullets(owes.map((c) => `${c.id}: ${c.statement}${c.requires?.length ? ` (needs ${c.requires.join(', ')})` : ''}`))}`);
  const ro = [...(a.reads ?? []), ...(job.contracts ?? []).map((k) => `${k.path} (${k.owner === 'frozen' ? 'frozen' : `owned by ${k.owner}`})`)];
  if (ro.length) P.push(`Read-only to you:\n${bullets([...new Set(ro)])}`);
  if (seams.length) P.push(`Seams you touch:\n${bullets(seams.map((s) => `${s.id} between ${s.between.join(' and ')}: ${s.owner === id ? 'you own it; keep both sides consistent' : `owned by ${s.owner}; report problems, do not edit across it`}`))}`);
  if (outputs.length) P.push(`Current outputs of your piece (inspect every one):\n${bullets(outputs)}`);
  if (found.length) P.push(`The evals' findings attributed to you (fix these first):\n${bullets(found.map((f) => `[${f.level} ${f.rule ?? ''}] ${f.detail}${f.frames?.length ? ` (frames ${f.frames.join(', ')})` : ''}`))}`);
  const known = knowledgeFor(job, a);
  if (known.length) P.push(`Known facts that bear on your atom (each with its source; trust these over memory):\n${bullets(known.map((k) => `${k.text} [source: ${k.source}]`))}`);
  if (mine.length) P.push(`Lessons from earlier jobs that bear on your atom:\n${bullets(mine.map((l) => `${l.text}${l.fix ? ` → ${l.fix}` : ''}`))}`);
  if (note) P.push(`Note from the coordinator: ${note}`);
  P.push(['Critique your piece against the goal and its governing inputs, then fix it, in this one pass.',
    'Reply in exactly this form:', 'CHANGED: <files>', 'WHY: <five lines or fewer>',
    'CHECKS: <each check id: passed | failed | not run>. Report only checks you actually ran; never claim a pass you did not see.',
    'OUTSIDE-SCOPE: <what you could not fix because another atom or a contract owns it, or "none">'].join('\n'));
  return P.join('\n\n');
}

/** Every atom's prompt, and the hash of the set (FIRED carries it, so a launch can be traced to its exact prompts). */
export function compileAll(job, opts = {}) {
  const prompts = Object.fromEntries((job.atoms ?? []).map((a) => [a.id, compileAtom(job, a.id, opts)]));
  const atoms = Object.fromEntries(Object.entries(prompts).map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex')]));
  const manifestHash = crypto.createHash('sha256').update(JSON.stringify(Object.entries(atoms).sort())).digest('hex');
  return { prompts, atoms, manifestHash };
}
