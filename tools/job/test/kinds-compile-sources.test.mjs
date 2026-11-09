import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KINDS, proxyKinds } from '../lib/kinds.mjs';
import { validate } from '../lib/validate.mjs';
import { compileAtom, compileAll, excerpt, knowledgeFor } from '../lib/compile.mjs';
import { cardHash, confirmationOf, renderCard } from '../lib/card.mjs';
import { interfaceText, imports, interfacesFor, select, duplicatedFacts } from '../lib/sources.mjs';
import { loadJob, proofsFile } from '../lib/load.mjs';

const JOB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KIND_DIR = path.join(JOB, 'kinds');
const RULE_KEYS = new Set(['id', 'note', 'proxyCheckKinds', 'splitByTests', 'requireCheckKinds', 'requireAnyCheckKind', 'measureReferencesGoverning', 'requireCheckField', 'requiresTruth']);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-kinds-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (rel, text) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return p; };

function makeJob(kind = 'code', extra = {}) {
  const spec = write('in/spec.md', ['# Spec', 'line two', 'the parser must accept UTF-8', 'line four', 'line five'].join('\n'));
  const ref = write('in/ref.png', 'png');
  return {
    schema: 'endoforge/job/1', id: 'demo', title: 'Demo job', kind,
    goal: { verbatim: 'make the parser accept every UTF-8 input', by: 'Sam', at: '2026-11-01' },
    brief: { objective: 'parse UTF-8', acceptance: 'tests pass', scope: 'parser only', authority: 'Sam',
      assumptions: { stated: ['no API keys'], inferred: ['keep the CLI'] } },
    notes: write('NOTES.md', ''),
    sources: [{ id: 'spec', path: spec, what: 'the spec', governs: ['parser'], primary: true, excerpt: { lines: '2-3' } }],
    references: [{ id: 'look', path: ref, what: 'the look', governs: ['ui'], thumbnails: ['/thumbs/a.png', '/thumbs/b.png'] }],
    criteria: [{ id: 'C-T', statement: 'the suite passes', check: { kind: 'tests', run: 'make test' }, satisfiedBy: ['A'], requires: ['edit'] }],
    atoms: [
      { id: 'A', engine: 'claude', aspects: ['parser'], sources: ['spec'], files: ['src/parser'], checks: ['C-T'], capabilities: ['edit'] },
      { id: 'B', engine: 'claude', aspects: ['ui'], references: ['look'], files: ['src/ui'], checks: ['C-T'], capabilities: ['edit'] },
    ],
    criticalPath: 'A', rival: 'rewrite from scratch', deadline: '2026-12-01T00:00:00Z',
    ...extra,
  };
}

const kindErrors = (job, gate = 'decide') => validate(job, { gate, offline: true, volatile: [] }).errors.filter((e) => e.msg.startsWith(`${job.kind}: `)).map((e) => e.msg);

test('every bundled kind file parses, is named by its id, uses only known rule keys and is loaded with its checks', () => {
  const files = fs.readdirSync(KIND_DIR).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(files, ['campus.json', 'code.json', 'doc.json', 'generic.json', 'model3d.json', 'video.json']);
  for (const f of files) {
    const k = JSON.parse(fs.readFileSync(path.join(KIND_DIR, f), 'utf8'));
    assert.equal(`${k.id}.json`, f);
    assert.deepEqual(Object.keys(k).filter((key) => !RULE_KEYS.has(key)), [], f);
    assert.ok(Array.isArray(k.proxyCheckKinds) && k.proxyCheckKinds.includes('eval') && k.proxyCheckKinds.includes('critic'), f);
    assert.equal(KINDS[k.id].id, k.id);
    assert.equal(typeof KINDS[k.id].checks.decide, 'function');
    assert.equal(typeof KINDS[k.id].checks.observe, 'function');
    assert.equal(KINDS[k.id].requiresTruth, Boolean(k.requiresTruth));
  }
});

test('an unknown kind is refused at Pontificate, including names inherited from Object', () => {
  for (const kind of ['nonesuch', 'toString', 'constructor', '__proto__', 'hasOwnProperty', undefined]) {
    const v = validate({ ...makeJob(), kind }, { gate: 'pontificate', offline: true });
    assert.ok(v.errors.some((e) => e.inv === 'I1' && /^kind must be one of .*code/.test(e.msg)), `${kind} was accepted`);
  }
  assert.ok(!validate(makeJob('code'), { gate: 'pontificate', offline: true }).errors.some((e) => /^kind must/.test(e.msg)));
});

test('proxy check kinds come from the kind, else from generic', () => {
  assert.deepEqual(proxyKinds({ kind: 'campus' }), ['eval', 'critic', 'site-rules']);
  assert.deepEqual(proxyKinds({ kind: 'video' }), ['eval', 'critic', 'likeness']);
  assert.deepEqual(proxyKinds({ kind: 'nonesuch' }), KINDS.generic.proxyCheckKinds);
  assert.deepEqual(proxyKinds({ kind: 'toString' }), KINDS.generic.proxyCheckKinds);
  assert.deepEqual(proxyKinds(undefined), KINDS.generic.proxyCheckKinds);
});

test('code needs a tests criterion and accepts a tests ratchet', () => {
  assert.deepEqual(kindErrors(makeJob('code')), []);
  const job = makeJob('code', { criteria: [{ id: 'C-T', statement: 'lint', check: { kind: 'lint', run: 'make lint' }, satisfiedBy: ['A'], requires: [] }] });
  assert.deepEqual(kindErrors(job), ['code: a code job needs a tests criterion (the suite that must pass before and after)']);
  const ratchet = (kind) => validate(makeJob(kind, { ratchet: { kind: 'tests' } }), { gate: 'decide', offline: true }).errors.some((e) => e.inv === 'I10');
  assert.equal(ratchet('code'), false);
  assert.equal(ratchet('doc'), true);
});

test('doc and generic add no kind rules', () => {
  for (const kind of ['doc', 'generic']) assert.deepEqual(kindErrors(makeJob(kind, { criteria: [] })), []);
});

test('video needs an eval check and a likeness check against each reference governing its look', () => {
  const job = makeJob('video');
  assert.deepEqual(kindErrors(job), ['video: a video needs a numeric eval gate over its outputs (framing, visibility, timing)']);
  job.references[0].governs = ['look'];
  assert.ok(kindErrors(job).includes('video: reference look governs look: add a likeness check against it'));
  job.criteria.push({ id: 'C-E', statement: 'framing', check: { kind: 'eval', measure: 'framing', target: 0.9 } },
    { id: 'C-L', statement: 'likeness', check: { kind: 'likeness', reference: 'look', measure: 'ssim', target: 0.8 } });
  assert.deepEqual(kindErrors(job), []);
});

test('model3d needs a likeness or eval check and a likeness check against model references', () => {
  const job = makeJob('model3d');
  job.references[0].governs = ['geometry'];
  assert.deepEqual(kindErrors(job).sort(), [
    'model3d: a 3D model needs a likeness or dimension check',
    'model3d: reference look governs geometry: add a likeness check against it',
  ]);
  job.criteria.push({ id: 'C-L', statement: 'likeness', check: { kind: 'likeness', reference: 'look', measure: 'iou', target: 0.9 } });
  assert.deepEqual(kindErrors(job), []);
});

test('campus needs survey evidence in its truth package and a site-rules baseline', () => {
  const job = makeJob('campus');
  assert.deepEqual(kindErrors(job), ['campus: a campus job needs a site-rules check with its ratchet baseline']);
  assert.ok(validate(job, { gate: 'observe', offline: true }).errors.some((e) => e.inv === 'I4' && /campus job must name its truth package/.test(e.msg)));
  job.truth = [{ id: 'T1', what: 'a sketch', path: '/data/t1', tolerance: '1 m' }];
  assert.deepEqual(kindErrors(job, 'observe'), ['campus: the truth package must include survey evidence (LiDAR, photos, drawings or measurements)']);
  job.truth.push({ id: 'T2', what: 'LiDAR survey', path: '/data/t2', tolerance: '5 cm' });
  job.criteria.push({ id: 'C-S', statement: 'site rules', check: { kind: 'site-rules', run: 'rules', baseline: '/data/base.json' } });
  assert.deepEqual(kindErrors(job), []);
});

test('ENDOFORGE_JOB_KINDS adds kinds from data, and a kind file with an unknown rule key is refused by name', () => {
  const extra = path.join(tmp, 'kinds-extra');
  fs.mkdirSync(extra);
  fs.writeFileSync(path.join(extra, 'audio.json'), JSON.stringify({ id: 'audio', proxyCheckKinds: ['eval'], requireCheckKinds: [{ kind: 'loudness', why: 'audio needs loudness' }] }));
  const probe = `import { KINDS } from ${JSON.stringify(new URL('../lib/kinds.mjs', import.meta.url).href)}; console.log(JSON.stringify(Object.keys(KINDS).sort()));`;
  const run = () => spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8', env: { ...process.env, ENDOFORGE_JOB_KINDS: `${path.join(tmp, 'absent')}:${extra}` } });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), ['audio', 'campus', 'code', 'doc', 'generic', 'model3d', 'video']);
  fs.writeFileSync(path.join(extra, 'typo.json'), JSON.stringify({ id: 'typo', requireCheckKind: [{ kind: 'tests', why: 'x' }] }));
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /typo\.json/);
  assert.match(r.stderr, /requireCheckKind\b/);
  fs.writeFileSync(path.join(extra, 'typo.json'), JSON.stringify({ proxyCheckKinds: [] }));
  r = run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /typo\.json.*id/);
});

test('excerpt reads a line range, a match with context, the whole short file, and cuts long text', () => {
  const p = write('ex/a.txt', ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n'));
  assert.equal(excerpt({ path: p, excerpt: { lines: '2-4' } }), 'two\nthree\nfour');
  assert.equal(excerpt({ path: p, excerpt: { lines: '5' } }), 'five');
  assert.equal(excerpt({ path: p, excerpt: { match: 'FOUR', context: 1 } }), 'three\nfour\nfive');
  assert.equal(excerpt({ path: p, excerpt: { match: 'one|seven', context: 0 } }), 'one\nseven');
  assert.equal(excerpt({ path: p }), fs.readFileSync(p, 'utf8'));
  assert.equal(excerpt({ path: p }, { offline: true }), null);
  assert.equal(excerpt({ path: path.join(tmp, 'ex/absent.txt') }), null);
  const long = write('ex/long.txt', 'x'.repeat(7000));
  const cut = excerpt({ path: long });
  assert.ok(cut.startsWith('x'.repeat(6000) + '\n[… excerpt cut at 6000 characters'));
  assert.ok(!cut.includes('x'.repeat(6001)));
});

test('compileAtom carries the goal verbatim, the brief, its governing inputs, checks, files and return form', () => {
  const job = makeJob('code', {
    contracts: [{ path: 'src/api.h', owner: 'frozen' }],
    seams: [{ id: 'S1', between: ['A', 'B'], owner: 'B' }],
    knowledge: [{ text: 'UTF-8 BOM appears in fixtures', source: 'run 3', tags: ['parser'] }, { text: 'ui only', source: 'run 2', tags: ['ui'] }],
  });
  const p = compileAtom(job, 'A', { round: 2, note: 'go', found: [{ level: 'HARD', rule: 'R1', detail: 'crash on BOM', frames: [3] }], outputs: ['/out/a.txt'] });
  assert.ok(p.startsWith('You are atom A of job "Demo job" (code), one of 2 atoms working at once. Each atom owns different files. Round 2.'));
  assert.ok(p.includes("THE GOAL, in Sam's own words (this, not any summary, is what you build):\n> make the parser accept every UTF-8 input"));
  for (const s of ['- objective: parse UTF-8', '- acceptance: tests pass', '- scope: parser only', '- authority: Sam', '- stated by the user: no API keys', '- inferred (not confirmed; do not build on these alone): keep the CLI']) assert.ok(p.includes(s), s);
  assert.ok(p.includes(`Source spec (primary) governs parser: the spec. Path: ${job.sources[0].path}\n<<<spec\nline two\nthe parser must accept UTF-8\nspec>>>`));
  assert.ok(!p.includes('READ AND LOOK AT THESE FIRST'));
  assert.ok(p.includes('- C-T: the suite passes [tests: make test]'));
  assert.ok(p.includes('You own ONLY these paths; edit nothing else:\n- src/parser'));
  assert.ok(p.includes('Your contract can express: edit.'));
  assert.ok(p.includes('The acceptance criteria you help satisfy:\n- C-T: the suite passes (needs edit)'));
  assert.ok(p.includes('Read-only to you:\n- src/api.h (frozen)'));
  assert.ok(p.includes('- S1 between A and B: owned by B; report problems, do not edit across it'));
  assert.ok(p.includes('- /out/a.txt'));
  assert.ok(p.includes('- [HARD R1] crash on BOM (frames 3)'));
  assert.ok(p.includes('- UTF-8 BOM appears in fixtures [source: run 3]'));
  assert.ok(!p.includes('ui only'));
  assert.ok(p.includes('Note from the coordinator: go'));
  assert.ok(p.endsWith('OUTSIDE-SCOPE: <what you could not fix because another atom or a contract owns it, or "none">'));
  const b = compileAtom(job, 'B', { offline: true });
  assert.ok(b.includes(`READ AND LOOK AT THESE FIRST. They govern your work; match them:\n- look governs ui: the look. Path: ${job.references[0].path}. Look at: /thumbs/a.png, /thumbs/b.png`));
  assert.ok(b.includes('S1 between A and B: you own it; keep both sides consistent'));
  assert.ok(!b.includes('Round'));
  job.references[0].private = true;
  assert.ok(compileAtom(job, 'B').includes('Private: view locally, never copy it into git or the output'));
  job.atoms[0].sources = ['spec'];
  assert.ok(compileAtom(job, 'A', { offline: true }).includes(`Path: ${job.sources[0].path} (read it before you start)`));
  assert.throws(() => compileAtom(job, 'Z'), /job demo has no atom Z/);
});

test('compileAtom quotes the interfaces an atom declares or imports, verbatim', () => {
  const repo = path.join(tmp, 'repo-compile');
  write('repo-compile/src/api.h', ['int a;', 'struct api {', '  int f(void);', '}', 'int tail;'].join('\n'));
  write('repo-compile/src/parser/main.c', '#include "api.h"\n');
  const job = makeJob('code', { repo, interfaces: [{ id: 'API', file: 'src/api.h', start: '^struct api', what: 'the API' }] });
  job.atoms[0].files = ['src/parser/main.c'];
  const p = compileAtom(job, 'A');
  assert.ok(p.includes('INTERFACES, verbatim from the source files (build to these exactly; never from memory):\n<<<API (src/api.h): the API\nstruct api {\n  int f(void);\n}\nAPI>>>'));
  assert.ok(!compileAtom(job, 'B').includes('INTERFACES'));
  assert.ok(!compileAtom(job, 'A', { offline: true }).includes('INTERFACES'));
});

test('compileAll hashes each prompt and the set, and the set hash follows any prompt change', () => {
  const job = makeJob('code');
  const one = compileAll(job, { offline: true }), two = compileAll(job, { offline: true });
  assert.deepEqual(Object.keys(one.prompts), ['A', 'B']);
  for (const id of ['A', 'B']) assert.match(one.atoms[id], /^[0-9a-f]{64}$/);
  assert.equal(one.manifestHash, two.manifestHash);
  const three = compileAll(job, { offline: true, note: 'changed' });
  assert.notEqual(one.manifestHash, three.manifestHash);
  assert.notEqual(one.atoms.A, three.atoms.A);
});

test('knowledgeFor matches tags case-insensitively against the atom, its aspects and capabilities', () => {
  const job = { knowledge: [{ text: 'a', tags: ['A'] }, { text: 'b', tags: ['PARSER'] }, { text: 'c', tags: ['edit'] }, { text: 'd' }, { text: 'e', tags: ['other'] }] };
  assert.deepEqual(knowledgeFor(job, { id: 'a', aspects: ['parser'], capabilities: ['EDIT'] }).map((k) => k.text), ['a', 'b', 'c', 'd']);
  assert.deepEqual(knowledgeFor({}, { id: 'a' }), []);
});

test('cardHash covers what the user confirms, ignores key order and gate approvals, and follows every confirmed field', () => {
  const job = makeJob('code', { gates: [{ id: 'G1', what: 'review', who: 'Sam', criticalPath: false }] });
  const h = cardHash(job);
  assert.match(h, /^[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(job).reverse());
  reordered.goal = { at: job.goal.at, by: job.goal.by, verbatim: job.goal.verbatim };
  assert.equal(cardHash(reordered), h);
  assert.equal(cardHash({ ...job, gates: [{ ...job.gates[0], approval: { via: 'direct' } }], proofs: { smoke: {} }, notes: '/elsewhere' }), h);
  for (const k of ['title', 'kind', 'goal', 'brief', 'sources', 'references', 'truth', 'criteria', 'atoms', 'contracts', 'seams', 'criticalPath', 'rival', 'deadline'])
    assert.notEqual(cardHash({ ...job, [k]: 'changed' }), h, k);
  assert.notEqual(cardHash({ ...job, gates: [{ ...job.gates[0], who: 'Kim' }] }), h);
});

test('confirmationOf accepts only a direct confirmation of this exact card', () => {
  const job = makeJob('code');
  assert.equal(confirmationOf(job), null);
  assert.match(confirmationOf({ ...job, confirmed: { via: 'relay' } }).why, /confirmed via relay/);
  assert.match(confirmationOf({ ...job, confirmed: { via: 'direct' } }).why, /cardSha256/);
  assert.match(confirmationOf({ ...job, confirmed: { via: 'direct', cardSha256: '0'.repeat(64) } }).why, /changed after the user confirmed/);
  assert.deepEqual(confirmationOf({ ...job, proofs: { confirmed: { via: 'direct', cardSha256: cardHash(job) } } }), { ok: true });
  const v = validate({ ...job, proofs: { confirmed: { via: 'direct', cardSha256: cardHash(job) } } }, { gate: 'decide', offline: true });
  assert.ok(!v.errors.some((e) => e.inv === 'I1'));
});

test('renderCard shows the goal, the brief, what governs what, atoms, acceptance, invariants and the hash to confirm', () => {
  const job = makeJob('code', {
    gates: [{ id: 'G1', what: 'final | review', who: 'Sam', criticalPath: true }],
    truth: [{ id: 'T1', what: 'golden files', tolerance: 'exact', path: '/data/golden' }],
    seams: [{ id: 'S1', between: ['A', 'B'], owner: 'B' }], contracts: [{ path: 'src/api.h', owner: 'frozen' }],
  });
  job.goal.verbatim = 'accept a|b\nand c';
  job.atoms[0].speculate = 2;
  job.criteria[0].check.proxy = false;
  const v = validate(job, { gate: 'decide', offline: true, volatile: [] });
  const card = renderCard(job, v, [{ from: 'job-1', text: 'smoke first', fix: 'run smoke' }]);
  assert.ok(card.startsWith('# Job card: Demo job (code)\n\n> accept a\\|b and c\n> — Sam, 2026-11-01\n'));
  assert.ok(card.includes('| objective | parse UTF-8 |'));
  assert.ok(card.includes('| inferred (check these) | keep the CLI |'));
  assert.ok(card.includes(`| spec | primary source | parser | \`${job.sources[0].path}\` |`));
  assert.ok(card.includes(`| look | reference | ui | \`${job.references[0].path}\` |`));
  assert.ok(card.includes('![look](/thumbs/a.png)\n![look](/thumbs/b.png)'));
  assert.ok(card.includes('- T1: golden files, tolerance exact (`/data/golden`)'));
  assert.ok(card.includes('| A (critical path) x2 | claude | parser | spec | src/parser | C-T | edit |'));
  assert.ok(card.includes('Seams: S1 (A, B) → B. Contracts: src/api.h → frozen.'));
  assert.ok(card.includes('| C-T: the suite passes | tests | no | - | A (edit) |'));
  assert.ok(card.includes('Human gates: G1 final \\| review (Sam, ON the critical path).'));
  assert.ok(card.includes('Rival: rewrite from scratch. Deadline: 2026-12-01T00:00:00Z.'));
  assert.match(card, /## Invariants\nI1 BROKEN · I2 holds · /);
  assert.ok(card.includes('POODO gates: Pontificate passed → Observe passed → Orient passed → Decide refused → Orchestrate not checked → Loop not checked'));
  assert.match(card, /\nRefused:\n(- decide I\d+: .*\n)*- decide I1: the job card has not been confirmed by the user/);
  assert.ok(card.includes('## Open lessons from earlier code jobs\n- [job-1] smoke first → run smoke'));
  assert.ok(card.endsWith(`Confirm this card (sha256 \`${cardHash(job).slice(0, 12)}\`) or correct it. Nothing launches before your confirmation.\n`));
});

test('interfaceText resolves numeric and regex bounds against the job repository, or returns null', () => {
  const repo = path.join(tmp, 'repo-src');
  write('repo-src/a.ts', ['// head', 'export interface A {', '  x: number;', '};', 'export const B = 1;', 'tail'].join('\n'));
  const job = { repo };
  assert.equal(interfaceText(job, { file: 'a.ts', start: 2 }), 'export interface A {\n  x: number;\n};');
  assert.equal(interfaceText(job, { file: 'a.ts', start: '^export const B', end: '^export const B' }), 'export const B = 1;');
  assert.equal(interfaceText(job, { file: 'a.ts', start: 'interface A', end: 3 }), 'export interface A {\n  x: number;');
  assert.equal(interfaceText(job, { file: 'a.ts', start: '^tail' }), 'tail');
  assert.equal(interfaceText(job, { file: path.join(repo, 'a.ts'), start: 5, end: 6 }), 'export const B = 1;\ntail');
  assert.equal(interfaceText(job, { file: 'a.ts', start: 'nothing matches' }), null);
  assert.equal(interfaceText(job, { file: 'absent.ts', start: 1 }), null);
});

test('imports and interfacesFor give an atom the interfaces it declares, reads or imports', () => {
  const repo = path.join(tmp, 'repo-imp');
  write('repo-imp/x/use.mjs', "import { A } from '../lib/shape.mjs';\n");
  write('repo-imp/x/other.mjs', 'const shape = 1;\n');
  const job = { repo, interfaces: [{ id: 'I-shape', file: 'lib/shape.mjs', start: 1 }, { id: 'I-z', file: 'lib/z.mjs', start: 1 }, { id: 'I-r', file: 'lib/r.mjs', start: 1 }] };
  assert.equal(imports(job, { files: ['x/use.mjs'] }, 'lib/shape.mjs'), true);
  assert.equal(imports(job, { files: ['x/other.mjs'] }, 'lib/shape.mjs'), false);
  assert.equal(imports(job, { files: ['x/absent.mjs'] }, 'lib/shape.mjs'), false);
  const atom = { files: ['x/use.mjs'], interfaces: ['I-z'], reads: ['lib/r.mjs'] };
  assert.deepEqual(interfacesFor(job, atom).map((i) => i.id), ['I-shape', 'I-z', 'I-r']);
  assert.deepEqual(interfacesFor(job, atom, { offline: true }).map((i) => i.id), ['I-z', 'I-r']);
});

test('select walks dotted paths with [*] and duplicatedFacts finds values copied out of their source', () => {
  const doc = { items: [{ start: 120, tag: 'a' }, { start: 450 }, { other: 1 }], meta: { v: '1.5' } };
  assert.deepEqual(select(doc, 'items[*].start'), [120, 450]);
  assert.deepEqual(select(doc, 'meta.v'), ['1.5']);
  assert.deepEqual(select(doc, 'items'), [doc.items]);
  assert.deepEqual(select(doc, 'missing[*].x'), []);
  assert.deepEqual(select(doc, 'items[0]'), []);
  const repo = path.join(tmp, 'repo-facts');
  write('repo-facts/data/cues.json', JSON.stringify(doc));
  write('repo-facts/src/copy.js', 'const cues = [120, 450];\n');
  write('repo-facts/src/derived.js', 'const cues = load("cues.json"); const x = 1120;\n');
  const job = { repo, facts: [{ id: 'cues', source: 'data/cues.json', select: 'items[*].start' }, { id: 'inline', values: ['1.5', '7'], source: 'data/cues.json' }],
    atoms: [{ id: 'A', files: ['src/copy.js', 'src/derived.js', 'data/cues.json', 'src/absent.js'] }] };
  assert.deepEqual(duplicatedFacts(job), [{ fact: 'cues', atom: 'A', file: 'src/copy.js', values: ['120', '450'], count: 2 }]);
  write('repo-facts/src/copy.js', 'const v = 1.5;\n');
  assert.deepEqual(duplicatedFacts(job), [{ fact: 'inline', atom: 'A', file: 'src/copy.js', values: ['1.5'], count: 1 }]);
});

test('loadJob merges the proofs file beside the manifest, keeping the manifest calibration it does not override', () => {
  assert.equal(proofsFile('/j/job.json'), '/j/job.proofs.json');
  assert.equal(proofsFile('/j/job'), '/j/job.proofs.json');
  const f = write('load/job.json', JSON.stringify({ id: 'j', proofs: { smoke: { engines: { claude: true } }, calibration: { 'C-1': { good: 0, bad: 2 } } } }));
  assert.deepEqual(loadJob(f).proofs, { smoke: { engines: { claude: true } }, calibration: { 'C-1': { good: 0, bad: 2 } } });
  fs.writeFileSync(proofsFile(f), JSON.stringify({ lessons: { retrieved: 3 }, calibration: { 'C-2': { good: 0, bad: 1 } } }));
  assert.deepEqual(loadJob(f).proofs, { smoke: { engines: { claude: true } }, lessons: { retrieved: 3 }, calibration: { 'C-1': { good: 0, bad: 2 }, 'C-2': { good: 0, bad: 1 } } });
  assert.throws(() => loadJob(path.join(tmp, 'load/absent.json')), { code: 'ENOENT' });
});
