"""Start/stop one explicitly owned, bounded dedicated Qwen service lease."""
import json,os,socket,subprocess,time,urllib.request,uuid,sys
from pathlib import Path
from . import core
R=Path(__file__).resolve().parents[2];LLM=Path('/home/user/LOCAL LLM');RT=LLM/'runtime/b10988'
def start(root,seconds=1800,context=8192):
 root=Path(root);root.mkdir(exist_ok=False);cfg=json.loads((LLM/'config.json').read_text())
 with socket.socket() as socket_probe:socket_probe.bind(('127.0.0.1',0));port=socket_probe.getsockname()[1]
 token=uuid.uuid4().hex;unit='endoforge-qwen-lease-'+token;description='endoforge-local-qwen:'+token
 args=[str(RT/'llama-server'),'-m',cfg['model'],'--alias','qwen-local','--host','127.0.0.1','--port',str(port),'-c',str(context),'--parallel','1','--fit','on','--fit-ctx',str(context),'--fit-target','1536','-fa','on','-ctk','q8_0','-ctv','q8_0','--no-mmproj','--jinja','--reasoning','off','--no-webui','--no-ui-mcp-proxy','--threads','4','--threads-batch','4','--threads-http','2']
 cmd=['systemd-run','--user','--collect','--quiet','--unit',unit,'--setenv','LD_LIBRARY_PATH='+str(RT),'-p','Description='+description,'-p','Type=exec','-p',f'RuntimeMaxSec={seconds}s','-p','CPUQuota=400%','-p','MemoryMax=32G','-p','MemorySwapMax=0','-p','TasksMax=128','-p','LimitFSIZE=8388608','-p','StandardOutput=append:'+str(root/'server.log'),'-p','StandardError=append:'+str(root/'server.log')]+args
 row={'version':1,'unit':unit+'.service','description':description,'port':port,'endpoint':f'http://127.0.0.1:{port}/v1/chat/completions','model':'qwen-local','context':context,'lifetimeSeconds':seconds,'createdUnix':time.time(),'sourceConfigSha256':core.digest(LLM/'config.json'),'binarySha256':core.digest(RT/'llama-server'),'modelIdentityReceipt':str(R/'campaigns/next50-20261018/runtime/local-qwen-20261018/model-identity.json'),'argv':cmd,'requestDeadlineSeconds':180,'ownerRoot':str(root.resolve())}
 core.durable(root/'lease.json',row);subprocess.run(cmd,check=True)
 try:
  for _ in range(180):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=1) as response:
     if json.load(response).get('status')=='ok':core.durable(root/'ready.json',{'ready':True,'atUnix':time.time()});return row
   except Exception:pass
   active=subprocess.run(['systemctl','--user','is-active','--quiet',row['unit']]).returncode==0
   if not active:raise RuntimeError('dedicated leased service failed; see server.log')
   time.sleep(.5)
  raise RuntimeError('leased service readiness deadline')
 except BaseException:stop(root);raise

def stop(root):
 root=Path(root);row=json.loads((root/'lease.json').read_text());found=subprocess.run(['systemctl','--user','show',row['unit'],'--property=Description','--property=LoadState'],capture_output=True,text=True,check=True);properties=dict(line.split('=',1) for line in found.stdout.splitlines() if '=' in line)
 if properties.get('LoadState')=='loaded':
  if properties.get('Description')!=row['description']:raise RuntimeError('lease service ownership mismatch')
  subprocess.run(['systemctl','--user','stop',row['unit']],check=True)
 core.durable(root/('stopped-'+uuid.uuid4().hex[:8]+'.json'),{'version':1,'unit':row['unit'],'stoppedUnix':time.time(),'originalConfigSha256':core.digest(LLM/'config.json')})
if __name__=='__main__':
 if sys.argv[1]=='start':print(json.dumps(start(Path(sys.argv[2]))))
 elif sys.argv[1]=='stop':stop(Path(sys.argv[2]))
