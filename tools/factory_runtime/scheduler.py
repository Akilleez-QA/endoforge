"""FIFO bounded scheduling; no provider substitution, one request per step."""
import time
import json
from pathlib import Path
from .core import durable,Fence
class Scheduler:
 def __init__(self,capacity=1,max_retries=2,backoff_seconds=60,root=None):
  if not 1<=capacity<=8:raise ValueError('capacity')
  self.capacity=capacity;self.max_retries=max_retries;self.backoff=backoff_seconds;self.jobs=[];self.path=Path(root)/"scheduler.json" if root else None
  self._reload()
 def _submit(self,job):
  if any(j['job']==job for j in self.jobs):raise ValueError('duplicate job')
  self.jobs.append({'job':job,'state':'queued','retries':0,'eligible':0});self.save()
 def _step(self,run,now=None):
  now=time.time() if now is None else now
  ready=[j for j in self.jobs if j['state'] in ['queued','blocked'] and j['eligible']<=now][:self.capacity]
  for j in ready:
   j['state']='running';self.save()
   try:r=run(j['job'])
   except Exception as e:r={'outcome':'failed','error':str(e)}
   if not isinstance(r,dict) or not isinstance(r.get('outcome'),str):r={'outcome':'failed','error':'malformed run result'}
   if r['outcome']=='subscription_limit' and j['retries']<self.max_retries:
    j['retries']+=1;j.update(state='blocked',eligible=now+self.backoff*2**(j['retries']-1))
   else:j.update(state='passed' if r['outcome']=='passed' else 'failed',result=r)
  self.save();return self.jobs

 def save(self):
  if self.path:durable(self.path,{'version':1,'jobs':self.jobs},False)

 def _reload(self):
  if self.path and self.path.exists():
   saved=json.loads(self.path.read_text())
   if not isinstance(saved,dict) or saved.get('version')!=1 or not isinstance(saved.get('jobs'),list):raise ValueError('unknown scheduler version')
   self.jobs=saved['jobs']
   for j in self.jobs:
    if j['state']=='running':j.update(state='unknown',result={'outcome':'unknown','error':'controller interrupted; reconcile before retry'})
 def submit(self,job):
  if not self.path:return self._submit(job)
  with Fence(self.path.parent/'scheduler-control'):
   self._reload();return self._submit(job)
 def step(self,run,now=None):
  if not self.path:return self._step(run,now)
  with Fence(self.path.parent/'scheduler-control'):
   self._reload();return self._step(run,now)
