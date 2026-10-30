// Lesson retrieval (I14; FMEA "lessons not fed forward"): before a job launches, pull the open lessons of earlier jobs
// of the same kind into its card, and the ones that match an atom into that atom's prompt.
// Sources, all on durable disk:
//   - other job manifests of the same kind under the jobs roots (ENDOFORGE_JOBS, default ./jobs),
//     through their `notes` file and their rounds' LESSONS.md;
//   - the job's own `lessonsFrom` list (NOTES.md files, LESSONS.md files, hill-climb lessons.json ledgers).
// A NOTES.md mistakes-table row is open unless its fix column cites a PR (#123): that is the tool change that closed it.
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

/** Mistakes-table rows from a NOTES.md: | # | what went wrong | … | fix | */
export function notesLessons(file, from) {
  const text = read(file); if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const c = cells(line), fix = c.at(-1);
    out.push({ from, key: `${from}#${c[0]}`, text: c[1].replace(/\*\*/g, ''), fix: fix.replace(/\*\*/g, ''), source: file, open: !/#\d{2,}/.test(fix) });
  }
  return out;
}
/** The "Open lessons with no tool change yet" bullets of a hill-climb LESSONS.md. */
export function lessonsMdLessons(file, from) {
  const text = read(file); if (!text) return [];
  const sec = text.split(/^## /m).find((s) => s.startsWith('Open lessons'));
  return (sec ?? '').split('\n').filter((l) => /^- `/.test(l)).map((l) => {
    const m = /^- `([^`]+)` \(([^,)]+)[^)]*\): (.*)$/.exec(l);
    return m ? { from, key: `${from}:${m[1]}`, text: m[3], stage: m[2], source: file, open: true } : null;
  }).filter(Boolean);
}
/** Open entries of a hill-climb lessons.json ledger. */
export function ledgerLessons(file, from) {
  try { return Object.entries(JSON.parse(read(file))).filter(([, v]) => !v.tool).map(([k, v]) => ({ from, key: `${from}:${k}`, text: v.lesson, stage: v.stage, source: file, open: true })); } catch { return []; }
}
const byFile = (p, from) => (p.endsWith('.json') ? ledgerLessons(p, from) : /LESSONS\.md$/.test(p) ? lessonsMdLessons(p, from) : notesLessons(p, from));

function jobsUnder(roots) {
  const out = [];
  for (const root of roots) {
    let entries = []; try { entries = fs.readdirSync(root, { recursive: true }); } catch { continue; }
    for (const e of entries) if (String(e).endsWith('.json') && !String(e).endsWith('.proofs.json')) {
      try { const j = JSON.parse(read(path.join(root, e))); if (j?.schema === 'endoforge/job/1') out.push(j); } catch {}
    }
  }
  return out;
}

/** Open lessons for a job: earlier jobs of the same kind, plus its own lessonsFrom. De-duplicated by key. */
export function retrieveLessons(job, { roots = (process.env.ENDOFORGE_JOBS || './jobs').split(':') } = {}) {
  const found = [];
  for (const j of jobsUnder(roots)) {
    if (j.id === job.id || j.kind !== job.kind) continue;
    if (j.notes) found.push(...notesLessons(j.notes, j.id));
    for (const r of j.rounds ?? []) if (r.lessons) found.push(...lessonsMdLessons(r.lessons, j.id));
  }
  for (const p of job.lessonsFrom ?? []) found.push(...byFile(p, path.basename(path.dirname(p)) || 'earlier'));
  const seen = new Set();
  return found.filter((l) => l.open && !seen.has(l.key) && seen.add(l.key));
}

/** The lessons that bear on one atom: those naming its id, one of its aspects, or one of its files' names. */
export function lessonsForAtom(atom, lessons) {
  const words = [atom.id, ...(atom.aspects ?? []), ...(atom.files ?? []).map((f) => path.basename(f).replace(/\.\w+$/, ''))].filter((w) => w.length > 2).map((w) => w.toLowerCase());
  return lessons.filter((l) => { const t = `${l.text} ${l.fix ?? ''}`.toLowerCase(); return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)); });
}
