#!/usr/bin/env bash
# Tests for tools/throttle: limits scale with the hardware, heavy-run waits for slots and headroom, runs in heavy.slice,
# and the scheduler's headroom check. The live parts need systemd user units; they are skipped without them.
set -uo pipefail
here=$(cd "$(dirname "$0")/.." && pwd); hr=$here/heavy-run; fails=0
# Production state is never touched (2026-10-27 review): jobs go to a per-run test slice with runtime properties
# (THROTTLE_SLICE; heavy-run never writes or reloads a unit for it), scopes are named thrtest<pid>-..., and the run
# fails if the live heavy.slice file changed. The slice, its runtime drop-ins and any test unit are removed on exit,
# without a daemon-reload (`systemctl revert` would run one; the drop-in directory is removed instead).
live_slice=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/heavy.slice
live_sum=$(sha256sum "$live_slice" 2>/dev/null)
export THROTTLE_SLICE=thrtest_$$.slice THROTTLE_SCOPE_TAG=thrtest$$-
sd=0; systemctl --user show-environment >/dev/null 2>&1 && command -v systemd-run >/dev/null && sd=1
cleanup() {
  [ "$sd" = 1 ] || return 0
  systemctl --user stop "hr-test-*-$$.service" "${THROTTLE_SCOPE_TAG}*" 2>/dev/null
  systemctl --user stop "$THROTTLE_SLICE" 2>/dev/null
  rm -rf "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/systemd/user.control/$THROTTLE_SLICE.d"
}
trap cleanup EXIT
[ "$sd" = 1 ] && systemctl --user set-property --runtime "$THROTTLE_SLICE" TasksMax=2048 MemoryMax=8G
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
lim() { HEAVY_THREADS=$1 HEAVY_RAM_GB=$2 "$hr" --limits; }
check 'rig (32 threads, 124 GB)' '[[ $(lim 32 124) == "threads=32 ram=124G max_load=28.0 reserve=14G slots=2 slice_high=55G slice_max=71G cpu_quota=1792% tasks_job=4096 tasks_slice=8192" ]]'
check 'laptop (8 threads, 16 GB)' '[[ $(lim 8 16) == "threads=8 ram=16G max_load=7.0 reserve=8G slots=1 slice_high=7G slice_max=9G cpu_quota=448% tasks_job=1024 tasks_slice=2048" ]]'
check 'big box (128 threads, 512 GB)' '[[ $(lim 128 512) == *"slots=10"* && $(lim 128 512) == *"max_load=112.0"* ]]'
check 'overrides win' '[[ $(HEAVY_SLOTS=5 HEAVY_MAX_LOAD=9 lim 32 124) == *"max_load=9 "*"slots=5 "* ]]'
# heavy.slice comes from the hardware only: no caller's THROTTLE_TASKS or HEAVY_* changes it, and an unchanged slice
# is not rewritten or reloaded (a systemctl shim records reloads; the file goes to a temporary config dir)
shim=$(mktemp -d); printf '#!/bin/sh\necho "$*" >> %s/log\n' "$shim" > "$shim/systemctl"; chmod +x "$shim/systemctl"
sl() { PATH=$shim:$PATH XDG_CONFIG_HOME=$shim/cfg THROTTLE_SLICE=heavy.slice "$@" "$hr" --write-slice >/dev/null; grep TasksMax "$shim/cfg/systemd/user/heavy.slice"; }
check 'slice ignores THROTTLE_TASKS and HEAVY_*, rewritten once' '[[ $(sl env THROTTLE_TASKS=enforce; sl env THROTTLE_TASKS=log; sl env THROTTLE_TASKS=off; sl env HEAVY_THREADS=4 HEAVY_SLICE_TASKS_MAX=1) == $(printf "TasksMax=%s\n" $(lim $(nproc) 1 | sed -n "s/.*tasks_slice=//p"){,,,}) && $(grep -c daemon-reload "$shim/log") == 1 ]]'
check 'a test slice is never written' '[[ $(PATH=$shim:$PATH XDG_CONFIG_HOME=$shim/cfg2 "$hr" --write-slice >/dev/null 2>&1; ls "$shim/cfg2" 2>/dev/null | wc -l) == 0 ]]'
rm -rf "$shim"
check 'slice sized for this machine' '"$hr" --print-slice | head -1 | grep -q "threads=$(nproc) "'
check 'slice task cap' '[[ $("$hr" --print-slice | sed -n "s/^TasksMax=//p") == $("$hr" --limits | sed -n "s/.*tasks_slice=//p") ]]'
if [ "$sd" = 1 ]; then
  export XDG_STATE_HOME=$(mktemp -d) HEAVY_MAX_LOAD=100000 HEAVY_RESERVE_GB=1   # live checks must not wait on this machine's real load
  check 'runs in its slice' '[[ $("$hr" --name t1 -- grep -o "$THROTTLE_SLICE/[^/]*" /proc/self/cgroup) == "$THROTTLE_SLICE/${THROTTLE_SCOPE_TAG}heavy-t1-"* ]]'
  check 'nested call runs directly' '[[ $("$hr" --name t2 -- "$hr" --name t3 -- grep -o "heavy-t[23]" /proc/self/cgroup) == heavy-t2 ]]'
  HEAVY_RESERVE_GB=100000 timeout 4 "$hr" --name t4 -- true 2>/dev/null; check 'waits for headroom' '[[ $? == 124 ]]'
  HEAVY_SLOTS=1 "$hr" --name hold -- sleep 5 & sleep 1.5
  HEAVY_SLOTS=1 timeout 3 "$hr" --name t5 -- true 2>/dev/null; check 'waits for a slot' '[[ $? == 124 ]]'; wait
  check 'starts once the slot frees' 'HEAVY_SLOTS=1 timeout 30 "$hr" --name t6 -- true 2>/dev/null'
  # the job ends with its main process (2026-10-27: an OOM-killed harvest's 10 orphaned workers held a slot for 75 min)
  km=$XDG_STATE_HOME/killmain.sh; printf '#!/bin/bash\nsleep 120 & sleep 120 & echo $! > %s/child.pid; sleep 1; kill -KILL $$\n' "$XDG_STATE_HOME" > "$km"; chmod +x "$km"
  HEAVY_SLOTS=1 "$hr" --name t7 -- "$km" 2>/dev/null; check 'a killed main process reports its signal' '[[ $? == 137 ]]'
  check 'its orphaned children are stopped' '! kill -0 "$(cat "$XDG_STATE_HOME/child.pid")" 2>/dev/null'
  check 'and the slot frees at once' 'HEAVY_SLOTS=1 timeout 5 "$hr" --name t8 -- true 2>/dev/null'
  "$hr" --name t9 -- bash -c 'exit 7' 2>/dev/null; check 'the exit status passes through' '[[ $? == 7 ]]'
  check 'stdin passes through' '[[ $(echo piped | "$hr" --name t10 -- cat) == piped ]]'
  "$hr" --name t11 -- sleep 120 2>/dev/null & hp=$!; sleep 2; kill -TERM $hp; wait $hp 2>/dev/null; sleep 1
  check 'stopping heavy-run stops its job' '[[ -z $(systemctl --user list-units --no-legend --plain "${THROTTLE_SCOPE_TAG}heavy-t11-*") ]]'
  # second review (2026-10-27): INT and QUIT to heavy-run reach the job; a SIGKILLed heavy-run leaves the slot with the job
  for sig in INT QUIT; do
    got=$XDG_STATE_HOME/got.$sig; rm -f "$got"
    # launched as from a terminal: a background job of this script would start with INT and QUIT ignored
    env --default-signal=INT,QUIT "$hr" --name t12 -- bash -c "trap 'echo $sig > $got; exit 9' $sig; while :; do sleep 0.2; done" 2>/dev/null & hp=$!
    sleep 2; kill -s $sig $hp; wait $hp 2>/dev/null; hrc=$?
    check "$sig to heavy-run reaches the job" '[[ $(cat "$got" 2>/dev/null) == $sig && $hrc == 9 ]]'
  done
  HEAVY_SLOTS=1 "$hr" --name t13 -- sleep 6 2>/dev/null & hp=$!; sleep 2; kill -KILL $hp
  HEAVY_SLOTS=1 timeout 2 "$hr" --name t14 -- true 2>/dev/null; check 'a killed heavy-run leaves its slot with the job' '[[ $? == 124 ]]'
  check 'which frees it when it ends' 'HEAVY_SLOTS=1 timeout 25 "$hr" --name t15 -- true 2>/dev/null'   # slots are re-polled every 15 s
  # jobs live and die with their owner; an orphaned launcher is refused (2026-10-26: a stopped round left a 19.8 GB render)
  E="--setenv=HEAVY_MAX_LOAD=100000 --setenv=HEAVY_RESERVE_GB=1 --setenv=HEAVY_SLOTS=50 --setenv=XDG_STATE_HOME=$XDG_STATE_HOME
     --setenv=THROTTLE_SLICE=$THROTTLE_SLICE --setenv=THROTTLE_SCOPE_TAG=$THROTTLE_SCOPE_TAG"
  # A service wrapper gives each launcher a known starting nice, even if this test inherited nice 19. The job runs
  # plain `nice` (prints its own level); no $ in the command, since systemd-run expands $ in arguments.
  for initial in 19 0; do
    n=hr-test-nice-$initial-$$; expected=10
    [ "$initial" -eq 19 ] && expected=19
    actual=$(timeout 15 systemd-run --user --quiet --wait --pipe --collect --unit="$n" -p Nice=0 -p RuntimeMaxSec=10 \
      --setenv=PATH="$PATH" $E -- bash -c '
        nice -n "$1" "$2" --mem 1 --name "$3" -- nice
        rc=$?; exit "$rc"
      ' bash "$initial" "$hr" "$n")
    nice_rc=$?
    check "job launched at nice $initial starts at nice $expected" '[[ $nice_rc == 0 && ${actual//[[:space:]]/} == "$expected" ]]'
    systemctl --user stop "$n.service" "${THROTTLE_SCOPE_TAG}heavy-$n-*.scope" 2>/dev/null || true
  done
  u=hr-test-owner-$$; systemd-run --user --quiet --unit=$u --setenv=PATH="$PATH" $E -- bash -c "$hr --name $u -- sleep 120; true"; sleep 3
  job=$(systemctl --user list-units --no-legend --plain "${THROTTLE_SCOPE_TAG}heavy-$u-*" | awk '{print $1}')
  check 'a job launched from inside a service is bound to it' '[[ -n $job && $(systemctl --user show "$job" -p BindsTo --value) == "$u.service" ]]'
  systemctl --user stop $u; sleep 2
  check 'stopping the owner stops the job' '[[ -n $job ]] && ! systemctl --user is-active --quiet "$job"'
  m=hr-test-main-$$; systemd-run --user --quiet --unit=$m --setenv=PATH="$PATH" $E -- $hr --name $m -- sleep 120; sleep 3
  check 'as a service main process the job stays in that service' '[[ $(systemctl --user show $m -p MainPID --value) -gt 0 ]] && [[ $(cat /proc/$(systemctl --user show $m -p MainPID --value)/comm) == sleep ]]'
  check 'a service main process gets the job task cap' '[[ $(systemctl --user show $m -p TasksMax --value) == $("$hr" --limits | sed -n "s/.*tasks_job=\([0-9]*\).*/\1/p") ]]'
  systemctl --user stop $m; sleep 1
  check 'stopping that service stops the job' '! systemctl --user is-active --quiet $m'
  o=hr-test-orphan-$$; rc=$XDG_STATE_HOME/orphan.rc
  systemd-run --user --quiet --unit=$o --setenv=PATH="$PATH" $E -- bash -c "systemd-run --user --scope --quiet -- bash -c 'sleep 3; $hr --name $o -- sleep 120 2>/dev/null; echo \$? > $rc' & sleep 1"; sleep 7
  check 'an orphaned launcher is refused' '[[ $(cat $rc 2>/dev/null) == 75 ]]'
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
# the Python tests (the live task-cap tests among them) run inside a task cap of 2048 at most, as a second line of
# defence if a cap under test failed to hold: in place when the caller already has one that tight (it stays inside it)
outer=()
inherited=$(python3 -B -c 'import importlib.machinery as m, importlib.util as u, sys
l = m.SourceFileLoader("w", sys.argv[1]); w = u.module_from_spec(u.spec_from_loader("w", l)); l.exec_module(w)
print(w.inherited_cap(w.own_cgroup()) or 0)' "$here/workers")
[[ $sd == 1 && ( $inherited == 0 || $inherited -gt 2048 ) ]] &&
  outer=(systemd-run --user --scope --quiet --unit="${THROTTLE_SCOPE_TAG}tests" -p TasksMax=2048 --)
(cd "$here" && timeout 600 "${outer[@]}" python3 -B -m unittest -q test.test_gpu_queue test.test_memguard \
  test.test_fleet_disconnect test.test_workers test.test_remote_run test.test_caps test.test_diskguard test.test_agent_guard test.test_lane) || fails=$((fails+1))
check 'the live heavy.slice was not changed' '[[ $(sha256sum "$live_slice" 2>/dev/null) == "$live_sum" ]]'
(cd "$here" && python3 -B -m unittest -q test.test_lane_governor) || fails=$((fails+1))
exit $fails
