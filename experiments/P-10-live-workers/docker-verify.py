#!/usr/bin/env python3
import hashlib,json,os,shutil,signal,subprocess,time,uuid
from pathlib import Path
H=Path(__file__).resolve().parent;R=H.parents[1];S=H/'continuations/20261018T190203Z-da38b5c0/work/accepted/P10';G=R/'campaigns/x1-spec-study/factory';DOCKER=['sudo','-n','docker'];IMAGE='endoforge-p09:probe';NAMES=['CONTRACT.md','tests.json','frozen.sha256','kernel.ts','glue.json'];sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def manifest(p):return {str(f.relative_to(p)):sha(f) for f in sorted(p.rglob('*')) if f.is_file()}
def write(p,j):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(j,indent=2)+'\n')
A=H/'docker-verifications'/f'{time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())}-{uuid.uuid4().hex[:8]}';A.mkdir(parents=True,exist_ok=False);REC=A/'receipt';REC.mkdir();start=time.monotonic()
pre={'label':'Recorded (probe)','createdBeforeFirstMeasuredJob':True,'source':str(S.relative_to(H)),'sourceManifest':manifest(S),'hostWasmSha256':sha(S/'kernel.wasm'),'files':{str(p.relative_to(R)):sha(p) for p in [H/'DOCKER-VERIFY-PRECOMMIT.md',H/'docker-verify.py',H/'oracle.mjs',G/'gate.mjs',G/'glue.schema.json']}}
(A/'precommit.json').write_text(json.dumps(pre,sort_keys=True,separators=(',',':'))+'\n');PH=sha(A/'precommit.json');(A/'precommit.sha256').write_text(PH+'  precommit.json\n')
def run(label,args,timeout=90):
    assert time.monotonic()-start<300 and shutil.disk_usage(H).free>5*1024**3
    t=time.monotonic();p=subprocess.Popen(list(map(str,args)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True);timed=False
    try:o,e=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:timed=True;os.killpg(p.pid,signal.SIGKILL);o,e=p.communicate()
    j={'command':list(map(str,args)),'precommitSha256':PH,'exit':p.returncode,'timeout':timed,'stdout':o,'stderr':e,'wallMs':round((time.monotonic()-t)*1000)};write(REC/(label+'.json'),j)
    if timed:raise RuntimeError(label+' timeout')
    return j
active=[]
def container(label,mount=None,args=()):
    name='endoforge-p10verify-'+uuid.uuid4().hex[:12];active.append(name)
    cmd=DOCKER+['run','--name',name,'--rm','--pull=never','--network=none','--read-only','--user',f'{os.getuid()}:{os.getgid()}','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=512m','--memory-swap=512m','--pids-limit=64','--tmpfs','/tmp:rw,nosuid,nodev,size=64m']
    if mount:cmd+=['--mount',f'type=bind,src={mount},dst=/out/P10']
    cmd+=['--entrypoint','/usr/local/bin/node',IMAGE]+list(args)
    try:return run(label,cmd)
    finally:
        run(label+'-cleanup',DOCKER+['rm','-f',name]);left=run(label+'-absence',DOCKER+['ps','-aq','--filter','name=^/'+name+'$']);assert left['exit']==0 and not left['stdout'].strip();active.remove(name)
try:
    inspect=run('image-inspect',DOCKER+['image','inspect',IMAGE]);assert inspect['exit']==0;image=json.loads(inspect['stdout'])[0]
    check=container('bundled-gate-identity',args=['-e',"const fs=require('fs'),c=require('crypto'); console.log(JSON.stringify(Object.fromEntries(['gate.mjs','glue.schema.json'].map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/bundle/campaigns/x1-spec-study/factory/'+n)).digest('hex')]))))"])
    assert check['exit']==0 and json.loads(check['stdout'])=={n:sha(G/n) for n in ['gate.mjs','glue.schema.json']}
    stages={}
    for label in ['positive','negative']:
        stage=A/'staging'/label/'P10';stage.mkdir(parents=True)
        for n in NAMES:shutil.copy2(S/n,stage/n)
        if label=='negative':(stage/'kernel.ts').write_text('export function celsiusToFahrenheit(c:f64):f64 { return 32; }\n')
        before={n:sha(stage/n) for n in NAMES};write(REC/(label+'-input-hashes.json'),before)
        got=container(label+'-docker-gates',stage,['/bundle/campaigns/x1-spec-study/factory/gate.mjs','run','/out/P10']);res=json.loads((stage/'result.json').read_text());assert before=={n:sha(stage/n) for n in NAMES}
        if label=='positive':assert got['exit']==0 and res['promotable'] and all(g['ok'] for g in res['gates'].values()) and sha(stage/'kernel.wasm')==pre['hostWasmSha256']
        else:assert got['exit']==1 and not res['promotable'] and res['gates']['G2_compiles']['ok'] and not res['gates']['G4_tests']['ok']
        stages[label]=stage
    oracle=run('returned-wasm-oracle',[shutil.which('node'),H/'oracle.mjs',stages['positive']/'kernel.wasm']);oj=json.loads(oracle['stdout']);assert oracle['exit']==0 and oj['passed'] and len(oj['cases'])==119
    assert manifest(S)==pre['sourceManifest']
    pub=A/'published/P10';pub.parent.mkdir();shutil.copytree(stages['positive'],pub)
    assert len(list(pub.parent.iterdir()))==1 and manifest(pub)==manifest(stages['positive'])
    write(REC/'summary.json',{'label':'Recorded (probe)','precommitSha256':PH,'passed':True,'sourceUnchanged':True,'positiveFrozenInputsUnchanged':True,'imageId':image['Id'],'bundledGateMatchesHost':True,'allGatesPassed':True,'evaluatorTestCount':len(json.loads((pub/'tests.json').read_text())),'oracleCount':len(oj['cases']),'hostDockerWasmIdentical':True,'wasmSha256':sha(pub/'kernel.wasm'),'negativeCompiledRejectedAtG4':True,'negativePublished':False,'publishedManifest':manifest(pub),'additionalModelCalls':0,'credentialsCopied':False,'elapsedSeconds':time.monotonic()-start,'limits':['offline Docker verifier of live host-worker outputs','original live orchestration failed and remains failed','no Docker-authenticated agent claim','no nested bwrap or recovery claim']})
except BaseException as e:
    write(REC/'failure.json',{'type':type(e).__name__,'error':str(e),'activeContainers':active});raise
finally:
    for name in active:subprocess.run(DOCKER+['rm','-f',name],capture_output=True,timeout=15)
    write(REC/'cleanup.json',{'remainingOwnedContainers':active,'credentialsCopied':False})
    (A/'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.relative_to(A)}\n' for p in sorted(A.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'))
    print(A)
