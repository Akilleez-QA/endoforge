import { connectSyncHostCall } from '../../core/runtime/isolate-pool.mjs';

const load = javascript => import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

export async function createPort({ contract, reducer, expected, state, event, buffers, limits, syncHostCall }) {
  const { probeTrustedReducer, refusal } = await load(contract);
  return {
    async evaluate() {
      try {
        const call = connectSyncHostCall(syncHostCall);
        const snapshots = Array.from({ length: buffers }, (_, index) => Object.freeze({
          size: () => call({ op: 'size', index }),
          read: (offset, length) => call({ op: 'read', index, offset, length }),
        }));
        const loaded = await load(reducer.javascript);
        if (!Object.hasOwn(loaded, reducer.exportName)) throw new Error('no reducer export');
        return { stage: 'completed', receipt: probeTrustedReducer(loaded[reducer.exportName], expected, state, event, snapshots, limits) };
      } catch (error) {
        return { stage: 'completed', receipt: refusal(error instanceof Error ? error.message : 'reducer failed to load') };
      }
    },
  };
}
