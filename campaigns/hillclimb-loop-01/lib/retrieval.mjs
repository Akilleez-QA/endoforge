// Retrieval by fingerprint (challenger move): the library is the 20 loop-0 development artefacts and nothing else, so a
// working or sealed request can never hit its own earlier artefact (contamination, not compounding). Fingerprint: word
// overlap between request texts plus the loop-0 glue labels; a hit needs Jaccard >= 0.2 and one shared domain term.
import fs from 'node:fs';
import path from 'node:path';
import { X1, requestText } from './runner.mjs';

const STOP = new Set('a an the of to in on at for and or is are be with what how much many do i my it this that from as by can could should would which when into out up down per using use give me'.split(' '));
const DOMAIN = ['refrigerant','ammonia','nh3','r290','r22','r-22','r404a','r410a','r448a','r407c','psig','psi','superheat','subcooling','dew','humidity','evaporator','condenser','compressor','charge','kw','hp','horsepower','watts','amps','motor','vessel','inventory','recirculation','pipe','line','tonnage','tr','btuh','temperature','pressure','freezer','walk','suction','discharge','vacuum','inhg','ppm','room','ft3','m3','liquid','vapour','vapor','recovery','cylinder','saturation','epr','txv','tev','boil','freeze','cost','price'];
const toks = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9.\-\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));

export function buildIndex(devIds) {
  const idx = [];
  for (const id of devIds) {
    const dir = path.join(X1, 'work', 'factory', id);
    if (!fs.existsSync(path.join(dir, 'glue.json'))) continue; // CC-001 (gate-rejected) has no glue and is not in the library
    const glue = JSON.parse(fs.readFileSync(path.join(dir, 'glue.json'), 'utf8'));
    const req = requestText(id);
    const text = `${req.text} ${glue.exports.map((e) => `${e.label} ${e.args.map((a) => a.label ?? a.name).join(' ')} ${e.result.unit}`).join(' ')}`;
    idx.push({ id, dir, req: req.text, toks: toks(text), glue, kernel: fs.readFileSync(path.join(dir, 'kernel.ts'), 'utf8') });
  }
  return idx;
}

export function retrieve(index, reqText, { minJaccard = 0.2 } = {}) {
  const q = toks(reqText);
  let best = null;
  for (const e of index) {
    const inter = [...q].filter((t) => e.toks.has(t));
    const j = inter.length / (new Set([...q, ...e.toks]).size || 1);
    const domain = inter.some((t) => DOMAIN.includes(t));
    if (j >= minJaccard && domain && (!best || j > best.j)) best = { id: e.id, j: Number(j.toFixed(3)), shared: inter, entry: e };
  }
  return best;
}

export function retrievedBlock(hit) {
  if (!hit) return '';
  const g = hit.entry.glue;
  const iface = g.exports.map((e) => `- ${e.name}(${e.args.map((a) => `${a.name}: ${a.kind} [${a.unit}]`).join(', ')}) -> ${e.result.kind} [${e.result.unit}]: ${e.label}`).join('\n');
  return `\n## An existing capability from the library that may be close (reuse or adapt only what fits this request)\n\nIts request: "${hit.entry.req}"\n\nIts interface:\n${iface}\n\nIts assumption: ${g.assumption}\n\nIts kernel (AssemblyScript):\n\n${hit.entry.kernel}\n`;
}
