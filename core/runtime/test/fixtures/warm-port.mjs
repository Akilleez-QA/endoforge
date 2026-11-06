import assert from 'node:assert/strict';
import { createPort as identityPort } from './identity-port.mjs';

let warmed = null;
export async function warm({ value, fail }) {
  if (fail) throw new Error('synthetic warm failure');
  warmed = value;
}

export async function createPort({ expectWarm } = {}) {
  assert.equal(warmed, expectWarm ?? null);
  return identityPort();
}
