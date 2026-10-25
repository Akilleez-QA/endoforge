#!/usr/bin/env python3
"""Bounded, uniquely receipted live qualification. Never copies auth into evidence."""
import hashlib,json,os,shutil,signal,subprocess,tempfile,time,uuid
from pathlib import Path
H=Path(__file__).resolve().parent
R=H.parents[1]
HOME=Path('/home/user')
NODE=Path(shutil.which('node')).resolve()
CLAUDE=Path(shutil.which('claude')).resolve()
CODEX=Path(shutil.which('codex')).resolve()
GATE=R/'campaigns/x1-spec-study/factory/gate.mjs'
START=time.monotonic()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,obj):
    p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(obj,indent=2)+'\n')
def manifest(p):return {str(f.relative_to(p)):sha(f) for f in sorted(p.rglob('*')) if f.is_file()}
def main():
    # Freeze harness/source identity BEFORE any measured subprocess.
    source=[H/n for n in ['PRECOMMIT.md','request.md','oracle.mjs','evaluator.prompt.md','generator.prompt.md','run.py']]+[GATE,GATE.with_name('glue.schema.json')]
    pre={'schema':'endoforge-probe-precommit-v1','createdBeforeFirstMeasuredJob':True,'label':'Recorded (probe)','files':{str(p.relative_to(R)):sha(p) for p in source},'limits':{'modelTurns':2,'turnTimeoutSeconds':180,'gateTimeoutSeconds':90,'totalSeconds':600},'roles':{'evaluator':['request','fixed test schema'],'generator':['request','AssemblyScript output instruction']},'network':'Provider access enabled, LAN egress unconstrained; no network isolation claim'}
    canon=json.dumps(pre,sort_keys=True,separators=(',',':'))+'\n'
    prefile=H/'precommit-v2.json'
    if prefile.exists():assert prefile.read_text()==canon,'source changed after precommit; new probe required'
    else:prefile.write_text(canon);(H/'precommit-v2.sha256').write_text(sha(prefile)+'  precommit-v2.json\n')
    global A,REC
    A=H/'attempts'/f'{time.strftime("%Y%m%dT%H%M%SZ",time.gmtime())}-{uuid.uuid4().hex[:8]}'
    A.mkdir(parents=True,exist_ok=False);REC=A/'receipt';REC.mkdir()
    shutil.copy2(prefile,REC/'precommit.json');shutil.copy2(H/'precommit-v2.sha256',REC/'precommit.sha256')
    cmds=[]
    def run(label,args,stdin=None,timeout=90):
        assert time.monotonic()-START<600,'total budget exhausted'
        assert shutil.disk_usage(H).free>5*1024**3,'disk below 5 GiB'
        began=time.time();p=subprocess.Popen(list(map(str,args)),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
        timed=False
        try:o,e=p.communicate(stdin,timeout=timeout)
        except subprocess.TimeoutExpired:
            timed=True;os.killpg(p.pid,signal.SIGKILL);o,e=p.communicate()
        out={'label':label,'command':list(map(str,args)),'startedUnix':began,'wallMs':round((time.time()-began)*1000),'exit':p.returncode,'timeout':timed,'stdout':o,'stderr':e,'precommitSha256':sha(prefile)}
        write(REC/(label+'.json'),out);cmds.append(label)
        if timed:raise RuntimeError(label+' timeout')
        return out
    scratch=Path(tempfile.mkdtemp(prefix='endoforge-p10-auth-'));os.chmod(scratch,0o700)
    try:
        work=A/'work';work.mkdir()
        for role in ['generator','evaluator']:
            d=work/role;d.mkdir();(d/'out').mkdir();(d/'input').mkdir();(d/'private').mkdir()
            shutil.copy2(H/'request.md',d/'input/request.md');(d/'private/canary').write_text(f'{role}-private-'+uuid.uuid4().hex)
            (d/'out/preexisting').write_text(f'{role}-output-'+uuid.uuid4().hex)
        before={role:manifest(work/role/'private') for role in ['generator','evaluator']}
        frozen=None
        def box(role):
            d=work/role;home=scratch/role;home.mkdir(exist_ok=True)
            b=['bwrap','--unshare-pid','--unshare-uts','--unshare-ipc','--unshare-cgroup-try','--die-with-parent','--new-session','--clearenv']
            for p in ['/usr','/lib','/lib64','/bin','/sbin','/etc/ssl','/etc/ca-certificates','/etc/resolv.conf','/etc/hosts','/etc/passwd','/etc/group','/etc/localtime']:
                if Path(p).exists():b+=['--ro-bind',p,p]
            b+=['--bind',str(home),str(HOME)]
            for p in sorted(set([NODE.parent.parent,CLAUDE.parent,CODEX.parent.parent])):b+=['--ro-bind',str(p),str(p)]
            path=':'.join(map(str,[NODE.parent,CLAUDE.parent,CODEX.parent,'/usr/bin','/bin']))
            b+=['--proc','/proc','--dev','/dev','--tmpfs','/tmp','--ro-bind',str(d/'input'),'/in','--bind',str(d/'private'),'/private','--bind',str(d/'out'),'/out','--chdir','/out','--setenv','HOME',str(HOME),'--setenv','PATH',path,'--setenv','LANG','C.UTF-8']
            return b
        def boundary(role,phase):
            peer='evaluator' if role=='generator' else 'generator'
            # Exact real peer paths exist in host; they must be inaccessible, not merely fictitious.
            denied=[str(work/peer/'private/canary'),str(work/peer/'out/preexisting'),str(work/peer/'out/tests.json'),'/peer/canary',str(HOME/'Work/endoforge'),'/var/run/docker.sock','/in/tests.json','/in/CONTRACT.md']
            script='set -eu\ncat /in/request.md >/dev/null\ncat /private/canary >/dev/null\nprintf own > /out/boundary-own\n'
            for p in denied:
                import shlex
                q=shlex.quote(p)
                script+=f'if cat {q} >/dev/null 2>&1; then echo READ_LEAK; exit 11; fi\nif (printf tamper > {q}) 2>/dev/null; then echo WRITE_LEAK; exit 12; fi\n'
            script+='if (printf tamper > /in/request.md) 2>/dev/null; then exit 13; fi\necho boundary-passed\n'
            got=run(role+'-boundary-'+phase,box(role)+['/bin/sh','-c',script]);assert got['exit']==0,got
        for role in ['evaluator','generator']:boundary(role,'before')
        # Only evaluator's copied auth exists inside its home; generator has distinct home.
        eh=scratch/'evaluator';(eh/'.codex').mkdir();shutil.copy2(HOME/'.codex/auth.json',eh/'.codex/auth.json');os.chmod(eh/'.codex/auth.json',0o600)
        ep=(H/'evaluator.prompt.md').read_text()+'\n'+(H/'request.md').read_text();(REC/'evaluator.prompt.md').write_text(ep)
        ev=run('evaluator-model',box('evaluator')+[str(CODEX),'exec','-s','read-only','--skip-git-repo-check','--ephemeral','--ignore-user-config','-m','gpt-6.1-sol','-c','tools.web_search=false','--json','-o','/out/answer.txt',ep],timeout=180)
        assert ev['exit']==0,'evaluator model failed'
        usage=[]
        for line in ev['stdout'].splitlines():
            try:
                j=json.loads(line)
                if j.get('type')=='turn.completed':usage.append(j['usage'])
            except (json.JSONDecodeError,KeyError):pass
        assert usage,'evaluator usage absent'
        raw=(work/'evaluator/out/answer.txt').read_text();tests=json.loads(raw)
        assert isinstance(tests,list) and 9<=len(tests)<=16,'test count/schema'
        vals=[]
        for t in tests:
            assert t['fn']=='celsiusToFahrenheit' and len(t['args'])==1
            arg=t['args'][0]
            assert isinstance(arg,(float,int)) or arg in ['NaN','Infinity','-Infinity']
            num=float(arg);valid=num==num and -273.15<=num<=1000
            if valid:assert not t.get('expectError') and abs(t['expect']-(num*9/5+32))<=1e-9 and 0<=t['tol']<=1e-9
            else:assert t.get('expectError') is True
            vals.append(arg)
        assert all(v in vals for v in [-273.15,1000,'NaN','Infinity','-Infinity'])
        assert sum(isinstance(v,(int,float)) and -273.15<v<1000 for v in vals)>=2
        assert any(isinstance(v,(int,float)) and v < -273.15 for v in vals) and any(isinstance(v,(int,float)) and v>1000 for v in vals)
        # Save exact evaluator text, never normalise/refactor tests after freeze.
        (work/'evaluator/out/tests.json').write_text(raw)
        candidate=work/'candidate';candidate.mkdir();shutil.copy2(H/'request.md',candidate/'CONTRACT.md');(candidate/'tests.json').write_text(raw)
        fr=run('freeze',[NODE,GATE,'freeze',candidate]);assert fr['exit']==0
        frozen=manifest(candidate)
        write(REC/'evaluator-validation.json',{'passed':True,'count':len(tests),'usage':usage,'suiteSha256':sha(candidate/'tests.json'),'frozen':frozen})
        boundary('generator','eval-frozen')
        gh=scratch/'generator';(gh/'.claude').mkdir();shutil.copy2(HOME/'.claude/.credentials.json',gh/'.claude/.credentials.json');os.chmod(gh/'.claude/.credentials.json',0o600)
        # Minimal first-run completion state, no real user settings or project hints.
        (gh/'.claude.json').write_text('{"hasCompletedOnboarding":true}')
        gp=(H/'generator.prompt.md').read_text()+'\n'+(H/'request.md').read_text();(REC/'generator.prompt.md').write_text(gp)
        gen=run('generator-model',box('generator')+[str(CLAUDE),'-p','--output-format','json','--no-session-persistence','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-chrome','--setting-sources','','--model','claude-sonnet-5-5','--effort','low'],gp,180)
        assert gen['exit']==0,'generator model failed'
        gj=json.loads(gen['stdout']);assert gj.get('usage') and not gj.get('is_error'),'generator usage/failure'
        code=gj['result'].strip();assert not code.startswith('```'),'generator Markdown output'
        (work/'generator/out/kernel.ts').write_text(code+'\n');shutil.copy2(work/'generator/out/kernel.ts',candidate/'kernel.ts')
        glue={'id':'P10','assumption':'Complete explicit request; no added assumptions.','question':'No missing input: provide Celsius in the declared finite range.','exports':[{'name':'celsiusToFahrenheit','label':'Celsius to Fahrenheit','args':[{'name':'c','kind':'number','unit':'degC'}],'result':{'kind':'number','unit':'degF','precision':6}}],'traps':[{'fn':'celsiusToFahrenheit','when':'not finite or outside [-273.15, 1000]','message':'Supply finite Celsius from -273.15 through 1000.'}]}
        write(candidate/'glue.json',glue)
        gate=run('candidate-gates',[NODE,GATE,'run',candidate]);result=json.loads((candidate/'result.json').read_text());assert gate['exit']==0 and result['promotable']
        oracle=run('candidate-oracle',[NODE,H/'oracle.mjs',candidate/'kernel.wasm']);assert oracle['exit']==0 and json.loads(oracle['stdout'])['passed']
        bad=work/'deliberate-wrong';shutil.copytree(candidate,bad);(bad/'kernel.ts').write_text('export function celsiusToFahrenheit(c:f64):f64 { return 32; }\n')
        reject=run('wrong-candidate-gates',[NODE,GATE,'run',bad]);br=json.loads((bad/'result.json').read_text());assert reject['exit']==1 and not br['promotable'] and not br['gates']['G4_tests']['ok']
        for role in ['evaluator','generator']:boundary(role,'after')
        assert before=={role:manifest(work/role/'private') for role in before},'private canary changed'
        assert all(sha(candidate/n)==v for n,v in frozen.items()),'frozen source changed'
        write(REC/'host-tools.json',{'node':str(NODE),'claude':str(CLAUDE),'codex':str(CODEX),'bwrapSha256':sha('/usr/bin/bwrap'),'gateSha256':sha(GATE),'nodeSha256':sha(NODE),'generatorUsage':gj['usage'],'evaluatorUsage':usage})
        # Default restrictive Docker; copy no credentials and mount no workspace/home.
        name='endoforge-p10-'+uuid.uuid4().hex[:12]
        docker=['sudo','-n','docker'];nested=None
        try:
            nested=run('nested-bwrap',docker+['run','--name',name,'--rm','--user','1000:1000','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--cpus','1','--memory','256m','--pids-limit','64','--tmpfs','/tmp:rw,nosuid,nodev,size=16m','--mount','type=bind,src=/usr/bin/bwrap,dst=/probe-bwrap,readonly','--mount','type=bind,src=/usr/lib,dst=/hostlib,readonly','--entrypoint','/hostlib/ld-linux-x86-64.so.2','endoforge-p09:probe','--library-path','/hostlib','/probe-bwrap','--unshare-user','--unshare-pid','--ro-bind','/','/','--proc','/proc','/bin/true'],timeout=30)
        finally:
            cleanup=run('nested-cleanup',docker+['rm','-f',name]);# already removed is expected
        write(REC/'summary.json',{'label':'Recorded (probe)','liveWorkflowPassed':True,'precommitSha256':sha(prefile),'modelTurns':2,'testCount':len(tests),'oracleCount':len(json.loads(oracle['stdout'])['cases']),'gatePass':result['promotable'],'wrongRejected':not br['promotable'],'roleBoundaryPass':True,'canariesUnchanged':True,'freezeUnchanged':True,'nestedBwrapExit':nested['exit'],'nestedBwrapQualified':nested['exit']==0,'elapsedSeconds':time.monotonic()-START,'limits':['one closed-form request','tools disabled in model turns; same mounts probed by real shell','provider network retained; LAN egress unrestricted','host gate external timeout; no per-call preemption','no Docker live agent or recovery claim']})
    except BaseException as e:
        write(REC/'failure.json',{'type':type(e).__name__,'error':str(e),'precommitSha256':sha(prefile),'commandsCompleted':cmds});raise
    finally:
        shutil.rmtree(scratch)
        write(REC/'credential-cleanup.json',{'removed':not scratch.exists(),'noCredentialContentsCaptured':True})
        write(REC/'commands-index.json',cmds)
        files={str(f.relative_to(A)):sha(f) for f in sorted(A.rglob('*')) if f.is_file() and f.name!='SHA256SUMS'}
        (A/'SHA256SUMS').write_text(''.join(f'{v}  {k}\n' for k,v in files.items()))
        print(A)
if __name__=='__main__':main()
