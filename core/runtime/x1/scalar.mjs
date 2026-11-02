export function filterScalarTests(contract, tests) {
  const signatures = new Map();
  for (const match of contract.matchAll(/\b(?:(export\s+(?:function\s+)?|function\s+))?([A-Za-z_]\w*)\s*\(([^()\n]*)\)\s*(?:(?::|->)\s*([A-Za-z_]\w*))?/g)) {
    const [, declaration, fn, parameters, result] = match;
    if (!declaration && !result && !parameters.includes(':')) continue;
    const integer = parameters.split(',').map(p => /^[A-Za-z_]\w*\s*:\s*(?:[iu](?:8|16|32|64)|[iu]size|int|integer)\s*$/i.test(p.trim()));
    const previous = signatures.get(fn);
    signatures.set(fn, previous ? integer.map((v, i) => v && previous[i]) : integer);
  }
  const dropped = [], kept = tests.filter((t, index) => {
    const reason = !Array.isArray(t?.args) || !t.args.every(Number.isFinite) ? 'non-finite-number-args'
      : t.expectError && t.args.some((v, i) => signatures.get(t.fn)?.[i] && !Number.isInteger(v)) ? 'fractional-integer-error' : null;
    if (reason) dropped.push({ id: t?.id ?? t?.name ?? index, index, fn: t?.fn ?? null, reason });
    return !reason;
  });
  const functions = new Set([...signatures.keys(), ...tests.map(t => t?.fn).filter(fn => typeof fn === 'string')]);
  const missingValueTests = [...functions].filter(fn => !kept.some(t => t.fn === fn && !t.expectError && Object.hasOwn(t, 'expect')));
  return { tests: kept, report: { droppedCount: dropped.length, dropped, missingValueTests } };
}
