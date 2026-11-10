import fs from 'node:fs';
import path from 'node:path';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());

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
export function lessonsMdLessons(file, from) {
  const text = read(file); if (!text) return [];
  const sec = text.split(/^## /m).find((s) => s.startsWith('Open lessons'));
  return (sec ?? '').split('\n').filter((l) => /^- `/.test(l)).map((l) => {
    const m = /^- `([^`]+)` \(([^,)]+)[^)]*\): (.*)$/.exec(l);
    return m ? { from, key: `${from}:${m[1]}`, text: m[3], stage: m[2], source: file, open: true } : null;
  }).filter(Boolean);
}
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

export function lessonsForAtom(atom, lessons) {
  const words = [atom.id, ...(atom.aspects ?? []), ...(atom.files ?? []).map((f) => path.basename(f).replace(/\.\w+$/, ''))].filter((w) => w.length > 2).map((w) => w.toLowerCase());
  return lessons.filter((l) => { const t = `${l.text} ${l.fix ?? ''}`.toLowerCase(); return words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)); });
}
