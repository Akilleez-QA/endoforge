import subprocess,json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parents[2];D=R/'campaigns/next50-20261018/quality';p=D/'provider-fixture.json';sha=lambda:hashlib.sha256(p.read_bytes()).hexdigest();before=sha();results=[]
for role in ['eval','generator']:
 b=['bwrap','--unshare-all','--die-with-parent','--new-session']
 for root in ['/usr','/bin','/lib','/lib64']:
  if Path(root).exists():b+=['--ro-bind',root,root]
 b+=['--proc','/proc','--dev','/dev','--tmpfs','/tmp']
 if role=='eval':b+=['--ro-bind',str(p),'/reference.json']
 script=f'if cat "{p}" >/dev/null 2>&1; then exit 10; fi; '
 script+= 'cat /reference.json >/dev/null; if (printf tamper >/reference.json) 2>/dev/null; then exit 11; fi' if role=='eval' else 'if cat /reference.json >/dev/null 2>&1; then exit 12; fi'
 x=subprocess.run(b+['/bin/sh','-c',script],capture_output=True,text=True,timeout=10);results.append({'role':role,'exit':x.returncode,'passed':x.returncode==0,'stderr':x.stderr})
result={'version':1,'passed':all(x['passed']for x in results)and sha()==before,'sourceHash':before,'sourceUnchanged':sha()==before,'checks':results,'scope':'actual role mount probe, no model or production runner claim'};(D/'reference-boundary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
