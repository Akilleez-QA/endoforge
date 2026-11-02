#!/usr/bin/env bash
set -u
id=$1; OUT=$2; K=$HOME/work/ef-v8c/p21kit
export PATH=$HOME/.local/share/mise/installs/node/22.23.3/bin:$HOME/.local/share/mise/command-wrappers/bin:$PATH
R=$OUT/$id; rm -rf $R; mkdir -p $R/in/need $R/out $R/work
cp $K/old/$id/atoms/direct/in/need/NEED.md $R/in/need/NEED.md
sed -e "s#/home/[^/]*/Work/endoforge/campaigns#$K/kit/campaigns#g" -e "s#/in/need#$R/in/need#g" -e "s#/work/$id#$R/work/$id#g" -e "s#/out/#$R/out/#g" -e "s# /out # $R/out #g" -e "s#under /out#under $R/out#g" $K/old/$id/atoms/direct/prompt-1.md > $R/prompt.md
t0=$(date +%s.%N)
( cd $R && CODEX_HOME=$HOME/.codex-accounts/scubasteve timeout 900 codex exec --color never --skip-git-repo-check --sandbox workspace-write -c model_reasoning_effort=medium --add-dir $R - < $R/prompt.md > $R/codex.log 2>&1 ); rc=$?
t1=$(date +%s.%N)
cp -r $R/work/$id $R/regate 2>/dev/null; mv $R/regate $R/$id.regate 2>/dev/null
mkdir -p $R/re && cp -r $R/work/$id $R/re/ 2>/dev/null && rm -f $R/re/$id/result.json
node $K/kit/campaigns/x1-spec-study/factory/gate.mjs run $R/re/$id > $R/regate.json 2>&1
t2=$(date +%s.%N)
tok=$(grep -A1 -i "tokens used" $R/codex.log | tail -1 | tr -d ",")
node -e "const fs=require(\"fs\");let g={};try{g=JSON.parse(fs.readFileSync(\"$R/regate.json\",\"utf8\"))}catch(e){};let w=null;try{w=JSON.parse(fs.readFileSync(\"$R/out/gates.json\",\"utf8\")).promotable}catch(e){};console.log(JSON.stringify({id:\"$id\",rc:$rc,workerS:+($t1-$t0).toFixed(2),totalS:+($t2-$t0).toFixed(2),regateS:+($t2-$t1).toFixed(2),workerPromotable:w,regatePromotable:g.promotable===true,failed:Object.entries(g.gates||{}).filter(([k,v])=>!v.ok).map(([k])=>k),tokens:\"$tok\"}))" | tee $R/row.json
