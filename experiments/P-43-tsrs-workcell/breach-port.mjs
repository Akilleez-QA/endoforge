import { pathToFileURL } from 'node:url';

export async function createPort(options) {
  const { createPort: createCheck } = await import(pathToFileURL(options.checkPort).href);
  const port = await createCheck(options);
  return { ...port, describe(candidate) {
    if (options.breach) {
      const retained = [];
      for (;;) retained.push(Array.from({ length: 4096 }, () => ({ value: Math.random() })));
    }
    return port.describe(candidate);
  } };
}
