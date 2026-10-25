"""Dedicated bounded existing Qwen server and isolated role route; max one tiny call."""
import hashlib,json,os,resource,shutil,socket,subprocess,tempfile,time,urllib.request,uuid
from pathlib import Path
from . import core,egress,local_provider
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime/local-qwen-20261018';LLM=Path('/home/user/LOCAL LLM');RT=LLM/'runtime/b10988'
def main():
 A.mkdir(exist_ok=False);cfg=json.loads((LLM/'config.json').read_text());model=Path(cfg['model']);binary=RT/'llama-server'
 with socket.socket() as probe:probe.bind(('127.0.0.1',0));port=probe.getsockname()[1]
 core.durable(A/'precommit.json',{'version':1,'createdBeforeServerUnix':time.time(),'maxLocalModelCalls':1,'paidCalls':0,'model':str(model),'modelBytes':model.stat().st_size,'binarySha256':core.digest(binary),'configSha256':core.digest(LLM/'config.json'),'port':port,'context':4096,'maxTokens':64,'reasoning':'off','gateway':'exact POST qwen.endoforge.invalid/v1/chat/completions → fixed127.0.0.1 port; no generic LAN/CONNECT','limits':{'CPUQuota':'400%','MemoryMax':'32G','TasksMax':128,'RuntimeMaxSec':300,'logBytes':8388608},'sourceHashes':{p.name:core.digest(p) for p in Path(__file__).parent.glob('*.py')}})
 # Full existing model hash, no copy/download.
 h=hashlib.sha256()
 with model.open('rb') as stream:
  while chunk:=stream.read(16*1024*1024):h.update(chunk)
 core.durable(A/'model-identity.json',{'path':str(model),'bytes':model.stat().st_size,'sha256':h.hexdigest()})
 unit='endoforge-qwen-'+uuid.uuid4().hex;env=os.environ.copy();env['LD_LIBRARY_PATH']=str(RT)
 args=[str(binary),'-m',str(model),'--alias','qwen-local','--host','127.0.0.1','--port',str(port),'-c','4096','--parallel','1','--fit','on','--fit-ctx','4096','--fit-target','1536','-fa','on','-ctk','q8_0','-ctv','q8_0','--no-mmproj','--jinja','--reasoning','off','--no-webui','--no-ui-mcp-proxy','--threads','4','--threads-batch','4','--threads-http','2']
 cmd=['systemd-run','--user','--scope','--quiet','--unit',unit,'-p','RuntimeMaxSec=300s','-p','CPUQuota=400%','-p','MemoryMax=32G','-p','MemorySwapMax=0','-p','TasksMax=128']+args
 scratch=Path(tempfile.mkdtemp(prefix='endoforge-local-provider-'));gateway=None;process=None
 def bounds():resource.setrlimit(resource.RLIMIT_FSIZE,(8388608,8388608))
 try:
  with (A/'server.log').open('wb') as log:
   process=subprocess.Popen(cmd,stdout=log,stderr=subprocess.STDOUT,env=env,preexec_fn=bounds)
   ready=False;began=time.monotonic()
   for _ in range(180):
    if process.poll()is not None:raise RuntimeError('dedicated model server exited; see server.log')
    try:
     with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=1)as response:ready=json.load(response).get('status')=='ok'
    except Exception:pass
    if ready:break
    time.sleep(.5)
   if not ready:raise RuntimeError('dedicated model server readiness deadline')
   core.durable(A/'server-ready.json',{'version':1,'ready':True,'wallMs':(time.monotonic()-began)*1000,'unit':unit+'.scope','port':port,'argv':cmd,'gpu':subprocess.check_output(['nvidia-smi','--query-gpu=name,memory.total,memory.used','--format=csv,noheader'],text=True).strip()})
   home=scratch/'home';home.mkdir();out=scratch/'out';out.mkdir();gateway=local_provider.serve(scratch/'proxy.sock',port)
   # Pure request client is mounted read-only as a role request; no host auth.
   client=A/'client.py';client.write_text('''import json,urllib.request
payload={"model":"qwen-local","messages":[{"role":"user","content":"Return only the integer 7."}],"max_tokens":64,"temperature":0,"stream":False}
r=urllib.request.Request("http://qwen.endoforge.invalid/v1/chat/completions",data=json.dumps(payload).encode(),headers={"Content-Type":"application/json"})
with urllib.request.urlopen(r,timeout=65) as response:print(response.read().decode())
''')
   command=egress.role_worker_command('eval_writer',home,out,scratch/'proxy.sock',['python','/in/request'],{'request':client});result=egress.run_bounded(command,timeout=70);core.durable(A/'role-execution.json',result)
   if result['exit']!=0:raise RuntimeError('isolated local role request failed')
   response=json.loads(result['stdout']);content=response['choices'][0]['message'].get('content','').strip();assert content=='7',response
   negative={}
   for name,url in [('host',f'http://127.0.0.1:{port}/v1/chat/completions'),('metadata','http://169.254.169.254/latest/meta-data/'),('management','http://qwen.endoforge.invalid/slots')]:
    argv=egress.role_worker_command('eval_writer',home,out,scratch/'proxy.sock',['curl','-fsS','--max-time','3',url],{})
    observed=egress.run_bounded(argv,timeout=5);assert observed['exit']!=0;negative[name]=observed
   core.durable(A/'negative-routes.json',negative);core.durable(A/'gateway-events.json',gateway.events);core.durable(A/'qualification.json',{'version':1,'passed':True,'family':'local-qwen','result':content,'usage':response.get('usage'),'localModelCalls':1,'providerRoute':'explicit fixed local gateway; worker direct LAN/host remains denied','originalControllerUntouched':True,'independence':'different model weights/runtime from hosted Codex; source-weight provenance not independently audited'})
 except BaseException as e:
  core.durable(A/'failure.json',{'type':type(e).__name__,'error':str(e)});raise
 finally:
  if gateway:gateway.shutdown();gateway.server_close()
  subprocess.run(['systemctl','--user','stop',unit+'.scope'],capture_output=True)
  if process:process.wait(timeout=15)
  shutil.rmtree(scratch);core.durable(A/'cleanup.json',{'temporaryRemoved':not scratch.exists(),'dedicatedUnitStopped':subprocess.run(['systemctl','--user','is-active','--quiet',unit+'.scope']).returncode!=0,'originalConfigSha256':core.digest(LLM/'config.json'),'noUserControllerModified':True})
 print(A)
if __name__=='__main__':main()
