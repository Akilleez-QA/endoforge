#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
command -v python3 >/dev/null
command -v bwrap >/dev/null
base='node@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e'
sudo -n docker info >/dev/null
if ! sudo -n docker image inspect "$base" >/dev/null 2>&1; then
  sudo -n docker pull "$base"
fi
python3 - <<'PY'
import json
from pathlib import Path
root = Path.cwd().parents[1]
p = root / 'experiments/P-02-compiler-in-isolate/node_modules/assemblyscript/package.json'
assert json.loads(p.read_text())['version'] == '0.28.20', 'requires existing pinned P-02 compiler'
print('Pinned base and AssemblyScript 0.28.20 available; measured runs require no network.')
PY
