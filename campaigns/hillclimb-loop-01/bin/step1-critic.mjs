#!/usr/bin/env node
// Step 1: the deviation critic, a fresh Codex (GPT-6.1) agent in a sealed read-only directory holding the spec, the method,
// the loop-0 receipts and the design draft. It proposes >= 7 deviations; the coordinator ranks and records them in
// receipt/deviations.md and puts the top affordable one into the precommit.
import fs from 'node:fs';
import path from 'node:path';
import { KIT, REPO, X1, WORK, RECEIPT, callCodex, shaFile, writeJson, now } from '../lib/runner.mjs';

const SEALED = path.join(WORK, 'critic', 'sealed');
fs.rmSync(SEALED, { recursive: true, force: true }); fs.mkdirSync(SEALED, { recursive: true });
const inputs = {
  'SPEC-Endoforge-Edition-3.txt': path.join(REPO, 'sources/text/Endoforge-Edition-3.txt'),
  'EDITION-3-ERRATA.md': path.join(REPO, 'docs/coverage/EDITION-3-ERRATA.md'),
  'HILLCLIMB-METHOD.md': path.join(REPO, 'docs/execution/HILLCLIMB-METHOD.md'),
  'factory-README.md': path.join(X1, 'factory/README.md'),
  'LESSONS-LOG.md': path.join(REPO, 'docs/execution/LESSONS-LOG.md'),
  'loop0-factory-summary.json': path.join(X1, 'receipt/factory-summary.json'),
  'loop0-persona-review-summary.md': path.join(X1, 'receipt/persona-review-summary.md'),
  'loop0-hc-01-RESULT.md': path.join(X1, 'receipt/human-calibration/hc-01/RESULT.md'),
  'loop0-freeze.json': path.join(X1, 'receipt/freeze.json'),
  'P-04b-RESULT.md': path.join(REPO, 'experiments/P-04b-bare-api-model-term/RESULT.md'),
  'LOOP1-DESIGN-DRAFT.md': path.join(RECEIPT, 'design-draft-v1.md'),
};
const sha = {};
for (const [name, src] of Object.entries(inputs)) { fs.copyFileSync(src, path.join(SEALED, name)); sha[name] = shaFile(src); }
const brief = fs.readFileSync(path.join(KIT, 'briefs', 'deviation-critic-v1.md'), 'utf8');
const t0 = Date.now();
const res = await callCodex(brief, { stage: 'deviation', request: 'all', tag: 'critic' }, { cwd: SEALED, reasoning: 'high', timeoutMs: 2_400_000 });
fs.writeFileSync(path.join(RECEIPT, 'deviations-critic-raw.md'), `<!-- Deviation critic output, Codex CLI (${res.model}), reasoning high, sealed read-only directory; call ${res.callId}; ${now()} -->\n\n` + res.text);
writeJson(path.join(RECEIPT, 'deviations-critic.json'), { at: now(), callId: res.callId, model: res.model, usage: res.usage, wall_s: (Date.now() - t0) / 1000, briefSha256: shaFile(path.join(KIT, 'briefs', 'deviation-critic-v1.md')), inputs: sha, outputSha256: shaFile(path.join(RECEIPT, 'deviations-critic-raw.md')) });
console.log(JSON.stringify({ callId: res.callId, model: res.model, usage: res.usage, wall_s: (Date.now() - t0) / 1000, chars: res.text.length }));
