// Craig, 2026-10-26: "dont start dumping very specific crap into the tools it has to be universal, first principles
// only". Core tool code holds universal mechanism only; job and domain specifics are data (manifests, kinds/*.json,
// examples, fixtures, tests). This test keeps it that way: it fails when a domain term appears in core code.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CORE = ['lib', 'job/lib', 'job/bin', 'conductor/lib', 'conductor/bin'];
const TERMS = /\b(mr\.? ?ton|mrton|mr\.? ?btu|rai-reta|lumberjack|likeness|camera|glow|colou?r|video|campus|lidar|stills|beats?)\b/i;
const hits = [];
for (const d of CORE) for (const f of fs.readdirSync(path.join(TOOLS, d)).filter((x) => x.endsWith('.mjs'))) {
  fs.readFileSync(path.join(TOOLS, d, f), 'utf8').split('\n').forEach((l, i) => { if (TERMS.test(l)) hits.push(`${d}/${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
}
assert.deepEqual(hits, [], `domain terms in core tool code (move them to data):\n${hits.join('\n')}`);
console.log(`PASS no domain terms in ${CORE.join(', ')}`);
