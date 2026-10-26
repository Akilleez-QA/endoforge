#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../../.."
if ! bwrap --ro-bind / / --dev /dev --overlay-src /usr --tmp-overlay /mnt true 2>/dev/null; then echo 'SKIP runtime: bubblewrap overlay unavailable'; exit 0; fi
testdir=$(mktemp -d "$PWD/tools/runtime/test/runtime-XXXXXX")
[[ -n ${KEEP:-} ]] || trap 'chmod -R u+w "$testdir"; rm -rf "$testdir"' EXIT
export ENDOFORGE_RUNTIME_ENV=none ENDOFORGE_HOME=$testdir/home ENDOFORGE_RUNS_DIR=$testdir/results ENDOFORGE_SRC_REPO
ENDOFORGE_SRC_REPO=$(git rev-parse --show-toplevel)
export ENDOFORGE_NO_AUGMENT=1
unset ENDOFORGE_ASC_SEED
launcher=$PWD/tools/runtime/endoforge; replay=$testdir/replay; doc=$testdir/atoms.json; failures=0
check() { if "$@"; then echo "PASS $*"; else echo "FAIL $*"; failures=$((failures+1)); fi; }
empty() { [[ -z $(find "$ENDOFORGE_HOME/instances" -mindepth 1 -maxdepth 1 -type d) ]]; }
json() { node -e 'const fs=require("fs"),assert=require("assert/strict"),d=JSON.parse(fs.readFileSync(process.argv[1])); eval(process.argv[2])' "$@"; }
node - "$doc" "$replay" <<'JS'
const fs=require('fs'),path=require('path'),[file,replay]=process.argv.slice(2);
const atoms=['other','review'].map((kind,i)=>({id:`a${i}`,kind,contract:'Write the single declared output file for this atom.',inputs:[],outputs:[{name:'result',path:'result.txt'}],verify:{kind:'manual'},size:{work:1,interface:1},worker:{model:'codex',tools:[],prompt:'Return result.'}}));
atoms.push({id:'join',kind:'compose',contract:'Join both atom results into one done marker file.',inputs:atoms.map(a=>({from:a.id})),outputs:[{name:'done',path:'done.txt'}],verify:{kind:'manual'},size:{work:1,interface:1},worker:{model:'script',command:['sh','-c','echo done > /out/done.txt']}});
fs.writeFileSync(file,JSON.stringify({schema:'endoforge/atoms/1',need:{id:'runtime',text:'Return results.'},acceptance:[{id:'A1',statement:'Output exists.',check:{kind:'command',run:'test -s /in/join/done.txt'}}],atoms}));
for(const a of atoms.slice(0,2)){const dir=path.join(replay,'atoms',a.id,'out');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'result.txt'),`replay ${a.id}\n`)}
JS
run() { "$launcher" run "$doc" --ref HEAD --stub-replay "$replay" "$@"; }
mkdir -p "$testdir/occupied"; echo keep >"$testdir/occupied/existing"
run --out "$testdir/occupied" >"$testdir/occupied.json"; check test "$?" = 2
check test "$(cat "$testdir/occupied/existing")" = keep
check test "$(find "$testdir/occupied" -mindepth 1 -maxdepth 1 | wc -l)" = 1
check test ! -d "$ENDOFORGE_HOME/instances"
run --tier light >"$testdir/a.json" & a=$!
run >"$testdir/b.json" & b=$!
wait "$a"; check test "$?" = 0
wait "$b"; check test "$?" = 0
for f in a b; do
  check json "$testdir/$f.json" 'assert.equal(d.ok,true);assert.equal(typeof d.timings.coldStartMs,"number");assert.equal(typeof d.timings.teardownMs,"number");for(const id of ["a0","a1"])assert.equal(fs.readFileSync(`${d.out}/run/atoms/${id}/out/result.txt`,"utf8"),`replay ${id}\n`)'
done
check node -e 'const fs=require("fs"),a=JSON.parse(fs.readFileSync(process.argv[1])),b=JSON.parse(fs.readFileSync(process.argv[2]));require("assert/strict").notEqual(a.id,b.id)' "$testdir/a.json" "$testdir/b.json"
check json "$testdir/a.json" 'assert.equal(typeof d.lessons.slotWaitMs,"number");assert(Array.isArray(d.lessons.failedLaunches));assert.equal(d.lessons.failedLaunches.length,0)'
check json "$testdir/a.json" 'const a=JSON.parse(fs.readFileSync(d.out+"/run/atoms.json"));assert(a.atoms.filter(x=>x.worker.model!=="script").every(x=>x.worker.tier==="light"))'
check empty
echo maintenance >"$testdir/shield"
ENDOFORGE_SHIELDS_FILE=$testdir/shield run >"$testdir/shield.json"; check test "$?" = 75
check json "$testdir/shield.json" 'assert.equal(d.status,"refused")'; check empty
ENDOFORGE_STUB_LATENCY_MS=20000 "$launcher" run "$doc" --ref HEAD --stub-replay "$replay" >"$testdir/signal.json" & p=$!
for ((i=0;i<600;i++)); do [[ -n $(find "$ENDOFORGE_HOME/instances" -path '*/run/atoms' -type d) ]] && break; sleep .1; done
check test "$i" -lt 600
kill -TERM "$p"; wait "$p"; check test "$?" = 143
check json "$testdir/signal.json" 'assert.equal(d.status,"signal")'; check empty
check bash -c 'id=$(node -p '\''JSON.parse(require("fs").readFileSync(process.argv[1])).id'\'' "$1"); for p in /proc/[0-9]*; do [[ -O $p ]] || continue; if grep -zFxq "ENDOFORGE_INSTANCE=$id" "$p/environ" 2>/dev/null; then exit 1; fi; done' _ "$testdir/signal.json"
ENDOFORGE_STUB_LATENCY_MS=20000 run --timeout 2 >"$testdir/timeout.json"; check test "$?" = 124
check json "$testdir/timeout.json" 'assert.equal(d.status,"timeout")'; check empty
mkdir -p "$ENDOFORGE_HOME/instances/ef-x"; echo '{"pgid":999999}' >"$ENDOFORGE_HOME/instances/ef-x/manifest.json"
"$launcher" reap >"$testdir/reap.log" 2>&1; check test "$?" = 0
check grep -q 'reaped ef-x' "$testdir/reap.log"; check empty
"$launcher" reap >"$testdir/reap2.log" 2>&1; check test "$?" = 0; check test ! -s "$testdir/reap2.log"
exit "$((failures>0))"
