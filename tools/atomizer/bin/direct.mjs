#!/usr/bin/env node
// Build a single-atom DAG for the direct arm: one worker writes contract, tests, kernel and glue, freezes, gates, repairs (loop-0 protocol), all in one isolate.
// usage: node direct.mjs <need.md> --out <atoms.json> [--model sonnet|opus] [--effort low|medium|high]
import fs from 'node:fs';
import path from 'node:path';
const argv = process.argv.slice(2); const get = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const needPath = argv[0]; const out = get('out'); if (!needPath || !out) { console.error('usage: direct.mjs <need.md> --out <atoms.json> [--model sonnet] [--effort medium]'); process.exit(2); }
const text = fs.readFileSync(needPath, 'utf8'); const id = (text.match(/^# Request (\S+)/m) ?? [, path.basename(needPath, '.md')])[1];
const doc = { schema: 'endoforge/atoms/1', need: { id, text: text.trim() }, arm: 'direct',
  acceptance: [{ id: 'A1', statement: 'the direct worker produced a promotable artefact (gates G1-G7 pass)', check: { kind: 'command', run: `node -e "const g=JSON.parse(require('fs').readFileSync('/in/direct/gates.json','utf8'));process.exit(g.promotable===true?0:1)"` } }],
  atoms: [{ id: 'direct', kind: 'direct', title: 'Whole capability in one worker', contract: 'Produce a promotable capability for the need: frozen CONTRACT.md and tests.json, kernel.ts compiled to kernel.wasm, glue.json, gate record; repairs limited to kernel and glue, at most three rounds.',
    inputs: [{ from: 'need' }], outputs: ['kernel.wasm', 'kernel.wat', 'kernel.ts', 'CONTRACT.md', 'tests.json', 'glue.json', 'gates.json', 'frozen.sha256'].map((p) => ({ name: p.replace(/\W+/g, '-'), path: p })),
    verify: 'gates.json promotable', worker: { model: get('model') ?? 'sonnet', tools: ['Bash', 'Read', 'Write', 'Edit'], ...(get('effort') ? { effort: get('effort') } : {}), prompt: 'Do the whole job yourself, in order, following the fixed procedure exactly.' }, size: { work: 3, interface: 1 } }] };
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(doc, null, 1)); console.log(out);
