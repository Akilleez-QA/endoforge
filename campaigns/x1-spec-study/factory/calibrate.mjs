#!/usr/bin/env node
// Human calibration of the persona proxy (HILLCLIMB-METHOD v2, loop-1 step 0).
//   node factory/calibrate.mjs build <run-id> --seed N     draw 10 items, write the blind packet and the sealed key
//   node factory/calibrate.mjs score <run-id> [--form <path> --rater <label>]   score a filled form (default FORM.md, rater 'owner') against the persona verdicts
//   node factory/calibrate.mjs compare <run-id> <labelA> <labelB>           agreement between two scored raters
//
// Sampling rule (recorded in the receipt): all capabilities accepted by every persona (3), the persona-rejected
// capability (1), and 6 drawn at random from the promoted-pending-change set; order shuffled; ids replaced by item numbers.
// The owner sees: request verbatim, what the capability does (from glue.json), three rendered example calls taken from the
// frozen tests, trap messages, the assumption and the question. Never: persona verdicts, promotion status, timings,
// contract, tests, code. The key (item -> id) lives in work/ (git-ignored); receipt/ holds only its sha256 until scoring.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FACT = path.join(KIT, 'work', 'factory');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const [cmd, runId, ...rest] = process.argv.slice(2);
if (!cmd || !runId) { console.error('usage: calibrate.mjs build|score <run-id> [--seed N]'); process.exit(2); }
const WORK = path.join(KIT, 'work', 'human-calibration', runId);
const RECEIPT = path.join(KIT, 'receipt', 'human-calibration', runId);

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(a, seed) { const r = rng(seed); const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }

/** Capability-level persona verdict: reject if any persona rejected; with-change if any asked for one; else accept. */
function personaLevel(row) {
  const p = row.persona ?? {};
  let v = (p.verdicts ?? []).map((x) => x.verdict);
  if (!v.length && fs.existsSync(path.join(FACT, row.id, 'persona.json'))) v = (json(path.join(FACT, row.id, 'persona.json')).verdicts ?? []).map((x) => x.verdict);
  if (v.length) { if (v.includes('reject')) return 'not-usable'; if (v.includes('accept-with-change')) return 'with-change'; return 'clean'; }
  if ((p.reject ?? 0) > 0) return 'not-usable';
  if ((p.acceptWithChange ?? 0) > 0) return 'with-change';
  if ((p.accept ?? 0) > 0) return 'clean';
  return null;
}

function requestText(id) {
  const t = fs.readFileSync(path.join(KIT, 'work', 'pool', `${id}.md`), 'utf8');
  const m = t.match(/## The request, in the requester's words\s*\n\n> ?([\s\S]*?)\n\n## /);
  return m ? m[1].trim().replace(/^"|"$/g, '') : '(request text not found)';
}

function render(dir, glue, fn, args) {
  const bytes = fs.readFileSync(path.join(dir, 'kernel.wasm'));
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { abort: () => { throw new Error('trap'); } } });
  const spec = glue.exports.find((e) => e.name === fn);
  if (!spec) return `${fn}(${args.join(', ')}) -> (no glue for this export)`;
  let out;
  try { out = inst.exports[fn](...args); } catch {
    const traps = glue.traps.filter((t) => t.fn === fn);
    return `${fn}(${args.join(', ')}) -> refused: ${traps.length ? traps.map((t) => t.message).join(' / ') : 'invalid input'}`;
  }
  const r = spec.result;
  const shown = r.kind === 'boolean' ? (out ? r.labels.true : r.labels.false) : r.kind === 'code' ? `${out} = ${r.codes?.[String(out)] ?? 'unlabelled'}` : r.kind === 'integer' ? `${out} ${r.unit}` : `${Number(out).toFixed(r.precision ?? 2)} ${r.unit}`;
  const argLine = spec.args.map((a, i) => `${a.name} = ${args[i]}${a.kind === 'code' ? ` (${a.codes?.[String(args[i])] ?? '?'})` : ['code', 'dimensionless', 'count', 'flag'].includes(a.unit) ? '' : ` ${a.unit}`}`).join(', ');
  return `${spec.label}: ${fn}(${argLine}) -> ${shown}`;
}

function itemSheet(n, id) {
  const dir = path.join(FACT, id);
  const glue = json(path.join(dir, 'glue.json'));
  const tests = json(path.join(dir, 'tests.json'));
  const normal = tests.filter((t) => !t.expectError).slice(0, 2);
  const trap = tests.find((t) => t.expectError);
  const examples = [...normal, ...(trap ? [trap] : [])].map((t) => render(dir, glue, t.fn, t.args));
  const does = glue.exports.map((e) => `- **${e.label}** (${e.name}): inputs ${e.args.map((a) => `${a.label ?? a.name} [${a.unit}]`).join(', ')}; result in ${e.result.unit}${e.result.kind === 'code' ? ' (a labelled code)' : e.result.kind === 'boolean' ? ' (yes/no)' : ''}`).join('\n');
  return `# Item ${String(n).padStart(2, '0')}

## The request, as the person asked it

> ${requestText(id)}

## What the capability does

${does}

## Example calls (as a user would see them)

${examples.map((e) => `- ${e}`).join('\n')}

## The assumption it was built on

${glue.assumption}
${glue.notes ? `\nNote shown with every answer: ${glue.notes}\n` : ''}
## The question it would ask the requester

${glue.question}
`;
}

if (cmd === 'build') {
  const seedArg = rest.indexOf('--seed'); const seed = seedArg >= 0 ? Number(rest[seedArg + 1]) : NaN;
  if (!Number.isInteger(seed)) { console.error('--seed <integer> required'); process.exit(2); }
  if (fs.existsSync(WORK) || fs.existsSync(RECEIPT)) { console.error(`${runId} exists; use a new run id`); process.exit(2); }
  const summary = json(path.join(KIT, 'receipt', 'factory-summary.json'));
  const gated = summary.rows.filter((r) => r.gated && fs.existsSync(path.join(FACT, r.id, 'glue.json')));
  const byLevel = { clean: [], 'with-change': [], 'not-usable': [] };
  for (const r of gated) { const l = personaLevel(r); if (l) byLevel[l].push(r.id); }
  const picks = [...byLevel.clean, ...byLevel['not-usable'], ...shuffle(byLevel['with-change'], seed).slice(0, 10 - byLevel.clean.length - byLevel['not-usable'].length)];
  const order = shuffle(picks, seed + 1);
  fs.mkdirSync(WORK, { recursive: true }); fs.mkdirSync(RECEIPT, { recursive: true });
  const key = order.map((id, i) => ({ item: i + 1, id }));
  const keyText = JSON.stringify({ runId, seed, rule: 'all persona-clean + persona-rejected + 6 random pending-change; shuffled', key }, null, 2) + '\n';
  fs.writeFileSync(path.join(WORK, 'key.json'), keyText);
  for (const { item, id } of key) fs.writeFileSync(path.join(WORK, `ITEM-${String(item).padStart(2, '0')}.md`), itemSheet(item, id));
  const form = ['# Blind verdict form', '', `Run ${runId}. Grade each item from its sheet only. Do not open key.json, work/factory/, receipts or the app until you have finished. Write your answers between the brackets; leave a line blank if you cannot say. Record the time you start and stop.`, '', 'Started: [ ]', 'Finished: [ ]', ''];
  for (const { item } of key) form.push(`## Item ${String(item).padStart(2, '0')}`, '', 'Q1 Does it answer the question the person asked? [yes / partly / no]: [ ]', 'Q2 Is the assumption an admissible default for someone in the field? [yes / no / unsure]: [ ]', 'Q3 Is the question it would ask the right one to ask? [yes / no]: [ ]', 'Q4 Verdict as returned: [clean / usable-with-change / not-usable]: [ ]', 'Q5 If with-change or not-usable, the one change or the reason (one line): [ ]', 'Q6 Would you have asked this yourself? [yes / no]: [ ]', '');
  fs.writeFileSync(path.join(WORK, 'FORM.md'), form.join('\n'));
  fs.writeFileSync(path.join(RECEIPT, 'setup.json'), JSON.stringify({ runId, at: new Date().toISOString(), seed, rule: 'all persona-clean + persona-rejected + 6 random pending-change; order shuffled', n: key.length, keySha256: sha(keyText), sheetSha256: Object.fromEntries(key.map(({ item }) => [item, sha(fs.readFileSync(path.join(WORK, `ITEM-${String(item).padStart(2, '0')}.md`)))])), formSha256: sha(form.join('\n')), shownToOwner: ['request verbatim', 'what it does (glue)', 'three example calls from frozen tests', 'trap messages', 'assumption', 'notes', 'question'], hiddenFromOwner: ['persona verdicts', 'promotion status', 'timings', 'contract', 'tests', 'code', 'id'] }, null, 2) + '\n');
  console.log(`packet: ${WORK} (${key.length} items); form: ${path.join(WORK, 'FORM.md')}; key sealed (sha256 ${sha(keyText).slice(0, 16)}…) in receipt/human-calibration/${runId}/setup.json`);
  process.exit(0);
}

if (cmd === 'compare') {
  const [a, b] = rest;
  const A = json(path.join(RECEIPT, `summary-${a}.json`)).rows, B = json(path.join(RECEIPT, `summary-${b}.json`)).rows;
  const scale = { clean: 0, 'usable-with-change': 1, 'not-usable': 2 };
  let n = 0, exact = 0, within1 = 0; const rows = [];
  for (const ra of A) { const rb = B.find((x) => x.item === ra.item); if (!rb || ra.owner === null || rb.owner === null) continue; n++; const d = Math.abs(scale[ra.owner] - scale[rb.owner]); if (d === 0) exact++; if (d <= 1) within1++; rows.push({ item: ra.item, id: ra.id, [a]: ra.owner, [b]: rb.owner, persona: ra.persona }); }
  const res = { runId, raters: [a, b], n, exactAgreement: `${exact}/${n}`, within1: `${within1}/${n}`, rows };
  fs.writeFileSync(path.join(RECEIPT, `compare-${a}-${b}.json`), JSON.stringify(res, null, 2) + '\n');
  console.log(JSON.stringify({ n, exactAgreement: res.exactAgreement, within1: res.within1 }));
  process.exit(0);
}

if (cmd === 'score') {
  const fi = rest.indexOf('--form'), ri = rest.indexOf('--rater');
  const formPath = fi >= 0 ? path.resolve(rest[fi + 1]) : path.join(WORK, 'FORM.md');
  const rater = ri >= 0 ? rest[ri + 1] : 'owner';
  const key = json(path.join(WORK, 'key.json')).key;
  const form = fs.readFileSync(formPath, 'utf8');
  const summary = json(path.join(KIT, 'receipt', 'factory-summary.json'));
  const rows = Object.fromEntries(summary.rows.map((r) => [r.id, r]));
  const answers = {};
  for (const block of form.split(/^## Item /m).slice(1)) {
    const n = Number(block.slice(0, 2));
    const get = (q) => (block.match(new RegExp(`^${q}[^\\n]*:\\s*\\[\\s*([^\\]]*?)\\s*\\]`, 'm')) ?? [])[1]?.trim().toLowerCase() ?? '';
    answers[n] = { q1: get('Q1'), q2: get('Q2'), q3: get('Q3'), q4: get('Q4'), q5: get('Q5'), q6: get('Q6') };
  }
  const scale = { clean: 0, 'usable-with-change': 1, 'with-change': 1, 'not-usable': 2 };
  const out = []; let fa = 0, faDen = 0, fr = 0, frDen = 0, exact = 0, within1 = 0, graded = 0;
  for (const { item, id } of key) {
    const a = answers[item] ?? {}; const owner = a.q4 in scale ? a.q4 : null; const persona = personaLevel(rows[id]);
    const o = owner === null ? null : scale[owner]; const p = scale[persona];
    if (o !== null) { graded++; if (o === p) exact++; if (Math.abs(o - p) <= 1) within1++;
      if (persona !== 'not-usable') { faDen++; if (o === 2) fa++; }
      if (persona === 'not-usable') { frDen++; if (o < 2) fr++; } }
    out.push({ item, id, persona, owner, q1: a.q1, q2: a.q2, q3: a.q3, q5: a.q5, q6: a.q6 });
  }
  const res = { runId, rater, formSha256: sha(form), at: new Date().toISOString(), graded, exactAgreement: `${exact}/${graded}`, within1: `${within1}/${graded}`, falseAccept: `${fa}/${faDen}`, falseAcceptNote: 'persona promoted (clean or with-change) but owner not-usable', falseReject: `${fr}/${frDen}`, canaryRecall: out.filter((x) => x.persona === 'not-usable').map((x) => ({ id: x.id, ownerCaught: x.owner === 'not-usable' })), rows: out };
  fs.mkdirSync(RECEIPT, { recursive: true });
  fs.writeFileSync(path.join(RECEIPT, `summary-${rater}.json`), JSON.stringify(res, null, 2) + '\n');
  fs.copyFileSync(path.join(WORK, 'key.json'), path.join(RECEIPT, 'key-revealed.json'));
  console.log(JSON.stringify({ graded, exactAgreement: res.exactAgreement, within1: res.within1, falseAccept: res.falseAccept, falseReject: res.falseReject, canaryRecall: res.canaryRecall }, null, 1));
  process.exit(0);
}
console.error('unknown command'); process.exit(2);
