#!/usr/bin/env node
// Step 0: freeze. Working/sealed split of the 40 reserve requests (stratified by source prefix, seeded), canary packet
// (3 canaries + 3 known-clean fillers, shuffled, sheets hashed), sha256 of every fixed file and brief, tool versions.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { KIT, X1, WORK, RECEIPT, sha, shaFile, json, writeJson, requestText, now } from '../lib/runner.mjs';
import { shuffle } from '../../x1-spec-study/lib/stats.mjs';
import { renderSheet } from '../lib/sheet.mjs';

const SEED = 20261018;
const x1Freeze = json(path.join(X1, 'receipt', 'freeze.json'));
const reserve = x1Freeze.reserve;
const strata = { C: reserve.filter((id) => id.startsWith('C-')), CC: reserve.filter((id) => id.startsWith('CC-')) };
const sC = shuffle(strata.C, SEED), sCC = shuffle(strata.CC, SEED + 1);
const working = [...sC.slice(0, Math.ceil(sC.length / 2)), ...sCC.slice(0, Math.floor(sCC.length / 2))];
const sealed = [...sC.slice(Math.ceil(sC.length / 2)), ...sCC.slice(Math.floor(sCC.length / 2))];
if (working.length !== 20 || sealed.length !== 20 || new Set([...working, ...sealed]).size !== 40) throw new Error('split is not 20/20');

// Canary packet
const canaries = [
  { id: 'C-006', variant: 'v1', dir: path.join(WORK, 'canaries', 'C-006-v1'), defect: 'wrong default equipment class for an A3 (R290) charge limit', mustBe: 'not-usable', extraCalls: [] },
  { id: 'CC-011', variant: 'v2', dir: path.join(X1, 'work', 'factory', 'CC-011'), defect: 'answers a question that was not asked (divides a quote instead of pricing R-22)', mustBe: 'not-usable', extraCalls: [{ fn: 'perPoundFromTotal', args: [900, 15], why: 'the usage example: a quoted total divided by pounds' }] },
  { id: 'CC-009', variant: 'v1', dir: path.join(X1, 'work', 'factory', 'CC-009'), defect: 'nh3EvapInventoryLb(16, 1, -50) returns 556.93 with no trap outside the -40..40 F fit range', mustBe: 'usable-with-change-or-worse naming the range guard', extraCalls: [{ fn: 'nh3EvapInventoryLb', args: [16, 1, -50], why: 'operating temperature below the stated fit range' }] },
];
const fillers = ['CC-014', 'CC-025', 'CC-036'].map((id) => ({ id, variant: 'v1', dir: path.join(X1, 'work', 'factory', id), defect: null, mustBe: 'clean (hc-01 panel-clean filler)', extraCalls: [] }));
const packetDir = path.join(WORK, 'canaries', 'packet');
fs.mkdirSync(packetDir, { recursive: true });
const order = shuffle([...canaries, ...fillers], SEED + 2);
const key = []; const sheetSha = {};
order.forEach((c, i) => {
  const item = i + 1; const req = requestText(c.id);
  const { md, calls } = renderSheet(c.dir, { itemNo: item, req, extraCalls: c.extraCalls });
  fs.writeFileSync(path.join(packetDir, `ITEM-${String(item).padStart(2, '0')}.md`), md);
  writeJson(path.join(packetDir, `ITEM-${String(item).padStart(2, '0')}.calls.json`), calls);
  key.push({ item, id: c.id, variant: c.variant, canary: Boolean(c.defect), mustBe: c.mustBe });
  sheetSha[item] = sha(md);
});
writeJson(path.join(packetDir, 'key.json'), { seed: SEED + 2, key });

const fixed = {};
for (const f of ['factory/gate.mjs', 'factory/glue.schema.json', 'factory/try.mjs', 'factory/promote.mjs', 'lib/stats.mjs', 'templates/CONTRACT.md', 'receipt/freeze.json', 'RUBRIC.md']) fixed[`campaigns/x1-spec-study/${f}`] = shaFile(path.join(X1, f));
for (const f of fs.readdirSync(path.join(KIT, 'lib'))) fixed[`campaigns/hillclimb-loop-01/lib/${f}`] = shaFile(path.join(KIT, 'lib', f));
for (const f of ['manifest-incumbent.json', 'manifest-challenger.json']) fixed[`campaigns/hillclimb-loop-01/receipt/${f}`] = shaFile(path.join(RECEIPT, f));
fixed['campaigns/hillclimb-loop-01/work/canaries/C-006-v1/glue.json'] = shaFile(path.join(WORK, 'canaries', 'C-006-v1', 'glue.json'));
for (const f of ['kernel.wasm', 'CONTRACT.md', 'tests.json']) { fixed[`campaigns/hillclimb-loop-01/work/canaries/C-006-v1/${f}`] = shaFile(path.join(WORK, 'canaries', 'C-006-v1', f)); if (shaFile(path.join(WORK, 'canaries', 'C-006-v1', f)) !== shaFile(path.join(X1, 'work', 'factory-v1', 'C-006', f))) throw new Error(`C-006 v1 ${f} differs from the loop-0 artefact`); }
const briefs = Object.fromEntries(fs.readdirSync(path.join(KIT, 'briefs')).filter((f) => f.endsWith('.md')).sort().map((f) => [f, shaFile(path.join(KIT, 'briefs', f))]));
fs.writeFileSync(path.join(RECEIPT, 'briefs.sha256'), Object.entries(briefs).map(([f, h]) => `${h}  briefs/${f}`).join('\n') + '\n');
const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const tools = { node: process.version, asc: sh(`${path.join(KIT, '../../experiments/P-02-compiler-in-isolate/node_modules/.bin/asc')} --version`), claude: sh('claude --version'), codex: sh('codex --version'), wasmtime: sh('wasmtime --version'), kernel: sh('uname -r'), cpu: sh("grep -m1 'model name' /proc/cpuinfo | cut -d: -f2").trim?.(), git: sh(`git -C ${KIT} rev-parse HEAD`) };
const freeze = {
  at: now(), loop: 1, seed: SEED,
  splitRule: 'the 40 reserve ids of campaigns/x1-spec-study/receipt/freeze.json (seed 20261017), stratified by source prefix (C-: 13 owner/study requests; CC-: 27 chatbot calculation requests), each stratum shuffled with lib/stats.mjs shuffle (mulberry32) at seed 20261018 (C-) and 20261019 (CC-); working = first 7 C- and first 13 CC-, sealed = the rest (6 C-, 14 CC-)',
  development: x1Freeze.primary, working, sealed,
  poolSha256: x1Freeze.pool ? sha(JSON.stringify(x1Freeze.pool)) : null,
  canaries: { packetSeed: SEED + 2, keySha256: sha(JSON.stringify({ seed: SEED + 2, key })), items: key.map((k) => ({ item: k.item, sheetSha256: sheetSha[k.item] })), definitions: canaries.map(({ dir, ...c }) => ({ ...c, source: path.relative(path.join(KIT, '../..'), dir) })), fillers: fillers.map((f) => f.id), recallRule: 'a canary is caught when at least two of the three oracles flag it as required (C-006 v1 and CC-011: not-usable; CC-009: usable-with-change or not-usable with the reason naming the range or the -50 F call); 3/3 or the loop is void; a filler counted against the oracle that calls it not-usable (false reject)', note: 'C-006 v1 has no glue in loop 0; the sheet uses a coordinator-written glue that restates the v1 contract and outcome (work/canaries/C-006-v1/PROVENANCE.md); kernel, contract and tests are byte copies' },
  fixed, briefs, tools,
  models: { incumbent: 'claude-opus-5-5 via claude -p (CLI default), --effort low; third noise arm at default effort', challenger: 'claude-sonnet-5-5 for stub (low), contract persona, evaluator, blind candidates; claude-opus-5-5 default for escalation', personaStage: 'claude-sonnet-5-5', oracles: { 'oracle-sonnet': 'claude-sonnet-5-5 technician', 'oracle-opus': 'claude-opus-5-5 reviewer', 'oracle-codex': 'codex exec gpt-6.1-sol (config.toml) reasoning high, technician' } },
  budget: { targetTokens: 8_000_000, hardStopTokens: 12_000_000, meter: 'receipt/tokens.jsonl: one line per CLI call; total = input + cache_read + cache_creation + output (thinking is inside output)' },
};
writeJson(path.join(RECEIPT, 'freeze.json'), freeze);
fs.writeFileSync(path.join(RECEIPT, 'freeze.sha256'), `${shaFile(path.join(RECEIPT, 'freeze.json'))}  receipt/freeze.json\n`);
console.log(JSON.stringify({ working, sealed, canaryPacket: key, briefs: Object.keys(briefs).length, fixed: Object.keys(fixed).length, tools }, null, 1));
