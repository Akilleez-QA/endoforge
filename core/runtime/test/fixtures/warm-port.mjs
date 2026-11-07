import assert from 'node:assert/strict';
import { createPort as identityPort } from './identity-port.mjs';

let warmed = null;
export async function warm({ value, fail, hang }) {
  if (hang) {
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  if (fail) throw new Error('synthetic warm failure');
  warmed = value;
}

export async function createPort({ expectWarm } = {}) {
  assert.equal(warmed, expectWarm ?? null);
  return identityPort();
}
