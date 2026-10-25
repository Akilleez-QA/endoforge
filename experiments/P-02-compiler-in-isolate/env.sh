#!/usr/bin/env bash
# Capture environment to a JSON file. Usage: env.sh receipt/env-before.json
set -euo pipefail
cd "$(dirname "$0")"
OUT="$1"
WT=unused
node - "$OUT" "$WT" <<'EOF'
const fs = require("fs"); const { execSync } = require("child_process");
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore","pipe","ignore"] }).trim(); } catch { return null; } };
const [out, wt] = process.argv.slice(2);
const free = {}; for (const l of sh("free -b").split("\n").slice(1)) { const p=l.split(/\s+/); free[p[0].replace(":","")] = p.slice(1).map(Number); }
const env = {
  capturedAt: new Date().toISOString(),
  uname: sh("uname -a"),
  cpuModel: sh("lscpu | grep 'Model name' | sed 's/.*: *//'"),
  nproc: Number(sh("nproc")),
  loadavg: sh("cat /proc/loadavg"),
  freeBytes: free,
  node: sh("node --version"),
  npm: sh("npm --version"),
  bwrap: sh("bwrap --version"),
  assemblyscript: sh("node -e 'console.log(require(\"./node_modules/assemblyscript/package.json\").version)'"),
  binaryen: sh("node -e 'console.log(require(\"./node_modules/binaryen/package.json\").version)'"),
  gitHead: sh("git -C /home/user/Work/endoforge rev-parse HEAD"),
  gitDirty: sh("git -C /home/user/Work/endoforge status --porcelain | wc -l"),
  cpuGovernor: sh("cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor"),
  kernelManifestSha256: sh("sha256sum kernels/manifest.json | cut -d\" \" -f1"),
};
fs.writeFileSync(out, JSON.stringify(env, null, 2) + "\n");
console.log(out, env.loadavg);
EOF
