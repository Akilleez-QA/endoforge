import fs from 'node:fs';
import path from 'node:path';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const abs = (job, f) => (path.isAbsolute(f) ? f : path.join(job.repo ?? '.', f));
const matcher = (m) => (typeof m === 'number' ? (_, i) => i + 1 === m : ((re) => (l) => re.test(l))(new RegExp(m)));

export function interfaceText(job, itf) {
  const text = read(abs(job, itf.file)); if (text == null) return null;
  const lines = text.split('\n'), start = matcher(itf.start), end = itf.end != null ? matcher(itf.end) : (l) => /^}\s*;?\s*$/.test(l);
  const i = lines.findIndex((l, k) => start(l, k)); if (i < 0) return null;
  let j = itf.end != null ? i : i + 1;
  while (j < lines.length - 1 && !end(lines[j], j)) j++;
  return lines.slice(i, j + 1).join('\n');
}

export function imports(job, atom, file) {
  const name = path.basename(file).replace(/\.[^.]+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(import|require|include|from|source|use)\\b[^\\n]*\\b${name}\\b`);
  return (atom.files ?? []).some((f) => { const t = read(abs(job, f)); return t != null && re.test(t); });
}

export function interfacesFor(job, atom, { offline = false } = {}) {
  return (job.interfaces ?? []).filter((itf) => (atom.interfaces ?? []).includes(itf.id) || (atom.reads ?? []).includes(itf.file) || (!offline && imports(job, atom, itf.file)));
}

export function select(doc, p) {
  let cur = [doc];
  for (const seg of p.split('.').filter(Boolean)) {
    const m = /^(\w+)(\[\*\])?$/.exec(seg); if (!m) return [];
    cur = cur.flatMap((x) => (x && typeof x === 'object' ? [x[m[1]]] : [])).flatMap((x) => (m[2] ? (Array.isArray(x) ? x : []) : [x])).filter((x) => x !== undefined);
  }
  return cur;
}

export function duplicatedFacts(job) {
  const out = [];
  for (const fact of job.facts ?? []) {
    let values = fact.values ?? [];
    if (fact.select) { const d = read(abs(job, fact.source)); try { values = select(JSON.parse(d), fact.select); } catch { values = []; } }
    const vals = [...new Set(values.map(String))].filter((v) => v.length >= 3 || /\d\.\d/.test(v));
    for (const a of job.atoms ?? []) for (const f of a.files ?? []) {
      if (abs(job, f) === abs(job, fact.source)) continue;
      const t = read(abs(job, f)); if (t == null) continue;
      const copied = vals.filter((v) => new RegExp(`(^|[^\\w.])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w.])`).test(t));
      if (copied.length) out.push({ fact: fact.id, atom: a.id, file: f, values: copied.slice(0, 5), count: copied.length });
    }
  }
  return out;
}
