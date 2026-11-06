import type { Reducer } from './contract.ts';

export const referenceReducer: Reducer = {
  describe: () => ({ contractVersion: '1.0.0', stateSchema: 'counter-v1',
    eventSchema: 'increment-v1', effectSchema: 'notify-v1' }),
  reduce(state, event, inputs) {
    if (state.length !== 1 || event.length !== 1 || inputs.length !== 1) {
      throw new Error('one-byte counter, increment and one buffer required');
    }
    const read = inputs[0].read(0n, 1);
    if (read.tag === 'err') throw new Error(read.value);
    const next = state[0] + event[0] + read.value[0];
    if (next > 255) throw new Error('counter overflow');
    return { state: Uint8Array.of(next),
      effects: [{ capability: 'notify', operation: 'changed', payload: event }] };
  },
};
