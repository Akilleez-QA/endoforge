import fs from 'node:fs';
const role = process.argv[2];
if (!['generator', 'evaluator'].includes(role)) throw new Error('unknown role');
const checks = {};
checks.requestReadable = fs.readFileSync('/in/request.md', 'utf8').length > 0;
checks.contractReadable = fs.readFileSync('/in/CONTRACT.md', 'utf8').length > 0;
for (const [name, p] of Object.entries({ testsHidden: '/in/tests.json', kernelHidden: '/in/kernel.ts', peerHidden: '/peer', hostHomeHidden: '/home/user', hostCanaryHidden: process.argv[3], dockerSocketHidden: '/var/run/docker.sock' })) {
  checks[name] = !fs.existsSync(p);
}
for (const [name, p] of Object.entries({ inputReadOnly: '/in/CONTRACT.md', gatesReadOnly: '/bundle/campaigns/x1-spec-study/factory/gate.mjs' })) {
  try { const fd = fs.openSync(p, 'r+'); fs.closeSync(fd); checks[name] = false; }
  catch (e) { checks[name] = ['EROFS', 'EACCES', 'EPERM'].includes(e.code); }
}
checks.nonRoot = process.getuid() !== 0;
fs.writeFileSync('/tmp/own-output', role);
checks.scratchWritable = fs.readFileSync('/tmp/own-output', 'utf8') === role;
console.log(JSON.stringify({ role, checks, ok: Object.values(checks).every(Boolean) }));
if (!Object.values(checks).every(Boolean)) process.exit(1);
