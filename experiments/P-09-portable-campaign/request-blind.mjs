// Additional DEC-80 check: the evaluator receives the request alone, not the contract.
import fs from 'node:fs';
const checks = { requestReadable: fs.readFileSync('/in/request.md', 'utf8').length > 0 };
for (const p of ['/in/CONTRACT.md', '/in/kernel.ts', '/in/tests.json', '/peer', '/home/user', '/var/run/docker.sock']) {
  checks[`${p}Hidden`] = !fs.existsSync(p);
}
try { const fd = fs.openSync('/in/request.md', 'r+'); fs.closeSync(fd); checks.requestReadOnly = false; }
catch (e) { checks.requestReadOnly = ['EROFS', 'EACCES', 'EPERM'].includes(e.code); }
checks.nonRoot = process.getuid() !== 0;
const ok = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ role: 'request-blind-evaluator', checks, ok }));
if (!ok) process.exit(1);
