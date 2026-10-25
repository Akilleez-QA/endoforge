"""N34: actual live-generated candidate/frozen requirements, real Docker crash, no models."""
import json,os,shutil,signal,subprocess,sys,time,uuid
from pathlib import Path
from . import core,recovery
from tools.factory_campaign import pipeline as p,state
R=Path(__file__).resolve().parents[2];SOURCE=R/'campaigns/next50-20261018/work/executed50/clean-3d58d848/jobs/dev-affine-01';A=R/'campaigns/next50-20261018/runtime'/('actual-workflow-recovery-'+uuid.uuid4().hex[:8]);NAMES=['request.json','signature.json','eval-bundle.json','frozen.json','frozen-files.json','capability.json']
def child(root):
 original=p._script
 p._script=lambda mode:"printf 'PARTIAL_UNTRUSTED_OUTPUT\\n'; touch /tmp/compile-ready; sleep 90; "+original(mode) if mode=='compile' else original(mode)
 p.compile_candidate(root,root/'job',attempt='compile-interrupted')
def resume(root,label):
 job=root/'job';publication=root/'runtime/published/dev-affine-01.txt'
 if publication.exists():
  if core.digest(publication)!=core.digest(job/'capability.json'):raise ValueError('known publication digest mismatch')
  prior=json.loads((job/'publication-receipt.json').read_text());current=state.recover(job)
  if prior.get('outcome')!='passed' or not prior.get('published') or current.get('stage')!='published':raise ValueError('existing publication lacks accepted trusted evidence')
  result={'outcome':'known-publication-reused','published':True,'artifactSha256':core.digest(publication),'newAttemptCreated':False}
 else:result=p.verify_publish(root,job,attempt='verify-resumed')
 core.durable(root/(label+'.json'),result)
def main():
 A.mkdir();before={n:core.digest(SOURCE/n) for n in NAMES};sourcewasm=core.digest(SOURCE/'kernel.wasm');job=A/'job';job.mkdir()
 for name in NAMES:shutil.copyfile(SOURCE/name,job/name);(job/name).chmod(0o444)
 generated=[json.loads(f.read_text())['state'] for f in sorted((SOURCE/'state-events').glob('*.json')) if json.loads(f.read_text())['state']['stage']=='generated'][-1]
 state.record(job,generated)
 core.durable(A/'precommit.json',{'version':1,'modelCalls':0,'sourceLiveJob':str(SOURCE),'normativeHashes':before,'sourceWasmSha256':sourcewasm,'pipelineSha256':core.digest(Path(p.__file__)),'runnerSha256':core.digest(R/'tools/factory_runtime/runner.py'),'procedure':'Actual compile_candidate delayed in owned Docker; marker and partial stdout; controllerSIGKILL; exact reconcile; newcontroller full boundedverify/publish; repeat guarded knownpublication reuse','scope':'actual live-generated Celsius candidate and independently frozen suite; no regenerated models'})
 controller=subprocess.Popen([sys.executable,'-m','tools.factory_runtime.qualify_actual_workflow_recovery','--child',str(A)],cwd=R,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 try:
  journal=A/'runtime/journals/compile-interrupted.json';marker=False
  for _ in range(150):
   if journal.exists():
    row=json.loads(journal.read_text());name=row['containerName'];inspected=subprocess.run(['sudo','-n','docker','inspect',name],capture_output=True,text=True)
    if inspected.returncode==0:
     data=json.loads(inspected.stdout)[0]
     if data['Config']['Labels'].get('endoforge.owner')!=row['token']:raise ValueError('ownership mismatch')
     if data['State']['Running']:
      ready=subprocess.run(['sudo','-n','docker','exec',name,'test','-f','/tmp/compile-ready'],capture_output=True)
      if ready.returncode==0:marker=True;break
   if controller.poll() is not None:raise AssertionError(controller.communicate())
   time.sleep(.03)
  assert marker,'explicit compile marker missing';partial=subprocess.check_output(['sudo','-n','docker','logs',name],text=True);assert partial=='PARTIAL_UNTRUSTED_OUTPUT\n'
  core.durable(A/'ready-before-kill.json',{'container':data,'journal':row,'readinessMarker':'/tmp/compile-ready','stdout':partial,'controller':core.identity(controller.pid)})
  controller.kill();controller.wait(timeout=5);assert controller.returncode==-signal.SIGKILL
  orphan=json.loads(subprocess.check_output(['sudo','-n','docker','inspect',name],text=True))[0];assert orphan['State']['Running']
  reconciled=recovery.reconcile(A/'runtime','compile-interrupted');assert reconciled['outcome']=='interrupted_reconciled' and reconciled['cleanupVerified'] and not reconciled['published']
  assert not (A/'runtime/published/dev-affine-01.txt').exists();assert not (job/'kernel.wasm').exists()
  core.durable(A/'crash-reconcile.json',{'controllerExit':controller.returncode,'orphanWasActuallyRunning':True,'partialStdoutNeverPromoted':True,'reconciled':reconciled})
  first=subprocess.run([sys.executable,'-m','tools.factory_runtime.qualify_actual_workflow_recovery','--resume',str(A),'first-resume'],cwd=R,capture_output=True,text=True,timeout=90);core.durable(A/'first-controller.json',{'exit':first.returncode,'stdout':first.stdout,'stderr':first.stderr});assert first.returncode==0
  accepted=json.loads((A/'first-resume.json').read_text());assert accepted['published'] and accepted['outcome']=='passed'
  attempts_before=len(list((A/'runtime/attempts').iterdir()))
  second=subprocess.run([sys.executable,'-m','tools.factory_runtime.qualify_actual_workflow_recovery','--resume',str(A),'second-resume'],cwd=R,capture_output=True,text=True,timeout=20);assert second.returncode==0,second.stderr
  secondresult=json.loads((A/'second-resume.json').read_text());assert secondresult['outcome']=='known-publication-reused';assert len(list((A/'runtime/attempts').iterdir()))==attempts_before
  again=recovery.reconcile(A/'runtime','compile-interrupted');assert again['outcome']=='interrupted_reconciled';assert len(list((A/'runtime/published').iterdir()))==1
  after={n:core.digest(SOURCE/n) for n in NAMES};clone={n:core.digest(job/n) for n in NAMES};assert before==after==clone;assert core.digest(job/'kernel.wasm')==sourcewasm
  core.durable(A/'qualification.json',{'version':1,'passed':True,'modelCalls':0,'actualLiveGeneratedCandidate':True,'immutableSourceHashes':before,'sourceAndCloneUnchanged':True,'wasmSha256':sourcewasm,'knownPublication':core.digest(A/'runtime/published/dev-affine-01.txt'),'publicationCount':1,'firstResume':accepted,'secondResume':secondresult,'attemptCountStable':attempts_before,'repeatReconcile':again,'scope':'actual compile-stage controller crash and full verify/publish recovery; no new model generation and no all-boundary generalization'})
 finally:
  if controller.poll() is None:controller.kill();controller.wait()
 print(A)
if __name__=='__main__':
 if len(sys.argv)>1 and sys.argv[1]=='--child':child(Path(sys.argv[2]))
 elif len(sys.argv)>1 and sys.argv[1]=='--resume':resume(Path(sys.argv[2]),sys.argv[3])
 else:main()
