"""Pinned Wasmtime invocation with fuel, epoch timeout and memory ceilings."""
import os,resource,shutil,hashlib
from pathlib import Path
WT=Path(os.environ.get('ENDOFORGE_WASMTIME', 'wasmtime'))
def binary():
 found=WT if WT.is_absolute() or os.sep in str(WT) else shutil.which(str(WT))
 if not found or not Path(found).is_file():raise ValueError('Wasmtime binary not found')
 return Path(found)
def run(module,export='run',fuel=100000,memory=1048576,epoch='100ms',wall=2,args=None):
 if not os.environ.get('ENDOFORGE_WASMTIME_SHA256'):raise ValueError('Wasmtime binary identity mismatch')
 wt=binary()
 if hashlib.sha256(wt.read_bytes()).hexdigest()!=os.environ['ENDOFORGE_WASMTIME_SHA256']:raise ValueError('Wasmtime binary identity mismatch')
 cmd=[str(wt),'run','-W',f'fuel={fuel}','-W',f'max-memory-size={memory}','-W','trap-on-grow-failure=y','-W',f'timeout={epoch}','--invoke',export,str(module)]+[str(a) for a in (args or [])]
 def bounds():
  resource.setrlimit(resource.RLIMIT_CPU,(2,2));resource.setrlimit(resource.RLIMIT_FSIZE,(1048576,1048576))
 from .egress import run_bounded
 import uuid
 scoped=['systemd-run','--user','--scope','--quiet','--unit','endoforge-wasm-'+uuid.uuid4().hex,'-p','RuntimeMaxSec=3s','-p','MemoryMax=512M','-p','MemorySwapMax=0','-p','TasksMax=32','-p','CPUQuota=100%']+cmd
 result=run_bounded(scoped,timeout=wall,output_limit=1048576,preexec_fn=bounds)
 result.update(argv=scoped,wallTimeout=result['outcome']=='timeout')
 return result
