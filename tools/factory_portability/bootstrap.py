#!/usr/bin/env python3
"""Standalone lockfile installer/offline bundle verifier, Linux x86_64 glibc."""
import argparse, hashlib, json, os, shutil, subprocess, tempfile, time
from pathlib import Path

def digest(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def inventory(root):
    return {str(p.relative_to(root)):({'link':os.readlink(p)} if p.is_symlink() else {'sha256':digest(p)}) for p in sorted(root.rglob('*')) if p.is_symlink() or p.is_file()}
def save(p,v): p.write_text(json.dumps(v,indent=2)+'\n')
def command(args,env,logs):
    t=time.monotonic(); p=subprocess.run([str(a) for a in args],env=env,capture_output=True,text=True,timeout=120)
    logs.append({'argv':[str(a) for a in args],'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'wall_ms':1000*(time.monotonic()-t)})
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def environment(bundle):
    return {'PATH':str(bundle/'bin')+':/usr/bin:/bin','HOME':'/nonexistent','LC_ALL':'C','npm_config_update_notifier':'false'}
def install(bundle,dest,offline=True):
    if dest.exists(): raise FileExistsError(dest)
    dest.mkdir(); logs=[]
    try:
        shutil.copytree(bundle/'bin',dest/'bin'); shutil.copytree(bundle/'npm',dest/'npm',symlinks=True)
        shutil.copytree(bundle/'cache',dest/'cache'); shutil.copytree(bundle/'source',dest/'source',symlinks=True)
        for n in ['user.npmrc','global.npmrc']: (dest/n).write_text('')
        env=environment(dest); compiler=dest/'source/experiments/P-02-compiler-in-isolate'
        args=[dest/'bin/node',dest/'npm/bin/npm-cli.js','ci','--prefix',compiler,'--ignore-scripts','--no-audit','--no-fund',f'--userconfig={dest/"user.npmrc"}',f'--globalconfig={dest/"global.npmrc"}',f'--cache={dest/"cache"}','--fetch-retries=0','--fetch-timeout=20000']
        if offline: args.append('--offline')
        command(args,env,logs)
        return logs
    finally: save(dest/'install-receipt.json',logs)
def prepare(root,bundle,node,npm,wasmtime):
    if bundle.exists(): raise FileExistsError(bundle)
    bundle.mkdir(); (bundle/'bin').mkdir(); shutil.copy2(node,bundle/'bin/node'); shutil.copytree(npm,bundle/'npm',symlinks=True)
    shutil.copy2(wasmtime,bundle/'bin/wasmtime')
    source=bundle/'source'; compiler=source/'experiments/P-02-compiler-in-isolate'; compiler.mkdir(parents=True)
    for n in ['package.json','package-lock.json']: shutil.copy2(root/'experiments/P-02-compiler-in-isolate'/n,compiler/n)
    gate=source/'campaigns/x1-spec-study/factory'; gate.mkdir(parents=True)
    for n in ['gate.mjs','glue.schema.json']: shutil.copy2(root/'campaigns/x1-spec-study/factory'/n,gate/n)
    shutil.copytree(root/'experiments/P-09-portable-campaign/work/inputs/candidates',source/'candidates')
    expected={}
    for p in (root/'experiments/P-09-portable-campaign/receipt/docker').glob('*.json'):
        v=json.loads(p.read_text()); expected[p.stem]={'sha256':v['wasmSha256'],'exit':v['exit']}
    save(source/'expected.json',expected)
    (bundle/'cache').mkdir()
    # Empty first cache and dependency directory. Only this public registry step uses network.
    with tempfile.TemporaryDirectory(prefix='endoforge-fresh-bootstrap-') as td:
        fresh=Path(td)/'fresh'; logs=install(bundle,fresh,False)
        shutil.rmtree(bundle/'cache'); shutil.copytree(fresh/'cache',bundle/'cache')
        save(bundle/'fetch-receipt.json',logs)
    logs=[]; env=environment(bundle)
    pins={'schema':'endoforge.toolchain.v1','platform':'linux-x86_64-glibc','node':command([bundle/'bin/node','--version'],env,logs),'npm':command([bundle/'bin/node',bundle/'npm/bin/npm-cli.js','--version'],env,logs),'assemblyscript':'0.28.20','wasmtime':command([bundle/'bin/wasmtime','--version'],env,logs),'files':inventory(bundle),'assumptions':['Python 3 standard library','Linux x86_64 with compatible glibc','/usr/bin/env and shared libraries','Pinned local Wasmtime executable compatible with system shared libraries']}
    save(bundle/'toolchain.json',pins); return pins

def verify(bundle):
    pins=json.loads((bundle/'toolchain.json').read_text()); actual=inventory(bundle); actual.pop('toolchain.json')
    if actual!=pins['files']: raise ValueError('toolchain content mismatch')
    return pins

def replay(bundle,dest):
    verify(bundle); logs=install(bundle,dest,True); env=environment(dest); rows=[]
    expected=json.loads((dest/'source/expected.json').read_text())
    for name,e in sorted(expected.items()):
        candidate=dest/'source/candidates'/name
        t=time.monotonic(); p=subprocess.run([str(dest/'bin/node'),str(dest/'source/campaigns/x1-spec-study/factory/gate.mjs'),'run',str(candidate)],env=env,capture_output=True,text=True,timeout=90)
        result=json.loads((candidate/'result.json').read_text()); row={'id':name,'exit':p.returncode,'sha256':digest(candidate/'kernel.wasm'),'test_count':len(result['tests']),'stdout':p.stdout,'stderr':p.stderr,'wall_ms':1000*(time.monotonic()-t)}
        row['match']=row['sha256']==e['sha256'] and row['exit']==e['exit']; rows.append(row); save(dest/'replay-receipt.json',rows)
        if not row['match']: raise ValueError('replay mismatch '+name)
    return {'passed':True,'candidates':len(rows),'tests':sum(r['test_count'] for r in rows),'rows':rows}
if __name__=='__main__':
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    p=sub.add_parser('prepare'); p.add_argument('root',type=Path); p.add_argument('bundle',type=Path); p.add_argument('--node',required=True,type=Path); p.add_argument('--npm',required=True,type=Path); p.add_argument('--wasmtime',required=True,type=Path)
    p=sub.add_parser('replay'); p.add_argument('bundle',type=Path); p.add_argument('destination',type=Path)
    p=sub.add_parser('verify'); p.add_argument('bundle',type=Path)
    a=ap.parse_args()
    out=prepare(a.root.resolve(),a.bundle.resolve(),a.node,a.npm,a.wasmtime) if a.cmd=='prepare' else replay(a.bundle.resolve(),a.destination.resolve()) if a.cmd=='replay' else verify(a.bundle.resolve())
    print(json.dumps(out,indent=2))
