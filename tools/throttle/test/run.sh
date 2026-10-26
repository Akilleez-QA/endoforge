#!/usr/bin/env bash
# Tests for tools/throttle: limits scale with the hardware, heavy-run waits for slots and headroom, runs in heavy.slice,
# and the scheduler's headroom check. The live parts need systemd user units; they are skipped without them.
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd); hr=$here/heavy-run; fails=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
lim() { HEAVY_THREADS=$1 HEAVY_RAM_GB=$2 "$hr" --limits; }
check 'rig (32 threads, 124 GB)' '[[ $(lim 32 124) == "threads=32 ram=124G max_load=28.0 reserve=14G slots=2 slice_high=55G slice_max=71G cpu_quota=1792%" ]]'
check 'laptop (8 threads, 16 GB)' '[[ $(lim 8 16) == "threads=8 ram=16G max_load=7.0 reserve=8G slots=1 slice_high=7G slice_max=9G cpu_quota=448%" ]]'
check 'big box (128 threads, 512 GB)' '[[ $(lim 128 512) == *"slots=10"* && $(lim 128 512) == *"max_load=112.0"* ]]'
check 'overrides win' '[[ $(HEAVY_SLOTS=5 HEAVY_MAX_LOAD=9 lim 32 124) == *"max_load=9 "*"slots=5 "* ]]'
if systemctl --user show-environment >/dev/null 2>&1 && command -v systemd-run >/dev/null; then
  export XDG_STATE_HOME=$(mktemp -d)
  check 'runs in heavy.slice' '[[ $("$hr" --name t1 -- grep -o "heavy.slice/[^/]*" /proc/self/cgroup) == heavy.slice/heavy-t1-* ]]'
  check 'nested call runs directly' '[[ $("$hr" --name t2 -- "$hr" --name t3 -- grep -o "heavy-t[23]" /proc/self/cgroup) == heavy-t2 ]]'
  HEAVY_RESERVE_GB=100000 timeout 4 "$hr" --name t4 -- true 2>/dev/null; check 'waits for headroom' '[[ $? == 124 ]]'
  HEAVY_SLOTS=1 "$hr" --name hold -- sleep 5 & sleep 1.5
  HEAVY_SLOTS=1 timeout 3 "$hr" --name t5 -- true 2>/dev/null; check 'waits for a slot' '[[ $? == 124 ]]'; wait
  check 'starts once the slot frees' 'HEAVY_SLOTS=1 timeout 30 "$hr" --name t6 -- true 2>/dev/null'
  check 'slice sized for this machine' 'head -1 "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/heavy.slice" | grep -q "threads=$(nproc)"'
  rm -rf "$XDG_STATE_HOME"
else echo "SKIP live heavy-run checks (no systemd user manager)"; fi
node --input-type=module -e "
import { headroom, limits } from '$here/throttle.mjs';
const env = { ENDOFORGE_MAX_LOAD: '28', ENDOFORGE_RESERVE_GB: '15' }; let bad = 0;
const t = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) bad++; };
t('scheduler: room when calm', headroom(env, { load1: 10, availGb: 60 }).ok);
t('scheduler: holds on load', !headroom(env, { load1: 30, availGb: 60 }).ok);
t('scheduler: holds on memory', !headroom(env, { load1: 10, availGb: 9 }).ok);
t('scheduler: off switch', headroom({ ENDOFORGE_THROTTLE: '0' }, { load1: 999, availGb: 0 }).ok);
t('scheduler: limits scale with this machine', limits({}).maxLoad > 0 && limits({}).reserveGb >= 8);
process.exit(bad);
" || fails=$((fails+1))
(cd "$here" && python3 -B -m unittest -q test.test_gpu_queue) || fails=$((fails+1))
exit $fails
