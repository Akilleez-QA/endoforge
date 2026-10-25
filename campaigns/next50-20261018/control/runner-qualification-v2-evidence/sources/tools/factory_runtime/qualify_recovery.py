import json,os,subprocess,time,uuid
from pathlib import Path
from . import core
from .runner import run_attempt
from .recovery import reconcile
R=Path(__file__).resolve().parents[2];A=R/'campaigns/next50-20261018/runtime'/('recovery-'+uuid.uuid4().hex[:8]);A.mkdir()
def save(n,v):core.durable(A/(n+'.json'),v)
def main():
 inp=A/'input';inp.write_text('durable\n');sha=core.digest(inp);root=A/'runner';results={}
 for point in ['artifact_fsynced','validation_receipt_fsynced','publication_fsynced','terminal_receipt_fsynced']:
  code="import os;import tools.factory_runtime.runner as r;r._checkpoint=lambda point:os._exit(99) if point=="+repr(point)+" else None;r.run_attempt(*"+repr([str(root),point,point,str(inp),sha,sha,'cat /input.txt',3])+")"
  p=subprocess.run(['python','-c',code],cwd=R,capture_output=True,text=True);assert p.returncode==99,p
  got=reconcile(root,point);results[point]=got
  expected='publication_recovered' if point in ['publication_fsynced','terminal_receipt_fsynced'] else 'interrupted_reconciled';assert got['outcome']==expected,got
  if expected=='publication_recovered':
   assert core.digest(root/'published'/(point+'.txt'))==sha
   second=reconcile(root,point);assert second['outcome']=='publication_recovered';results[point+'-second']=second
 save('crash-boundaries',results)
 identity=core.identity();forged=dict(identity,starttime=str(int(identity['starttime'])+1));assert core.alive(identity) and not core.alive(forged)
 with core.Fence(A/'fence') as fence:
  core.durable(A/'fence/controller.json',{'version':1,'generation':'f'*32,'identity':identity},False)
  try:fence.check()
  except RuntimeError:pass
  else:raise AssertionError('stale generation accepted')
 save('identities',{'actual':identity,'simulatedPidReuse':forged,'reuseDenied':True,'staleGenerationDenied':True})
 # Actual runner refuses link alias input before creating any worker container.
 link=A/'symlink';link.symlink_to(inp);got=run_attempt(root,'hostile-symlink','hostile',link,sha,sha,'cat /input.txt',3);assert got['outcome']=='controller_error' and 'containerId' not in got;save('runner-hostile-input',got)
 # Unknown archive format path and hostile mount trees refused before bwrap.
 hostile={}
 for label in ['symlink','hardlink','socket']:
  directory=A/('mount-'+label);directory.mkdir()
  if label=='symlink':(directory/'bad').symlink_to(inp)
  elif label=='hardlink':os.link(inp,directory/'bad')
  else:
   import socket
   sock=socket.socket(socket.AF_UNIX);sock.bind(str(directory/'bad'));sock.close()
  try:core.validate_mount_tree(directory)
  except ValueError as e:hostile[label]=str(e)
  else:raise AssertionError('unsafe mount')
 try:core.import_archive(b'../../receipts')
 except ValueError as e:hostile['archive']=str(e)
 save('hostile-mounts',hostile)
 fixtures={}
 for state in ['timeout','cancelled','unknown','queued','publication_recovered']:
  record={'version':1,'kind':'receipt','job':'fixture','attempt':'retry' if state=='queued' else 'attempt','parent':'prior' if state=='queued' else None,'state':state,'usage':{'wallMs':0,'tokens':None},'hashes':{'artifact':sha} if state=='publication_recovered' else {'input':sha},'error':{'type':state,'message':'fixture'}}
  core.validate_record(record,'receipt');fixtures[state]=record
 for bad in [dict(fixtures['unknown'],version=2),dict(fixtures['unknown'],state='pretend_success'),dict(fixtures['publication_recovered'],hashes={})]:
  try:core.validate_record(bad,'receipt')
  except ValueError:pass
  else:raise AssertionError('invalid fixture accepted')
 core.transition('queued','running');core.transition('running','timeout')
 try:core.transition('queued','passed')
 except ValueError:pass
 else:raise AssertionError('illegal transition')
 save('receipt-schema-fixtures',fixtures);print(A)
if __name__=='__main__':main()
