#!/usr/bin/env node
// The meter: per-stage, per-provider, per-model token totals from receipt/tokens.jsonl -> receipt/tokens-summary.json
import fs from 'node:fs';
import path from 'node:path';
import { RECEIPT, writeJson, now } from '../lib/runner.mjs';
const rows = fs.readFileSync(path.join(RECEIPT, 'tokens.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const add = (m, k, r) => { m[k] = m[k] || { calls: 0, total: 0, input: 0, cache_read: 0, cache_creation: 0, output: 0, thinking: 0, errors: 0, limitEvents: 0, wall_s: 0, cost_usd_list: 0 }; const x = m[k]; x.calls++; x.total += r.total; x.input += r.input; x.cache_read += r.cache_read; x.cache_creation += r.cache_creation; x.output += r.output; x.thinking += r.thinking; x.errors += r.is_error ? 1 : 0; x.limitEvents += r.limit_event ? 1 : 0; x.wall_s += (r.wall_ms || 0) / 1000; x.cost_usd_list += r.cost_usd_list || 0; };
const byStage = {}, byProvider = {}, byModel = {}, byStageTag = {};
for (const r of rows) { add(byStage, r.stage, r); add(byProvider, r.provider, r); add(byModel, `${r.provider}:${r.model}:${r.effort}`, r); add(byStageTag, `${r.stage}/${r.tag}`, r); }
const total = rows.reduce((s, r) => s + r.total, 0);
const out = { at: now(), calls: rows.length, total, target: 8_000_000, hardStop: 12_000_000, byProvider, byStage, byModel, byStageTag, costUsdListTotal: rows.reduce((s, r) => s + (r.cost_usd_list || 0), 0), firstCall: rows[0]?.at, lastCall: rows.at(-1)?.at };
writeJson(path.join(RECEIPT, 'tokens-summary.json'), out);
console.log(JSON.stringify({ calls: rows.length, total, byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, v.total])), byStage: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, v.total])) }));
