import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { availableGb, headroom, limits } from '../headroom.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-headroom-test-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const cpus = os.availableParallelism?.() ?? os.cpus().length;

test('limits default to 0.875 of the CPUs and the larger of 8 GiB and 12% of RAM', () => {
  const { maxLoad, reserveGb } = limits({});
  assert.equal(maxLoad, +(cpus * 0.875).toFixed(1));
  assert.equal(reserveGb, Math.max(8, Math.floor((os.totalmem() / 2 ** 30) * 0.12)));
});

test('ENDOFORGE_MAX_LOAD and ENDOFORGE_RESERVE_GB override the limits; junk falls back to the defaults', () => {
  assert.deepEqual(limits({ ENDOFORGE_MAX_LOAD: '3.5', ENDOFORGE_RESERVE_GB: '2' }), { maxLoad: 3.5, reserveGb: 2 });
  assert.deepEqual(limits({ ENDOFORGE_MAX_LOAD: 'many', ENDOFORGE_RESERVE_GB: '' }), limits({}));
});

test('headroom is ok only when the load is below maxLoad and available memory is at least reserveGb', () => {
  const env = { ENDOFORGE_MAX_LOAD: '4', ENDOFORGE_RESERVE_GB: '8' };
  assert.deepEqual(headroom(env, { load1: 1.234, availGb: 20.04 }), { ok: true, load1: 1.23, availGb: 20, maxLoad: 4, reserveGb: 8 });
  assert.equal(headroom(env, { load1: 4, availGb: 20 }).ok, false);
  assert.equal(headroom(env, { load1: 1, availGb: 7.9 }).ok, false);
  assert.equal(headroom(env, { load1: 1, availGb: 8 }).ok, true);
});

test('ENDOFORGE_THROTTLE=0 turns the check off whatever the sample', () => {
  assert.deepEqual(headroom({ ENDOFORGE_THROTTLE: '0' }, { load1: 1e6, availGb: 0 }), { ok: true, off: true });
  assert.equal(headroom({ ENDOFORGE_THROTTLE: '1', ENDOFORGE_MAX_LOAD: '1' }, { load1: 1e6, availGb: 1e6 }).ok, false);
});

test('availableGb reads MemAvailable in GiB and falls back to free memory without it', () => {
  const meminfo = path.join(tmp, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:       33554432 kB\nMemFree:         1048576 kB\nMemAvailable:    4194304 kB\n');
  assert.equal(availableGb(meminfo), 4);
  fs.writeFileSync(meminfo, 'MemTotal:       33554432 kB\n');
  const fallback = availableGb(meminfo), free = os.freemem() / 2 ** 30;
  assert.ok(Math.abs(fallback - free) < 1, `${fallback} vs ${free}`);
  assert.ok(availableGb(path.join(tmp, 'missing')) > 0);
});

test('the default sample is this machine\'s load and memory', () => {
  const r = headroom({ ENDOFORGE_MAX_LOAD: '1000000', ENDOFORGE_RESERVE_GB: '0.000001' });
  assert.equal(r.ok, true);
  assert.equal(typeof r.load1, 'number');
  assert.ok(r.availGb >= 0);
});
