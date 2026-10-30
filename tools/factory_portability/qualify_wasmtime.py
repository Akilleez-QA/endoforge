#!/usr/bin/env python3
"""Offline smoke checks against the content-pinned Wasmtime executable."""
import hashlib,json,subprocess,sys,tempfile
from pathlib import Path
bundle=Path(sys.argv[1]); pins=json.loads((bundle/'toolchain.json').read_text()); wt=bundle/'bin/wasmtime'
assert hashlib.sha256(wt.read_bytes()).hexdigest()==pins['files']['bin/wasmtime']['sha256']
rows=[]
with tempfile.TemporaryDirectory() as td:
    for name,wat,expected in [('answer','(module (func (export "run") (result i32) i32.const 42))',0),('loop','(module (func (export "run") (loop br 0)))',1),('trap','(module (func (export "run") unreachable))',1)]:
        p=Path(td)/(name+'.wat'); p.write_text(wat)
        argv=[str(wt),'run','-W','fuel=100000','-W','timeout=100ms','-W','max-memory-size=1048576','--invoke','run',str(p)]
        cp=subprocess.run(argv,capture_output=True,text=True,timeout=5)
        assert (cp.returncode==0)==(expected==0)
        if name=='answer': assert cp.stdout.strip()=='42'
        if name=='loop': assert 'fuel' in cp.stderr
        rows.append({'name':name,'argv':argv,'exit':cp.returncode,'stdout':cp.stdout,'stderr':cp.stderr})
print(json.dumps({'passed':True,'wasmtime_sha256':hashlib.sha256(wt.read_bytes()).hexdigest(),'checks':rows},indent=2))
