const load = javascript => import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);

export async function createPort({ contract, reducer, expected, state, event, snapshots, limits }) {
  const { probeTrustedReducer, refusal } = await load(contract);
  return {
    async evaluate() {
      try {
        const loaded = await load(reducer.javascript);
        if (!Object.hasOwn(loaded, reducer.exportName)) throw new Error('no reducer export');
        return { stage: 'completed', receipt: probeTrustedReducer(loaded[reducer.exportName], expected, state, event, snapshots, limits) };
      } catch (error) {
        return { stage: 'completed', receipt: refusal(error instanceof Error ? error.message : 'reducer failed to load') };
      }
    },
  };
}
