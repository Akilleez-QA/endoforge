import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyze, retail, rows } from './analyze.mjs';
import { streamTailMs } from './tail.mjs';

const receipt = fileURLToPath(new URL('./receipt/', import.meta.url));

test('overlapping waits count once: ready is the latest of last token, result and final check', () => {
  assert.equal(streamTailMs({ lastToken: 100, resultAt: 130, finalFinishedAt: 150 }), 50);
  assert.equal(streamTailMs({ lastToken: 100, resultAt: 160, finalFinishedAt: 120 }), 60);
  assert.equal(streamTailMs({ lastToken: 100, resultAt: 100, finalFinishedAt: 90 }), 0);
  assert.equal(streamTailMs({ lastToken: 100, resultAt: 140, finalFinishedAt: 140 }), 40);
});

test('the analysis recomputes the stream tail from the row timings, not the stored figure', () => {
  const turn = { lastToken: 1000, resultAt: 1030, stream: { finalFinishedAt: 1050, tailMs: 80 } };
  assert.equal(retail(turn).stream.tailMs, 50);
  assert.equal(turn.stream.tailMs, 80);
});

test('no recomputed stream tail exceeds the slower of the two waits it overlaps', () => {
  for (const name of ['h-rows.jsonl', 'p57-rows.jsonl']) {
    for (const row of rows(`${receipt}replay`, name)) for (const turn of row.turns) {
      const tail = retail(turn).stream.tailMs;
      assert.ok(tail <= Math.max(turn.resultAt - turn.lastToken, turn.stream.finalFinishedAt - turn.lastToken, 0) + 1e-9, `${row.name}:${turn.stage}`);
      assert.ok(tail >= 0);
    }
  }
});

test('receipt/replay/analysis.json is regenerated from the raw replay rows with the corrected tail', () => {
  const expected = analyze({
    h: rows(`${receipt}replay`, 'h-rows.jsonl'), seeded: rows(`${receipt}replay`, 'seeded-rows.jsonl'), p57: rows(`${receipt}replay`, 'p57-rows.jsonl'),
    hedges: rows(`${receipt}record`, 'rows.jsonl').filter(row => row.kind === 'hedge'), calls: JSON.parse(readFileSync(`${receipt}record/calls.json`, 'utf8')),
  });
  assert.deepEqual(JSON.parse(readFileSync(`${receipt}replay/analysis.json`, 'utf8')), expected);
});
