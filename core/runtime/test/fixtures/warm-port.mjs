import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createPort as identityPort } from './identity-port.mjs';

let warmed = null;
export async function warm({ value, fail, hang, gate }) {
  if (gate) {
    while (!existsSync(gate)) await sleep(5);
    rmSync(gate);
  }
  if (hang) {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (fail) throw new Error('synthetic warm failure');
  warmed = value;
}

export async function createPort({ expectWarm, spin } = {}) {
  if (spin) for (;;);
  assert.equal(warmed, expectWarm ?? null);
  return identityPort();
}
