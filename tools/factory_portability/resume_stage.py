#!/usr/bin/env python3
"""Resume a preregistered deterministic WASM verification/consumer stage offline."""
import argparse,hashlib,json,math,os,subprocess,tempfile,time,uuid
from pathlib import Path,PurePosixPath

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def encode(obj):return (json.dumps(obj,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def relative(root,name):
    p=PurePosixPath(name)
    if p.is_absolute() or '..'in p.parts or str(p)!=name:raise ValueError('unsafe stage input path')
    target=root/name
    if target.is_symlink() or not target.is_file():raise ValueError('stage input is not a regular file')
    return target

def run(checkpoint,bundle,output):
    checkpoint,bundle,output=map(lambda p:Path(p).resolve(),(checkpoint,bundle,output))
    manifest=json.loads((checkpoint/'checkpoint.json').read_text()); spec=json.loads((checkpoint/'resume.json').read_text())
    if manifest['schema']!='endoforge.checkpoint.v1' or spec.get('schema')!='endoforge.portable-stage.v1':raise ValueError('schema version')
    if spec.get('requiresModelAuthentication') is not False:raise ValueError('this stage is offline and must not need model authentication')
    state=json.loads(relative(checkpoint,spec['statePath']).read_text()); stage=spec['stage']
    if not state.get('completedStages') or stage not in state.get('pendingStages',[]):raise ValueError('checkpoint is not partly complete at requested stage')
    before={name:sha(relative(checkpoint,name)) for name in manifest['files']}
    if any(digest!=manifest['files'][n]['sha256']for n,digest in before.items()):raise ValueError('checkpoint input changed')
    module=relative(checkpoint,spec['modulePath']);module_hash=sha(module)
    if module_hash!=spec['moduleSha256']:raise ValueError('module identity')
    pins=json.loads((bundle/'toolchain.json').read_text());wt=bundle/'bin/wasmtime'
    if sha(wt)!=pins['files']['bin/wasmtime']['sha256']:raise ValueError('runtime identity')
    if not spec.get('cases') or len(spec['cases'])>256:raise ValueError('case count')
    rows=[];semantics=[];started=time.monotonic()
    for case in spec['cases']:
        if time.monotonic()-started>120:raise TimeoutError('stage deadline')
        args=[]
        for x in case['args']:
            if type(x) not in (int,float,str):raise ValueError('numeric WASM arguments only')
            args.append({'NaN':'nan','Infinity':'inf','-Infinity':'-inf'}.get(str(x),str(x)))
        argv=[str(wt),'run','-W','fuel=100000','-W','max-memory-size=1048576','-W','trap-on-grow-failure=y','-W','timeout=100ms','--invoke',case['fn'],str(module),*args]
        t=time.monotonic();cp=subprocess.run(argv,capture_output=True,text=True,timeout=5)
        if len(cp.stdout)+len(cp.stderr)>1048576:raise ValueError('runtime output budget')
        result={'id':case['id'],'passed':False}
        if case.get('expectError'):
            refusal=cp.returncode!=0 and 'wasm trap: wasm `unreachable` instruction executed'in cp.stderr and not any(s in cp.stderr.lower()for s in ['fuel','interrupt','out of bounds','allocation','memory size'])
            result.update(passed=refusal,outcome='refused'if refusal else'runtime-failure')
        else:
            try:value=float(cp.stdout.strip().splitlines()[-1])
            except(ValueError,IndexError):value=None
            good=value is not None and math.isfinite(value)and cp.returncode==0 and abs(value-case['expect'])<=case.get('tolerance',0)
            result.update(passed=good,outcome='value',value=value if value is not None and math.isfinite(value)else None)
        semantics.append(result);rows.append({**result,'argv':argv,'exit':cp.returncode,'stdout':cp.stdout,'stderr':cp.stderr,'wallMs':1000*(time.monotonic()-t)})
    after={name:sha(relative(checkpoint,name))for name in manifest['files']}
    if before!=after:raise ValueError('checkpoint modified by resumed stage')
    result={'schema':'endoforge.portable-stage-result.v1','job':state['job'],'stage':stage,'passed':all(r['passed']for r in semantics),'moduleSha256':module_hash,'inputHashes':before,'completedStagesPreserved':state['completedStages'],'cases':semantics,'network':'externally enforced offline namespace','modelAuthentication':'deliberately not required: all model stages completed before checkpoint'}
    result['resumedState']={**state,'stage':stage+'-completed' if result['passed'] else stage+'-failed','completedStages':state['completedStages']+[stage] if result['passed'] else state['completedStages'],'pendingStages':[x for x in state['pendingStages'] if x!=stage] if result['passed'] else state['pendingStages']}
    output.mkdir(parents=True,exist_ok=True)
    attempts=output/'attempts';attempts.mkdir(exist_ok=True)
    attempt=attempts/(uuid.uuid4().hex+'.json');attempt.write_bytes(encode({'result':result,'executions':rows,'elapsedMs':1000*(time.monotonic()-started)}))
    publication=output/'stage.json';published=False;reused=False
    if result['passed']:
        data=encode(result)
        fd,tmp=tempfile.mkstemp(prefix='.stage-',dir=output)
        try:
            with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
            try:os.link(tmp,publication)
            except FileExistsError:
                if publication.read_bytes()!=data:raise ValueError('conflicting existing stage publication')
                reused=True
            else:
                d=os.open(output,os.O_DIRECTORY|os.O_RDONLY)
                try:os.fsync(d)
                finally:os.close(d)
                published=True
        finally:os.unlink(tmp)
    return {'passed':result['passed'],'published':published,'reused':reused,'publicationSha256':sha(publication)if publication.exists()else None,'moduleSha256':module_hash,'inputImmutable':before==after,'completedStagesPreserved':state['completedStages'],'cases':semantics,'resumedState':result['resumedState'],'attempt':attempt.name}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('checkpoint');p.add_argument('bundle');p.add_argument('output');a=p.parse_args();print(json.dumps(run(a.checkpoint,a.bundle,a.output),indent=2))
