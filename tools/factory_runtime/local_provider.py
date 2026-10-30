"""Explicit local model gateway: one fixed loopback endpoint, never generic LAN."""
import http.client,json,os,socketserver,threading
ALIAS='qwen.endoforge.invalid'
class Gateway(socketserver.ThreadingUnixStreamServer):
 daemon_threads=True;request_queue_size=4
 def __init__(self,path,port):
  if not isinstance(port,int) or not 1024<=port<=65535:raise ValueError('invalid dedicated server port')
  self.port=port;self.events=[];self.lock=threading.BoundedSemaphore(1);super().__init__(str(path),Handler);os.chmod(path,0o600)
 def event(self,value):
  if len(self.events)>=128:self.events.pop(0)
  self.events.append(value)
class Handler(socketserver.StreamRequestHandler):
 def handle(self):
  self.connection.settimeout(185)
  try:
   line=self.rfile.readline(8193).decode('ascii').strip().split()
   if len(line)!=3 or line[0]!='POST' or line[1]!=f'http://{ALIAS}/v1/chat/completions':raise ValueError('only exact local chat provider route allowed')
   headers={};total=0
   while True:
    raw=self.rfile.readline(8193);total+=len(raw)
    if total>16384:raise ValueError('header budget')
    if raw==b'\r\n':break
    key,value=raw.decode('ascii').split(':',1);headers[key.lower()]=value.strip()
   if headers.get('host')!=ALIAS or 'transfer-encoding' in headers:raise ValueError('host/chunked request denied')
   length=int(headers.get('content-length','0'))
   if not 0<length<=65536:raise ValueError('body budget')
   body=self.rfile.read(length)
   if len(body)!=length:raise ValueError('short body')
   data=json.loads(body)
   if not isinstance(data,dict) or set(data)-{'model','messages','max_tokens','temperature','stream'}:raise ValueError('unknown fields/tools forbidden')
   if data.get('model')!='qwen-local' or data.get('stream',False) is not False or data.get('temperature',0)!=0:raise ValueError('model/stream/temperature policy')
   tokens=data.get('max_tokens',64)
   if type(tokens)is not int or not 1<=tokens<=3072:raise ValueError('token budget')
   messages=data.get('messages')
   if not isinstance(messages,list) or not 1<=len(messages)<=4 or any(not isinstance(m,dict) or set(m)!={'role','content'} or m['role']not in ['system','user'] or not isinstance(m['content'],str) or len(m['content'])>50000 for m in messages):raise ValueError('messages policy')
   if not self.server.lock.acquire(blocking=False):raise ValueError('local inference capacity busy')
   try:
    upstream=http.client.HTTPConnection('localhost',self.server.port,timeout=180)
    try:
     upstream.request('POST','/v1/chat/completions',body,{'Content-Type':'application/json'});response=upstream.getresponse();payload=response.read(262145)
     if len(payload)>262144 or response.status!=200:raise ValueError('local inference response failed/budget')
    finally:upstream.close()
   finally:self.server.lock.release()
   self.server.event({'decision':'allowed','route':ALIAS,'maxTokens':tokens,'backend':'exact fixed loopback chat endpoint','responseBytes':len(payload)})
   self.wfile.write(b'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: '+str(len(payload)).encode()+b'\r\nConnection: close\r\n\r\n'+payload)
  except Exception as e:
   self.server.event({'decision':'denied','reason':str(e)[:100]})
   try:self.wfile.write(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
   except OSError:pass

def serve(path,port):
 gateway=Gateway(path,port);threading.Thread(target=gateway.serve_forever,daemon=True).start();return gateway

def call_protected(root,stage,prompt,port,max_tokens=3072,timeout=180,role='eval_writer',freeze=None,journal=None,row=None):
 """One isolated no-retry local turn, optionally owned by caller ModelJournal.

 With journal+row, helper creates its private_home, sets exact declared scope
 and Description, and records started before execution. Caller records terminal
 result and invokes journal.cleanup_owned afterward. Helper always stops only
 its checked scope; it preserves journal-owned temporary data for that cleanup.
 """
 import hashlib,shutil,tempfile,time,subprocess,uuid
 from pathlib import Path
 from . import core,egress
 if (journal is None)!=(row is None):raise ValueError('journal and row must be supplied together')
 if not core.valid_id(stage):raise ValueError('unsafe stage')
 if journal is not None and (row.get('stage')!=stage or row.get('promptSha256')!=hashlib.sha256(prompt.encode()).hexdigest()):raise ValueError('journal stage/prompt identity mismatch')
 root=Path(root);dest=root/stage;dest.mkdir(parents=True,exist_ok=False)
 if journal is not None:
  journal.check();home=journal.private_home(row['attempt']);temporary=home.parent
 else:
  temporary=Path(tempfile.mkdtemp(prefix='ef-local-role-'));home=temporary/'home';home.mkdir()
 proxy=None;begin=time.monotonic();unit=None;description=None;cleanup=[]
 try:
  out=temporary/'out';out.mkdir();proxy=serve(temporary/'proxy.sock',port)
  payload={'model':'qwen-local','messages':[{'role':'user','content':prompt}],'temperature':0,'stream':False,'max_tokens':max_tokens}
  client=dest/'request-client.py';client.write_text('import urllib.request\nr=urllib.request.Request('+repr('http://'+ALIAS+'/v1/chat/completions')+',data='+repr(json.dumps(payload).encode())+',headers={"Content-Type":"application/json"})\nwith urllib.request.urlopen(r,timeout=180) as response:print(response.read().decode())\n')
  argv=egress.role_worker_command(role,home,out,temporary/'proxy.sock',['python','/in/request'],{'request':client},freeze=freeze)
  if journal is not None:
   unit=row['scope'];description=journal.scope_description(row['attempt']);argv[argv.index('--unit')+1]=unit.removesuffix('.scope')
  else:
   unit=argv[argv.index('--unit')+1]+'.scope';description='endoforge-local-role:'+unit
  argv[argv.index('--unit'):argv.index('--unit')]=['-p','Description='+description]
  core.durable(dest/'ownership.json',{'scope':unit,'description':description,'journalRoot':str(journal.root) if journal else None,'attempt':row['attempt'] if row else None})
  if journal is not None:
   observed=journal.read(row['attempt'])
   if observed['state']=='planned':journal.started(row['attempt'])
   elif observed['state']!='running':raise ValueError('local model attempt already terminal')
  result=egress.run_bounded(argv,timeout=timeout,output_limit=1048576);core.durable(dest/'execution.json',result)
  if result['exit']!=0:raise RuntimeError('protected local model turn failed; see private execution')
  response=json.loads(result['stdout']);message=response['choices'][0]['message'];text=message.get('content','');usage=response.get('usage',{})
  if not text or not usage:raise RuntimeError('local response missing content/usage')
  metadata={'version':1,'family':'local-qwen','model':response.get('model','qwen-local'),'stage':stage,'outcome':'passed','tokens':usage.get('total_tokens',0),'usage':usage,'wallMs':(time.monotonic()-begin)*1000,'promptSha256':hashlib.sha256(prompt.encode()).hexdigest(),'proxyEvents':proxy.events,'providerRoute':'exact local chat gateway; no general host/LAN egress','paidProvider':False}
  core.durable(dest/'metadata.json',metadata);(dest/'result.txt').write_text(text)
  return {'text':text,'metadata':metadata,'stagePath':str(dest)}
 finally:
  if proxy:proxy.shutdown();proxy.server_close()
  if unit:
   found=subprocess.run(['systemctl','--user','show',unit,'--property=Description','--property=LoadState'],capture_output=True,text=True,timeout=10)
   properties=dict(line.split('=',1) for line in found.stdout.splitlines() if '=' in line)
   if found.returncode!=0:raise RuntimeError('local role scope state unavailable')
   if properties.get('LoadState')=='loaded':
    if properties.get('Description')!=description:raise RuntimeError('local role scope ownership mismatch; no mutation')
    subprocess.run(['systemctl','--user','stop',unit],check=True,timeout=15);cleanup.append({'scope':unit,'stopped':True})
   elif properties.get('LoadState')=='not-found':cleanup.append({'scope':unit,'absent':True})
   else:raise RuntimeError('unexpected local role scope state')
  if journal is None:shutil.rmtree(temporary)
  core.durable(dest/'scope-cleanup.json',{'actions':cleanup})
  core.durable(dest/'credential-cleanup.json',{'temporaryRemoved':not temporary.exists(),'journalOwnsTemporary':journal is not None,'credentialsCopied':False})
