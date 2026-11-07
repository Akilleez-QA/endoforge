const [modulePath, heapMb] = process.argv.slice(-3);
const ivm = require(`${modulePath}/node_modules/isolated-vm`);
let bootstrap;
const run = async ({ id, job, deadlineMs }) => {
  const isolate = new ivm.Isolate({ memoryLimit: Number(heapMb) });
  let text;
  try {
    const context = await isolate.createContext();
    const policy = JSON.stringify({ grants: job.grants, ports: job.ports, outputMaxBytes: job.outputMaxBytes, entry: job.entry, exportName: job.exportName, input: job.input });
    await context.global.set('__policy', policy);
    const setup = await isolate.compileScript(`const __g = (${bootstrap})(() => '{"refused":"no port in this arm"}', globalThis.__policy); delete globalThis.__policy; globalThis.__collect = __g.collect; globalThis.__register = __g.register;`);
    await setup.run(context);
    const compiled = [];
    for (const [path, source] of Object.entries(job.modules)) compiled.push(await isolate.compileScript(`globalThis.__register(${JSON.stringify(path)}, function (exports, require, module) {${source}\n});`));
    for (const script of compiled) await script.run(context);
    const start = await isolate.compileScript('{ const c = globalThis.__collect; delete globalThis.__collect; delete globalThis.__register; globalThis.__keep = c; globalThis.__ef_start(); }');
    await start.run(context, { timeout: deadlineMs });
    text = await (await isolate.compileScript('globalThis.__keep()')).run(context, { timeout: deadlineMs, copy: true });
  } catch (error) {
    const message = String(error && error.message);
    const reason = /timed out/i.test(message) ? 'deadline' : /memory limit|disposed/i.test(message) ? 'heap' : /SyntaxError|Unexpected|Invalid/.test(String(error && error.name) + message) ? 'compile' : 'host_error';
    text = JSON.stringify({ state: 'refused', reason, detail: message.slice(0, 200) });
  }
  try { if (!isolate.isDisposed) isolate.dispose(); } catch {}
  process.send({ id, text });
};
process.on('message', message => {
  if (message.type === 'bootstrap') bootstrap = message.bootstrap.trim();
  else run(message);
});
process.send({ type: 'ready' });
