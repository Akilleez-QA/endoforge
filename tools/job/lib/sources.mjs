// Interfaces quoted from source (P-C) and facts that live once (P-A). Universal mechanism; what an interface or a
// fact is belongs to the manifest.
//   interfaces: [{ id, file, start, end?, what? }]   start/end are line numbers or regexes; the excerpt runs from the
//                                                   first line matching start to the first later line matching end
//                                                   (default: a line that is just "}" or the end of the file)
//   atom.interfaces: [ids]                           the interfaces an atom builds to (also given to any atom that reads
//                                                   or imports the interface's file)
//   facts: [{ id, source, select?, values? }]        a fact's values, inline or selected from a JSON source by a path
//                                                   such as "items[*].start"; the source is the one place it lives
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const abs = (job, f) => (path.isAbsolute(f) ? f : path.join(job.repo ?? '.', f));
const matcher = (m) => (typeof m === 'number' ? (_, i) => i + 1 === m : ((re) => (l) => re.test(l))(new RegExp(m)));

/** The interface's source text, verbatim, or null when the file or the start cannot be found. */
export function interfaceText(job, itf) {
  const text = read(abs(job, itf.file)); if (text == null) return null;
  const lines = text.split('\n'), start = matcher(itf.start), end = itf.end != null ? matcher(itf.end) : (l) => /^}\s*;?\s*$/.test(l);
  const i = lines.findIndex((l, k) => start(l, k)); if (i < 0) return null;
  let j = itf.end != null ? i : i + 1;                            // an explicit end may be the start line itself
  while (j < lines.length - 1 && !end(lines[j], j)) j++;
  return lines.slice(i, j + 1).join('\n');
}

/** Does any of the atom's files import or include `file` (by its name without extension)? */
export function imports(job, atom, file) {
  const name = path.basename(file).replace(/\.[^.]+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b(import|require|include|from|source|use)\\b[^\\n]*\\b${name}\\b`);
  return (atom.files ?? []).some((f) => { const t = read(abs(job, f)); return t != null && re.test(t); });
}

/** The interfaces an atom gets: its declared ones, plus those whose file it reads or imports. */
export function interfacesFor(job, atom, { offline = false } = {}) {
  return (job.interfaces ?? []).filter((itf) => (atom.interfaces ?? []).includes(itf.id) || (atom.reads ?? []).includes(itf.file) || (!offline && imports(job, atom, itf.file)));
}

/** Values of a JSON document at a path like "a.b[*].c". */
export function select(doc, p) {
  let cur = [doc];
  for (const seg of p.split('.').filter(Boolean)) {
    const m = /^(\w+)(\[\*\])?$/.exec(seg); if (!m) return [];
    cur = cur.flatMap((x) => (x && typeof x === 'object' ? [x[m[1]]] : [])).flatMap((x) => (m[2] ? (Array.isArray(x) ? x : []) : [x])).filter((x) => x !== undefined);
  }
  return cur;
}

/** P-A: places where a fact's value is copied into an owned file instead of being derived from its source. */
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
