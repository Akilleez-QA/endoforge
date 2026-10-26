// runLessons: the measurements each run receipt carries (failed launches, retries, failovers, slowest atom, queue waits).
import assert from 'node:assert/strict';
import { runLessons } from '../lib/lessons.mjs';
const t = (s) => new Date(Date.UTC(2026, 9, 26, 12, 0, s)).toISOString();
const L = runLessons({
  a: { wallMs: 900, readyAt: t(0), startedAt: t(0), attempts: [{ attempt: 1, ok: true, exit: 0, wallMs: 900 }] },
  b: { wallMs: 4000, readyAt: t(0), startedAt: t(5), attempts: [
    { attempt: 1, ok: false, exit: 1, wallMs: 1000, stderrTail: 'boom\nERROR: 429 Too Many Requests\n', failovers: [{ account: 'default', class: 'rate' }] },
    { attempt: 2, ok: true, exit: 0, wallMs: 3000, failovers: [] }] },
  c: { wallMs: 50, readyAt: t(1), startedAt: t(3), attempts: [{ attempt: 0, preflight: true, ok: true }, { attempt: 1, ok: false, exit: null, signal: 'SIGKILL', timedOut: true, wallMs: 50 }] },
}, { throttled: 2 });
assert.deepEqual(L.failedLaunches, [{ atom: 'b', attempt: 1, exit: 1, reason: 'ERROR: 429 Too Many Requests' }, { atom: 'c', attempt: 1, exit: null, signal: 'SIGKILL', timedOut: true, reason: null }]);
assert.deepEqual(L.retries, [{ atom: 'b', attempts: 2 }]);              // c's preflight is not a retry
assert.deepEqual(L.failovers, [{ atom: 'b', account: 'default', class: 'rate' }]);
assert.deepEqual(L.slowestAtom, { atom: 'b', wallMs: 4000 });
assert.deepEqual(L.queueWaits, { totalMs: 7000, max: { atom: 'b', ms: 5000 }, throttled: 2 });
assert.deepEqual(runLessons({}), { failedLaunches: [], retries: [], failovers: [], slowestAtom: null, queueWaits: { totalMs: 0, max: null, throttled: 0 } });
console.log('PASS runLessons');
