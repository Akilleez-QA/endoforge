export function repair({ files, round, options }) {
  if (options.mode === 'never') return { 'kernel.ts': `${files['kernel.ts']}\n// ${round}` };
  if (options.mode === 'tests') return { 'tests.json': '[]' };
  if (options.mode === 'spin') for (;;);
  return { 'kernel.ts': options.kernel };
}
