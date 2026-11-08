import { readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { instrument, prepared, pythonStats, random, stat } from './common.mjs';

const { output, name, bridgeModule, count, width, seed, journal } = JSON.parse(process.argv[2]);
const { streams } = JSON.parse(readFileSync(join(output, 'capture.json'), 'utf8'));
const statsDirectory = instrument(output, name);
const { LedgerBridge } = await import(pathToFileURL(bridgeModule).href);
const bridge = new LedgerBridge({ extension: 'tools.x1_loop', ...(journal ? { journal } : {}) });
const loadStart = loadavg()[0];
await bridge.start();
const next = random(seed), latency = {}, rows = [];
let cursor = 0, inFlight = 0, mostInFlight = 0;
const begin = performance.now();
await Promise.all(Array.from({ length: width }, async () => {
  while (cursor < count) {
    const index = cursor++, stream = streams[index % streams.length], state = { after: null };
    const ledger = join(output, name, `${stream.name}-${index}`, 'ledger.sqlite');
    const start = performance.now();
    let slept = 0, decision = null, error = null;
    mostInFlight = Math.max(mostInFlight, ++inFlight);
    try {
      for (const [request, step] of prepared(stream, ledger, state).map((make, i) => [make, stream.requests[i]])) {
        for (let k = 0; k < step.models; k++) { const ms = 2000 + 2000 * next(); slept += ms; await sleep(ms); }
        const [action, job, result] = request(), sent = performance.now();
        const answer = await bridge.request(action, job, result);
        (latency[action] ??= []).push(performance.now() - sent);
        if (action === 'park') state.after = answer.seq;
        if (action === 'commit') decision = answer.decision.decision;
      }
    } catch (caught) { error = caught.message; }
    inFlight -= 1;
    const wall = performance.now() - start;
    rows.push({ name: stream.name, index, expected: stream.decision, decision, accepted: decision !== null && decision === stream.decision, error, wall, model: slept, nonModel: wall - slept });
  }
}));
const wallMs = performance.now() - begin;
await bridge.close();
const loadEnd = loadavg()[0], python = pythonStats(statsDirectory);
let writer = null;
try { writer = JSON.parse(readFileSync(join(statsDirectory, 'writer.json'), 'utf8')); } catch { }
const accepted = rows.filter(row => row.accepted).length, syncs = python.reduce((total, p) => total + (p.syncs ?? 0), 0);
const summary = { name, bridgeModule: bridgeModule.replace(output, '<work>'), count, width, seed, loadStart, loadEnd, label: Math.max(loadStart, loadEnd) > 16 ? 'loaded' : 'acceptance',
  wallMs, accepted, acceptedPerSecond: accepted / (wallMs / 1000), wrong: rows.filter(row => !row.accepted).map(row => `${row.name}-${row.index}: ${row.decision ?? row.error}`).slice(0, 20),
  peakInFlight: mostInFlight, nonModel: stat(rows.map(row => row.nonModel)), latency: Object.fromEntries(Object.entries(latency).map(([action, values]) => [action, stat(values)])),
  pythonProcesses: python.length, spawnsPerCandidate: python.length / count, syncs, syncsPerCandidate: syncs / count,
  cpuSeconds: python.reduce((total, p) => total + p.user + p.system, 0), cpuMsPerCandidate: 1000 * python.reduce((total, p) => total + p.user + p.system, 0) / count,
  peakRssMiB: Math.max(0, ...python.map(p => p.max_rss_kib / 1024)), writer,
  ...(writer ? { batches: writer.batches, requestsPerBatch: writer.requests / writer.batches, journalSyncsPerBatch: writer.journal_syncs / writer.batches, journalBytesPerCandidate: writer.journal_bytes / count } : {}) };
writeFileSync(join(output, `${name}.json`), JSON.stringify({ summary, rows }));
console.log(JSON.stringify(summary));
