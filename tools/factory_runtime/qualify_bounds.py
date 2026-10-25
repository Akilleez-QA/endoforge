import hashlib,json,os,subprocess,tempfile,uuid,shutil
from pathlib import Path
from .runner import run_attempt
from .core import durable,digest
from . import egress
from .wasm import run as wasm
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('bounds-'+uuid.uuid4().hex[:8]);A.mkdir()
def save(n,v):durable(A/(n+'.json'),v)
def main():
 inp=A/'input';inp.write_text('ok\n');sha=digest(inp);root=A/'runner';rs={}
 cases={
 'output':'dd if=/dev/zero of=/out/full bs=1M count=12; test $? -ne 0 && cat /input.txt',
 'scratch':'dd if=/dev/zero of=/tmp/full bs=1M count=70; test $? -ne 0 && cat /input.txt',
 'readonly':'touch /rogue 2>/dev/null; test $? -ne 0 && cat /input.txt',
 'memory':'''node -e 'let a=[];for(let i=0;i<200;i++)a.push(Buffer.alloc(8*1024*1024,42))' ''',
 'processes':'''node -e 'const cp=require("child_process");let n=0;for(let i=0;i<80;i++){let c=cp.spawn("sleep",["20"]);c.on("error",e=>{console.error(e.code);process.exit(7)});n++}' ''',
 'logs':'dd if=/dev/zero bs=1M count=4 1>&2; cat /input.txt'}
 for n,script in cases.items():rs[n]=run_attempt(root,n,n,inp,sha,sha,script,5)
 assert all(rs[n]['outcome']=='passed' for n in ['output','scratch','readonly']),rs
 assert rs['memory']['outcome']=='worker_failed' and rs['memory']['terminalState']['OOMKilled'],rs['memory']
 assert rs['processes']['outcome']=='worker_failed',rs['processes']
 for p in root.glob('attempts/*/stderr.log'):assert p.stat().st_size<1200000
 save('docker-budgets',rs)
 scratch=Path(tempfile.mkdtemp(prefix='endoforge-bounds-'));server=None
 try:
  home=scratch/'home';home.mkdir();out=scratch/'out';out.mkdir();server=egress.serve(scratch/'proxy.sock');checks={}
  for path,size in [('/out',12),('/tmp',70),('/home/worker',70)]:
   script=f'dd if=/dev/zero of={path}/full bs=1M count={size}; test $? -ne 0'
   r=egress.run_bounded(egress.worker_command(home,out,scratch/'proxy.sock',['sh','-c',script]),10);assert r['exit']==0,r;checks[path]=r
  r=egress.run_bounded(egress.worker_command(home,out,scratch/'proxy.sock',['sh','-c','yes flood']),10,4096);assert r['outcome']=='output_limit' and len(r['stdout'])<=4096;checks['logs']=r
  r=egress.run_bounded(egress.worker_command(home,out,scratch/'proxy.sock',['sh','-c','for p in /rogue /dev/rogue /in-rogue; do if (echo x >$p) 2>/dev/null; then exit 20; fi; done; grep CapEff /proc/self/status']),10);assert r['exit']==0 and '0000000000000000' in r['stdout'];checks['root-and-capabilities']=r
  save('model-budgets',checks)
 finally:
  if server:server.shutdown();server.server_close()
  shutil.rmtree(scratch)
 wat=A/'numeric.wat';wat.write_text('(module (func (export "add") (param f64 f64) (result f64) local.get 0 local.get 1 f64.add))')
 r=wasm(wat,export='add',args=[2.5,4]);assert r['exit']==0 and r['stdout'].strip()=='6.5';save('wasm-args',r)
 print(A)
if __name__=='__main__':main()
