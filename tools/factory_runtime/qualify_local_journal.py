"""Journal-aware local role ownership against deterministic HTTP fixture; no model."""
import hashlib,json,threading,uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from . import core,local_provider
from tools.factory_campaign.model_journal import ModelJournal
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('local-journal-'+uuid.uuid4().hex[:8])
class Handler(BaseHTTPRequestHandler):
 def do_POST(self):
  self.rfile.read(int(self.headers['Content-Length']));data=json.dumps({'model':'deterministic-http-fixture','choices':[{'message':{'content':'fixture-ok'}}],'usage':{'prompt_tokens':1,'completion_tokens':1,'total_tokens':2}}).encode();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
 def log_message(self,*a):pass

def main():
 A.mkdir();server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  prompt='deterministic fixture request';stage='local-fixture'
  with ModelJournal(A/'journal') as journal:
   row=journal.new_attempt(stage,'deterministic-test',hashlib.sha256(prompt.encode()).hexdigest())
   result=local_provider.call_protected(A/'stages',stage,prompt,server.server_port,max_tokens=8,timeout=10,journal=journal,row=row)
   assert result['text']=='fixture-ok';started=journal.read(row['attempt']);assert started['state']=='running'
   journal.finish(row['attempt'],'passed',{'fixtureOnly':True});cleaned=journal.cleanup_owned(row['attempt']);assert not Path(row['temporary']).exists()
  core.durable(A/'qualification.json',{'version':1,'passed':True,'modelCalls':0,'actualRoleWrapper':True,'scopeDescriptionBound':True,'result':result,'terminalJournal':cleaned})
 finally:server.shutdown();server.server_close()
 print(A)
if __name__=='__main__':main()
