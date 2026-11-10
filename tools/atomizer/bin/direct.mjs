#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../lib/validate.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2); const get = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const USAGE = 'usage: direct.mjs <need.md> --out <atoms.json> [--model sonnet|opus] [--effort low|medium|high] [--policy file]\n(defaults: --model sonnet, no --effort, the atomizer policy.json)';
const needPath = argv[0]; const out = get('out'); if (!needPath || needPath.startsWith('--') || !out || out.startsWith('--')) { console.error(USAGE); process.exit(2); }
if (argv.includes('--policy') && (!get('policy') || get('policy').startsWith('--'))) { console.error('--policy needs a file'); console.error(USAGE); process.exit(2); }
const POLICY_FILE = get('policy') ? path.resolve(get('policy')) : path.join(HERE, '..', 'policy.json');
let policy, POLICY;
try { const text = fs.readFileSync(POLICY_FILE); policy = JSON.parse(text.toString('utf8')); if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('not a JSON object'); POLICY = { path: POLICY_FILE, sha256: crypto.createHash('sha256').update(text).digest('hex') }; } catch (e) { console.error(`unreadable policy ${POLICY_FILE}: ${e.message}`); console.error(USAGE); process.exit(2); }
const text = fs.readFileSync(needPath, 'utf8'); const id = (text.match(/^# Request (\S+)/m) ?? [, path.basename(needPath, '.md')])[1];
const doc = { schema: 'endoforge/atoms/1', need: { id, text: text.trim() }, arm: 'direct', policy: POLICY,
  acceptance: [{ id: 'A1', statement: 'the direct worker produced a promotable artefact (gates G1-G9 pass)', check: { kind: 'command', run: `node -e "const g=JSON.parse(require('fs').readFileSync('/in/direct/gates.json','utf8'));process.exit(g.promotable===true?0:1)"` } }],
  atoms: [{ id: 'direct', kind: 'direct', title: 'Whole capability in one worker', contract: 'Produce a promotable capability for the need: frozen CONTRACT.md ending with its capability block, which declares the layout of every record, list or text value, and tests.json, kernel.ts compiled to kernel.wasm, glue.json, gate record; repairs limited to kernel and glue, at most three rounds.',
    inputs: [{ from: 'need' }], outputs: ['kernel.wasm', 'kernel.wat', 'kernel.ts', 'CONTRACT.md', 'tests.json', 'glue.json', 'gates.json', 'frozen.sha256'].map((p) => ({ name: p.replace(/\W+/g, '-'), path: p })),
    verify: 'gates.json promotable', worker: { model: get('model') ?? 'sonnet', tools: ['Bash', 'Read', 'Write', 'Edit'], ...(get('effort') ? { effort: get('effort') } : {}), prompt: 'Do the whole job yourself, in order, following the fixed procedure exactly.' }, size: { work: 3, interface: 1 } }] };
const v = validate(doc, policy); doc.valid = v.ok; doc.errors = v.errors;
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(doc, null, 1));
if (!v.ok) { console.error(`direct plan fails policy ${POLICY_FILE}:\n${v.errors.map((e) => '- ' + e).join('\n')}`); process.exit(1); }
console.log(out);
