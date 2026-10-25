#!/usr/bin/env python3
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import signal
import time

P = Path(__file__).resolve().parent
ROOT = P.parents[1]
W = P / 'attempts/04/work'
R = P / 'attempts/04/receipt'
OLD = ROOT / 'experiments/P-09-portable-campaign'
BASE = 'node@sha256:752ea8a2f758c34002a0461bd9f1cee4f9a3c36d48494586f60ffce1fc708e0e'
IMAGE = 'endoforge-p13:rebuild'
D = ['sudo', '-n', 'docker']
ROWS = []
START = time.monotonic()


def save(p, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2) + '\n')


def digest(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(1024**2), b''): h.update(b)
    return h.hexdigest()


def run(args, check=True):
    if time.monotonic() - START > 600 or shutil.disk_usage(P).free < 5 * 1024**3:
        raise RuntimeError('time/disk guard')
    t = time.monotonic()
    cp = subprocess.Popen([str(x) for x in args], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed=False
    try: out,err=cp.communicate(timeout=120)
    except subprocess.TimeoutExpired:
        timed=True
        # sudo descendants can be root-owned; restrict signal to this new process group.
        subprocess.run(['sudo','-n','kill','-TERM','--',f'-{cp.pid}'],capture_output=True,timeout=10)
        try: out,err=cp.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            subprocess.run(['sudo','-n','kill','-KILL','--',f'-{cp.pid}'],capture_output=True,timeout=10)
            out,err=cp.communicate(timeout=10)
    row = dict(argv=[str(x) for x in args], exit=cp.returncode, stdout=out, stderr=err, timeout=timed, wallMs=(time.monotonic()-t)*1000)
    ROWS.append(row); save(R / 'commands.json', ROWS)
    if timed: raise RuntimeError('command timeout; owned process group terminated')
    if check and cp.returncode: raise RuntimeError(err[-2000:])
    return row


def files(p):
    result = {}
    for x in sorted(p.rglob('*')):
        if x.name == '.package-lock.json': continue
        if x.is_symlink(): result[str(x.relative_to(p))] = {'link': os.readlink(x)}
        elif x.is_file(): result[str(x.relative_to(p))] = {'sha256': digest(x)}
    return result


def metrics(a):
    a = sorted(a)
    return dict(n=len(a), median=statistics.median(a), p95=a[math.ceil(.95*len(a))-1], min=a[0], max=a[-1])


def semantic(r):
    return {k: ({g: {a: b for a,b in v.items() if a!='maxMs'} for g,v in value.items()} if k=='gates' else [{a:b for a,b in t.items() if a!='ms'} for t in value] if k=='tests' else value) for k,value in r.items() if k!='at'}


def create_args(name, data, detached=False):
    args = D + ['run', '--name', name, '--pull=never', '--network=none', '--read-only', '--user', f'{os.getuid()}:{os.getgid()}', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--cpus=1', '--memory=512m', '--memory-swap=512m', '--pids-limit=64', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--mount', f'type=bind,src={data},dst=/data,readonly', '--mount', f'type=bind,src={P/"workload.mjs"},dst=/workload.mjs,readonly', '--entrypoint', '/usr/local/bin/node']
    return args + (['-d'] if detached else ['--rm']) + [IMAGE]


def bwrap(data):
    args=['bwrap']
    for p in ['/usr','/lib','/lib64','/bin','/sbin']:
        if Path(p).exists(): args+=['--ro-bind',p,p]
    return args+['--ro-bind',str(OLD/'work/node'),'/opt/node','--ro-bind',str(data),'/data','--ro-bind',str(P/'workload.mjs'),'/workload.mjs','--tmpfs','/tmp','--proc','/proc','--dev','/dev','--unshare-all','--die-with-parent','--new-session','--clearenv','--setenv','PATH','/usr/bin:/bin','--chdir','/tmp','--','/opt/node','/workload.mjs']


def main():
    if W.exists(): raise RuntimeError('existing attempt: no rerun')
    assert digest(P/'PRECOMMIT.md') == (R/'precommit.sha256').read_text().split()[0]
    assert digest(P/'AMENDMENT-04.md') == (R/'amendment.sha256').read_text().split()[0]
    W.mkdir()
    save(R/'environment.json', {'kernel':os.uname().release,'load':os.getloadavg(),'runnerSha256':digest(P/'run.py'),'workloadSha256':digest(P/'workload.mjs'),'git':run(['git','-C',ROOT,'rev-parse','HEAD'])['stdout'].strip()})
    context=W/'context'; context.mkdir()
    compiler=ROOT/'experiments/P-02-compiler-in-isolate'
    gate=ROOT/'campaigns/x1-spec-study/factory'
    for src in [compiler/'package.json',compiler/'package-lock.json',gate/'gate.mjs',gate/'glue.schema.json']:
        shutil.copy2(src,context/src.name)
    fresh=W/'fresh-deps'; fresh.mkdir()
    for n in ['package.json','package-lock.json']: shutil.copy2(context/n,fresh/n)
    npm=Path(shutil.which('npm')).resolve()
    save(R/'npm.json',{'path':str(npm),'sha256':digest(npm),'version':run([OLD/'work/node',npm,'--version'])['stdout']})
    for n in ['user.npmrc','global.npmrc']: (W/n).write_text('')
    run([OLD/'work/node',npm,'ci','--prefix',fresh,'--ignore-scripts','--no-audit','--no-fund',f'--userconfig={W/"user.npmrc"}',f'--globalconfig={W/"global.npmrc"}','--cache',W/'fresh-cache','--fetch-retries=0','--fetch-timeout=20000','--registry=https://registry.npmjs.org'])
    shutil.copytree(fresh/'node_modules',context/'node_modules',symlinks=True)
    (context/'Dockerfile').write_text(f'FROM {BASE}\nCOPY node_modules /bundle/experiments/P-02-compiler-in-isolate/node_modules\nCOPY package.json package-lock.json /bundle/experiments/P-02-compiler-in-isolate/\nCOPY gate.mjs glue.schema.json /bundle/campaigns/x1-spec-study/factory/\nENV HOME=/tmp\nWORKDIR /tmp\n')
    save(R/'build-inputs.json',files(context))
    run(D+['build','--no-cache','--network=none','-t',IMAGE,context])
    image=json.loads(run(D+['image','inspect',IMAGE])['stdout'])[0]; save(R/'image.json',image)
    extract=f'endoforge-p13-extract-{os.getpid()}'
    run(D+['create','--name',extract,IMAGE])
    try: run(D+['cp',f'{extract}:/bundle/experiments/P-02-compiler-in-isolate/node_modules',W/'node_modules'])
    finally: run(D+['rm','-f',extract],check=False)
    before=files(compiler/'node_modules'); after=files(W/'node_modules')
    differences={k:{'old':before.get(k),'rebuilt':after.get(k)} for k in sorted(before.keys()|after.keys()) if before.get(k)!=after.get(k)}
    save(R/'dependency-comparison.json',{'match':not differences,'differences':differences,'reconstructed':after})
    output=W/'replay'; shutil.copytree(OLD/'work/inputs/candidates',output)
    parity=[]
    for c in sorted(output.iterdir()):
        name=f'endoforge-p13-gate-{c.name.lower()}-{os.getpid()}'
        try:
            row=run(D+['run','--rm','--name',name,'--pull=never','--network=none','--read-only','--user',f'{os.getuid()}:{os.getgid()}','--cap-drop=ALL','--security-opt=no-new-privileges','--cpus=1','--memory=512m','--memory-swap=512m','--pids-limit=64','--tmpfs','/tmp:rw,nosuid,nodev,size=64m','--mount',f'type=bind,src={c},dst=/out/{c.name}','--entrypoint','/usr/local/bin/node',image['Id'],'/bundle/campaigns/x1-spec-study/factory/gate.mjs','run',f'/out/{c.name}'],False)
        finally: run(D+['rm','-f',name],False)
        actual=json.loads((c/'result.json').read_text()); old=json.loads((OLD/'receipt/docker'/f'{c.name}.json').read_text())
        match=semantic(actual)==semantic(old['result']) and digest(c/'kernel.wasm')==old['wasmSha256'] and row['exit']==old['exit']
        parity.append({'id':c.name,'match':match,'wasmSha256':digest(c/'kernel.wasm')})
        save(R/'replay'/f'{c.name}.json',{'execution':row,'result':actual,'match':match})
        print(f'rebuild {c.name}: {match}',flush=True)
    scope=['systemd-run','--user','--scope','--quiet','-p','MemoryMax=512M','-p','CPUQuota=100%','--']
    control=run(scope+['true'],False)
    timings={'bubblewrap':[],'dockerFresh':[],'dockerPersistent':[]}
    qualified=control['exit']==0
    persistent=f'endoforge-p13-persistent-{os.getpid()}'
    data=output/'CC-036'
    if qualified:
        launch=run(create_args(persistent,data,True)+['-e','setInterval(()=>{},1000)'])
        save(R/'persistent-inspect.json',json.loads(run(D+['inspect',persistent])['stdout'])[0])
        try:
            for i in range(10):
                for backend,args in [('bubblewrap',bwrap(data)),('dockerFresh',create_args(f'endoforge-p13-fresh-{os.getpid()}-{i}',data)+['/workload.mjs']),('dockerPersistent',D+['exec',persistent,'/usr/local/bin/node','/workload.mjs'])]:
                    name=f'endoforge-p13-fresh-{os.getpid()}-{i}'
                    try: row=run(scope+args)
                    finally:
                        if backend=='dockerFresh': run(D+['rm','-f',name],False)
                    value=json.loads(row['stdout']); assert value['ok']
                    timings[backend].append({'wallMs':row['wallMs'],**value})
        finally: run(D+['rm','-f',persistent],False)
    save(R/'timings.json',timings)
    save(R/'summary.json',{'label':'Recorded (probe)','cleanDependenciesMatch':not differences,'replayParity':all(x['match'] for x in parity),'candidateCount':len(parity),'comparisons':parity,'equalResourceArmQualified':qualified,'timingMs':{k:{'host':metrics([r['wallMs'] for r in v]),'work':metrics([r['workMs'] for r in v])} for k,v in timings.items() if v},'elapsedSeconds':time.monotonic()-START})
    assert not differences and all(x['match'] for x in parity)


if __name__=='__main__':
    if W.exists() or (R/'environment.json').exists():
        raise SystemExit('Existing attempt refused without changing evidence.')
    try: main()
    except Exception as e:
        save(R/'failure.json',{'error':str(e),'elapsedSeconds':time.monotonic()-START})
        raise
