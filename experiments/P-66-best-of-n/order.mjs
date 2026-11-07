import { hash } from '../../core/runtime/x1/host.mjs';

export function seededOrder(items, seed) {
  let state = parseInt(hash(seed).slice(0, 8), 16) >>> 0;
  const next = () => { state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) >>> 0; state = (state ^ (state >>> 13)) >>> 0; return state / 2 ** 32; };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

export function needOrder(seed, needs) {
  const seen = { H: 0, R: 0 };
  return seededOrder(needs, `${seed}:order`).map((need, position) => {
    const kind = need.startsWith('H') ? 'H' : 'R';
    const split = seen[kind]++ % 2 === 0 ? 'fit' : 'heldout';
    return { need, kind, split, position };
  });
}
