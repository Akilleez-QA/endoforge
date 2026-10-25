#!/usr/bin/env python3
import hashlib,json,os,shlex,shutil,signal,subprocess,tempfile,time,uuid
from pathlib import Path
H=Path(__file__).resolve().parent;R=H.parents[1];OLD=H/'attempts/20261018T190047Z-8f51a147';SOURCE=OLD/'work/candidate';HOME=Path('/home/user');sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
NODE=Path(shutil.which('node')).resolve();CLAUDE=Path(shutil.which('claude')).resolve();CODEX=Path(shutil.which('codex')).resolve();GATE=R/'campaigns/x1-spec-study/factory/gate.mjs'
def manifest(p):return {str(f.relative_to(p)):sha(f) for f in sorted(p.rglob('*')) if f.is_file()}
def write(p,j):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(j,indent=2)+'\n')
A=H/'continuations'/f'{time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())}-{uuid.uuid4().hex[:8]}';A.mkdir(parents=True,exist_ok=False);REC=A/'receipt';REC.mkdir()
pre={'label':'Recorded (probe)','createdBeforeFirstMeasuredJob':True,'sourceAttempt':str(OLD.relative_to(H)),'sourceManifest':manifest(SOURCE),'sources':{str(p.relative_to(R)):sha(p) for p in [H/'CONTINUATION-PRECOMMIT.md',H/'continue.py',H/'oracle.mjs',GATE,GATE.with_name('glue.schema.json')]}}
(A/'precommit.json').write_text(json.dumps(pre,sort_keys=True,separators=(',',':'))+'\n');ph=sha(A/'precommit.json');(A/'precommit.sha256').write_text(ph+'  precommit.json\n');start=time.monotonic()
def run(label,args,timeout=90):
    p=subprocess.Popen(list(map(str,args)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True);begin=time.monotonic();timed=False
    try:o,e=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:timed=True;os.killpg(p.pid,signal.SIGKILL);o,e=p.communicate()
    j={'command':list(map(str,args)),'precommitSha256':ph,'exit':p.returncode,'timeout':timed,'wallMs':round((time.monotonic()-begin)*1000),'stdout':o,'stderr':e};write(REC/(label+'.json'),j)
    if timed:raise RuntimeError(label+' timeout')
    return j
scratch=Path(tempfile.mkdtemp(prefix='p10-noauth-'));os.chmod(scratch,0o700);container='endoforge-p10-'+uuid.uuid4().hex[:12];docker=['sudo','-n','docker']
try:
    work=A/'work';work.mkdir();candidate=work/'accepted/P10';candidate.parent.mkdir();shutil.copytree(SOURCE,candidate)
    for n in ['kernel.wasm','kernel.wat','result.json']:(candidate/n).unlink(missing_ok=True)
    good=run('candidate-gates',[NODE,GATE,'run',candidate]);gj=json.loads((candidate/'result.json').read_text());assert good['exit']==0 and gj['promotable']
    oracle=run('candidate-oracle',[NODE,H/'oracle.mjs',candidate/'kernel.wasm']);oj=json.loads(oracle['stdout']);assert oracle['exit']==0 and oj['passed']
    bad=work/'wrong/P10';bad.parent.mkdir();shutil.copytree(candidate,bad);(bad/'kernel.ts').write_text('export function celsiusToFahrenheit(c:f64):f64 { return 32; }\n')
    wrong=run('wrong-candidate-gates',[NODE,GATE,'run',bad]);wj=json.loads((bad/'result.json').read_text());assert wrong['exit']==1 and not wj['promotable'] and not wj['gates']['G4_tests']['ok']
    for role in ['generator','evaluator']:shutil.copytree(OLD/'work'/role,work/role)
    before={role:manifest(work/role) for role in ['generator','evaluator']};write(REC/'role-manifests-before.json',before)
    def box(role):
        home=scratch/role;home.mkdir(exist_ok=True);b=['bwrap','--unshare-pid','--unshare-uts','--unshare-ipc','--unshare-cgroup-try','--die-with-parent','--new-session','--clearenv']
        for p in ['/usr','/lib','/lib64','/bin','/sbin','/etc/ssl','/etc/ca-certificates','/etc/resolv.conf','/etc/hosts','/etc/passwd','/etc/group','/etc/localtime']:
            if Path(p).exists():b+=['--ro-bind',p,p]
        b+=['--bind',str(home),str(HOME)]
        for p in sorted(set([NODE.parent.parent,CLAUDE.parent,CODEX.parent.parent])):b+=['--ro-bind',str(p),str(p)]
        d=work/role;b+=['--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',str(d/'input'),'/in','--bind',str(d/'private'),'/private','--bind',str(d/'out'),'/out','--chdir','/out','--setenv','HOME',str(HOME),'--setenv','PATH','/usr/bin:/bin']
        return b
    for phase in ['before','after']:
        for role in ['generator','evaluator']:
            peer='evaluator' if role=='generator' else 'generator';denied=[str(work/peer/'private/canary'),str(work/peer/'out/preexisting'),str(work/peer/'out/tests.json'),str(work/peer/'out/kernel.ts'),'/in/tests.json','/in/CONTRACT.md',str(HOME/'Work/endoforge'),'/var/run/docker.sock','/peer/canary']
            shell='set -eu\ncat /private/canary >/dev/null\ncat /in/request.md >/dev/null\nprintf own > /out/boundary-own\n'
            for p in denied:
                q=shlex.quote(p);shell+=f'if cat {q} >/dev/null 2>&1; then exit 11; fi\nif (printf tamper > {q}) 2>/dev/null; then exit 12; fi\n'
            shell+='if (printf tamper > /in/request.md) 2>/dev/null; then exit 13; fi\necho boundary-passed\n';bj=run(role+'-boundary-'+phase,box(role)+['/bin/sh','-c',shell]);assert bj['exit']==0
    after={role:manifest(work/role) for role in before};write(REC/'role-manifests-after.json',after);assert before==after,'boundary probes changed role artifacts'
    assert manifest(SOURCE)==pre['sourceManifest'],'original source changed'
    nested=run('nested-bwrap',docker+['run','--name',container,'--rm','--user','1000:1000','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','1','--memory','256m','--pids-limit','64','--tmpfs','/tmp:rw,nosuid,nodev,size=16m','--mount','type=bind,src=/usr/bin/bwrap,dst=/probe-bwrap,readonly','--mount','type=bind,src=/usr/lib,dst=/hostlib,readonly','--entrypoint','/hostlib/ld-linux-x86-64.so.2','endoforge-p09:probe','--library-path','/hostlib','/probe-bwrap','--unshare-user','--unshare-pid','--ro-bind','/','/','--proc','/proc','/bin/true'],30)
    cleanup=run('nested-cleanup',docker+['rm','-f',container]);left=run('nested-absence',docker+['ps','-aq','--filter','name=^/'+container+'$']);assert left['exit']==0 and not left['stdout'].strip()
    write(REC/'summary.json',{'label':'Recorded (probe)','precommitSha256':ph,'continuationChecksPassed':True,'originalLiveAttempt':'failed-host-glue-directory-mismatch','additionalModelCalls':0,'testCount':len(gj['tests']),'oracleCount':len(oj['cases']),'generatedCandidateAllGatesPass':True,'wrongCandidateRejectedAtG4':True,'actualPeerBoundariesPass':True,'sourceUnchanged':True,'nestedBwrapQualified':nested['exit']==0,'nestedBwrapExit':nested['exit'],'probeContainerAbsent':True,'elapsedSeconds':time.monotonic()-start})
except BaseException as e:
    write(REC/'failure.json',{'type':type(e).__name__,'error':str(e)});raise
finally:
    subprocess.run(docker+['rm','-f',container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
    shutil.rmtree(scratch);write(REC/'cleanup.json',{'temporaryHomeRemoved':not scratch.exists(),'credentialsCopied':False})
    (A/'SHA256SUMS').write_text(''.join(f'{sha(p)}  {p.relative_to(A)}\n' for p in sorted(A.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'))
    print(A)
