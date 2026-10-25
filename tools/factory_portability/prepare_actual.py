#!/usr/bin/env python3
"""Stage the explicitly authorized real clean development job, with no model calls."""
import hashlib,json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
JOB=ROOT/'campaigns/next50-20261018/work/executed50/clean-3d58d848/jobs/dev-affine-01'
WRITERS=ROOT/'campaigns/next50-20261018/work/complete50/d32f00a2ea1346a1bcc98804f40d7f47'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def put(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2)+'\n')
def main(destination):
    d=Path(destination).resolve()
    if d.exists():raise FileExistsError(d)
    state=json.loads((JOB/'state.json').read_text())
    if state['pendingStages']!=['portable-consumer']:raise ValueError('real pending stage mismatch')
    if state['wasmHash']!=sha(JOB/'kernel.wasm'):raise ValueError('original artifact identity')
    d.mkdir(parents=True);origins={}
    def copy(p,relative):
        before=sha(p);target=d/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
        if sha(target)!=before or sha(p)!=before:raise ValueError('source changed during snapshot')
        origins[str(p.relative_to(ROOT))]=before
    for p in JOB.rglob('*'):
        if p.is_file():copy(p,'job/'+str(p.relative_to(JOB)))
    for name in ['precommit.json','precommit-sha.json','codex.json','codex-metadata.json','qwen.json','qwen-metadata.json','0-bundle.json','0-frozen.json','0-qualification.json','qualification.json']:
        copy(WRITERS/name,'writers/'+name)
    for name in ['model.json','manifest.json','result.json']:copy(JOB.parent.parent/name,'live-run/'+name)
    copy(ROOT/'campaigns/next50-20261018/quality/provider-fixture.json','references/retained-project-provider-fixture.json')
    for name in ['package.json','package-lock.json']:copy(ROOT/'experiments/P-02-compiler-in-isolate'/name,'dependencies/'+name)
    copy(ROOT/'campaigns/next50-20261018/portability/work/bundle-02/toolchain.json','dependencies/toolchain.json')
    for p in [*(ROOT/'tools/factory_campaign').glob('*.py'),*(ROOT/'tools/factory_quality').glob('*.mjs'),*(ROOT/'tools/factory_runtime').glob('*.py'),ROOT/'campaigns/x1-spec-study/factory/gate.mjs',ROOT/'tools/factory_portability/resume_stage.py']:
        copy(p,'sources/'+str(p.relative_to(ROOT)))
    cases=[{'id':'numeric37.5','args':[37.5],'expect':99.5,'tolerance':1e-9},{'id':'freezing','args':[0],'expect':32,'tolerance':1e-9},{'id':'invalid','args':[-300],'expectError':True},{'id':'nonfinite','args':['nan'],'expectError':True}]
    for c in cases:c['fn']='celsiusToFahrenheit'
    spec={'schema':'endoforge.portable-stage.v1','requiresModelAuthentication':False,'statePath':'job/state.json','modulePath':'job/kernel.wasm','moduleSha256':sha(JOB/'kernel.wasm'),'stage':'portable-consumer','cases':cases,'scope':'actual Codex-generated synthetic development job after paired Codex/Qwen evals, with genuinely pending deterministic consumer stage'}
    put(d/'resume.json',spec)
    reference={'version':1,'usedByCurrentJob':None,'reason':'explicit finite Celsius/Fahrenheit request; no refrigeration lookup used','rawRequest':'job/request.json','independentExpectedCases':'resume.json','optionalProjectProvider':'references/retained-project-provider-fixture.json','optionalProjectProviderUsed':False,'domainPolicy':'do not impose refrigeration provider limits on this unrelated temperature-conversion request'}
    put(d/'references/manifest.json',reference)
    provenance={'version':1,'gitHead':subprocess.check_output(['git','-C',ROOT,'rev-parse','HEAD'],text=True).strip(),'sourceSnapshot':origins,'originalJob':'campaigns/next50-20261018/work/executed50/clean-3d58d848/jobs/dev-affine-01','originalStateSha256':sha(JOB/'state.json'),'actualGeneratorReceipt':'live-run/model.json','actualIndependentWriterReceipts':['writers/codex-metadata.json','writers/qwen-metadata.json'],'trustedCompileImage':json.loads((JOB/'compile-receipt.json').read_text())['image'],'toolchainManifest':'dependencies/toolchain.json','resumedRuntime':'content-pinned Wasmtime49.0.3; offline; no Docker or model credentials required for pending consumer stage'}
    put(d/'provenance/source-versions.json',provenance)
    metadata={'schema':'endoforge.checkpoint.v1','job_states':{'state':'job/state.json','pending':['portable-consumer'],'completed':state['completedStages']},'frozen_evals':{'suite':'job/frozen.json','suiteSha256':sha(JOB/'frozen.json'),'pairedWriterReceipts':['writers/codex-metadata.json','writers/qwen-metadata.json'],'consumerSpec':'resume.json'},'dependencies':{'lockfile':'dependencies/package-lock.json','toolchain':'dependencies/toolchain.json'},'references':{'manifest':'references/manifest.json','noLookupNeeded':True},'provenance':{'sourceVersions':'provenance/source-versions.json','image':provenance['trustedCompileImage'],'origin':'actual current live synthetic development campaign'},'credentials':'excluded-reauthenticate-at-destination'}
    put(d/'checkpoint.json',metadata)
    if any(sha(ROOT/n)!=h for n,h in origins.items()):raise ValueError('source changed during complete snapshot')
    return {'scope':spec['scope'],'originStateSha256':sha(JOB/'state.json'),'moduleSha256':spec['moduleSha256'],'frozenSha256':sha(JOB/'frozen.json'),'sourceFiles':len(origins),'completedStages':state['completedStages'],'pendingStages':state['pendingStages'],'consumerCases':cases,'noModelCalls':True,'sourceImmutable':True}
if __name__=='__main__':print(json.dumps(main(sys.argv[1]),indent=2))
