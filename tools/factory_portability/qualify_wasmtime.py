#!/usr/bin/env python3
"""Offline smoke checks against the content-pinned Wasmtime executable."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path

CHECKS=[('answer','(module (func (export "run") (result i32) i32.const 42))',0),('loop','(module (func (export "run") (loop br 0)))',1),('trap','(module (func (export "run") unreachable))',1)]


def qualify(bundle):
    bundle=Path(bundle);pins=json.loads((bundle/'toolchain.json').read_text());wt=bundle/'bin/wasmtime'
    pinned=pins['files']['bin/wasmtime']['sha256']
    if hashlib.sha256(wt.read_bytes()).hexdigest()!=pinned:raise ValueError('wasmtime does not match its pinned sha256')
    rows=[]
    with tempfile.TemporaryDirectory() as td:
        for name,wat,expected in CHECKS:
            p=Path(td)/(name+'.wat');p.write_text(wat)
            argv=[str(wt),'run','-W','fuel=100000','-W','timeout=100ms','-W','max-memory-size=1048576','--invoke','run',str(p)]
            cp=subprocess.run(argv,capture_output=True,text=True,timeout=5)
            if (cp.returncode==0)!=(expected==0):raise ValueError(f'{name}: unexpected exit {cp.returncode}')
            if name=='answer' and cp.stdout.strip()!='42':raise ValueError('answer: expected 42')
            if name=='loop' and 'fuel' not in cp.stderr:raise ValueError('loop: fuel exhaustion not reported')
            if name=='trap' and 'unreachable' not in cp.stderr:raise ValueError('trap: unreachable trap not reported')
            rows.append({'name':name,'argv':argv,'exit':cp.returncode,'stdout':cp.stdout,'stderr':cp.stderr})
    return {'passed':True,'wasmtime_sha256':pinned,'checks':rows}


def main(argv=None):
    args=sys.argv[1:] if argv is None else argv
    if len(args)!=1:
        print('usage: qualify_wasmtime.py <bundle>',file=sys.stderr);return 2
    try:result=qualify(args[0])
    except (ValueError,OSError,KeyError,subprocess.TimeoutExpired) as e:
        print(json.dumps({'passed':False,'error':str(e)},indent=2));return 1
    print(json.dumps(result,indent=2));return 0


if __name__=='__main__':raise SystemExit(main())
