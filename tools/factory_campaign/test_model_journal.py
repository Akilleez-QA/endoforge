"""Actual killed-controller tests with deterministic workers; no hosted model calls."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import uuid

from tools.factory_campaign.model_journal import ModelJournal,identity,alive,_atomic


def wait_for(path,seconds=10):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if path.exists():return json.loads(path.read_text())
        time.sleep(.02)
    raise TimeoutError(str(path))


def controller(root,ready):
    with ModelJournal(root)as journal:
        row=journal.new_attempt('killed-stage','deterministic-test','0'*64)
        home=journal.private_home(row['attempt']);(home/'fake-credential').write_text('NONSECRET-TEST-SENTINEL')
        worker=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True)
        row=journal.started(row['attempt'],worker.pid)
        _atomic(ready,{'attempt':row['attempt'],'worker':identity(worker.pid),'controller':identity(),'scope':row['scope'],'temporary':row['temporary']})
        time.sleep(120)


def controller_fault(root,ready):
    def fault(event,point):
        if event=='worker-started':os.kill(os.getpid(),signal.SIGKILL)
    with ModelJournal(root,_fault=fault)as journal:
        row=journal.new_attempt('event-crash-stage','deterministic-test','0'*64)
        journal.private_home(row['attempt'])
        worker=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True)
        _atomic(ready,{'attempt':row['attempt'],'worker':identity(worker.pid),'controller':identity(),'temporary':row['temporary']})
        journal.started(row['attempt'],worker.pid)


def controller_terminal_fault(root,ready):
    def fault(event,point):
        if event=='terminal-observed':os.kill(os.getpid(),signal.SIGKILL)
    with ModelJournal(root,_fault=fault)as journal:
        row=journal.new_attempt('terminal-crash-stage','deterministic-test','0'*64)
        home=journal.private_home(row['attempt']);(home/'fake-credential').write_text('NONSECRET-TEST-SENTINEL')
        _atomic(ready,{'attempt':row['attempt'],'controller':identity(),'temporary':row['temporary']})
        journal.finish(row['attempt'],'failed',{'deterministicFailure':'test'})


def main():
    base=Path(__file__).resolve().parents[2];out=Path(os.environ['ENDOFORGE_TEST_OUTPUT'])/('model-journal-'+uuid.uuid4().hex)
    out.mkdir(parents=True);root=out/'journal';ready=out/'ready.json';checks=[];foreign=None;child=None
    def record(name,passed,**details):
        checks.append({'name':name,'passed':bool(passed),**details});assert passed,name
    try:
        badroot=out/'bad-root';badroot.mkdir(mode=0o700);target=out/'foreign-events';target.mkdir();(badroot/'model-attempts').symlink_to(target,target_is_directory=True)
        refused=False
        try:
            with ModelJournal(badroot):pass
        except ValueError:refused=True
        (badroot/'model-attempts').unlink()
        with ModelJournal(badroot):record('failed-enter-releases-controller-fence',refused)
        foreign=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True);foreign_id=identity(foreign.pid)
        child=subprocess.Popen([sys.executable,'-m','tools.factory_campaign.test_model_journal','--controller',str(root),str(ready)],cwd=base,start_new_session=True)
        observed=wait_for(ready);attempt=observed['attempt'];record('actual-worker-running',alive(observed['worker']))
        locked=False
        try:
            with ModelJournal(root):pass
        except RuntimeError:locked=True
        record('second-live-controller-fenced',locked)
        os.kill(child.pid,signal.SIGKILL);child.wait(timeout=5);record('controller-actually-SIGKILL',child.returncode==-signal.SIGKILL)
        record('orphan-worker-survives-before-reconcile',alive(observed['worker']))
        with ModelJournal(root)as journal:
            row=journal.read(attempt)
            # Old controller identity copied to a still-running PID must not match start time.
            forged=dict(foreign_id,starttime=str(int(foreign_id['starttime'])+1));record('PID-reuse-identity-rejected',not alive(forged)and alive(foreign_id))
            # Durable event remains authoritative when the snapshot is missing/stale.
            (journal._path(attempt)/'state.json').unlink();recovered=journal.read(attempt)
            record('durable-event-recovers-missing-snapshot',recovered['state']=='running')
            _atomic(journal._path(attempt)/'state.json',{'version':999});record('durable-event-recovers-stale-snapshot',journal.read(attempt)['version']==1)
            result=journal.reconcile(attempt,stop_scope=False)
            end=time.monotonic()+3
            while alive(observed['worker'])and time.monotonic()<end:time.sleep(.02)
            record('unknown-no-promotion-no-retry',result['state']=='unknown'and result['promotionAllowed']is False and result['automaticRetry']is False)
            record('exact-owned-worker-killed',not alive(observed['worker']))
            record('exact-credential-home-removed',not Path(result['temporary']).exists())
            record('unrelated-worker-survives',alive(foreign_id))
            retry_rejected=False
            try:journal.new_attempt('killed-stage','deterministic-test','0'*64)
            except RuntimeError:retry_rejected=True
            record('retry-requires-explicit-parent',retry_rejected)
            retry=journal.new_attempt('killed-stage','deterministic-test','0'*64,retry_of=attempt)
            record('explicit-retry-gets-new-attempt',retry['attempt']!=attempt and retry['retryOf']==attempt)
            journal.finish(retry['attempt'],'cancelled');journal.cleanup_owned(retry['attempt'],stop_scope=False)
            live=journal.new_attempt('live-owner','deterministic-test','0'*64);refused=False
            try:journal.reconcile(live['attempt'],stop_scope=False)
            except RuntimeError:refused=True
            record('live-owner-reconciliation-rejected',refused);journal.finish(live['attempt'],'cancelled');absent=journal.cleanup_owned(live['attempt']);record('actual-not-found-scope-cleanup-safe',any(a.get('absent')and a.get('loadState')=='not-found'for a in absent['cleanup']))
            # Refuse paths that name foreign data, symlink aliases or mismatched owners.
            protected=out/'foreign-private';protected.mkdir();(protected/'sentinel').write_text('KEEP')
            safe=journal.new_attempt('cleanup-boundary','deterministic-test','0'*64);home=journal.private_home(safe['attempt']);temp=home.parent;kept=temp.with_name(temp.name+'-preserved');temp.rename(kept);temp.symlink_to(protected,target_is_directory=True)
            journal.finish(safe['attempt'],'cancelled');refused=False
            try:journal.cleanup_owned(safe['attempt'],stop_scope=False)
            except ValueError:refused=True
            record('symlink-credential-cleanup-rejected',refused and(protected/'sentinel').read_text()=='KEEP');temp.unlink();kept.rename(temp)
            marker=temp/'.model-owner.json';original=json.loads(marker.read_text());_atomic(marker,{**original,'attempt':'f'*32});refused=False
            try:journal.cleanup_owned(safe['attempt'],stop_scope=False)
            except ValueError:refused=True
            record('foreign-temp-owner-rejected',refused and temp.exists());_atomic(marker,original);journal.cleanup_owned(safe['attempt'],stop_scope=False)
            # Actual systemd scope ownership and mismatched-description controls.
            scoped=journal.new_attempt('owned-scope','deterministic-test','0'*64)
            unit=scoped['scope'];description=journal.scope_description(scoped['attempt'])
            scope_process=subprocess.Popen(['systemd-run','--user','--scope','--quiet','--unit',unit[:-6],'-p','Description='+description,'/usr/bin/sleep','120'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
            for unused in range(100):
                got=subprocess.run(['systemctl','--user','show',unit,'--property=Description','--value'],capture_output=True,text=True)
                if got.returncode==0 and got.stdout.strip()==description:break
                time.sleep(.02)
            record('actual-owned-scope-created',got.returncode==0 and got.stdout.strip()==description)
            journal.started(scoped['attempt'],scope_process.pid);journal.finish(scoped['attempt'],'cancelled');clean=journal.cleanup_owned(scoped['attempt']);scope_process.wait(timeout=5)
            record('only-owned-description-scope-stopped',any(a.get('stopped')for a in clean['cleanup'])and scope_process.poll()is not None and alive(foreign_id))
            mismatch=journal.new_attempt('mismatched-scope','deterministic-test','0'*64);unit=mismatch['scope']
            unrelated_scope=subprocess.Popen(['systemd-run','--user','--scope','--quiet','--unit',unit[:-6],'-p','Description=FOREIGN-OWNERSHIP-SENTINEL','/usr/bin/sleep','120'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
            for unused in range(100):
                got=subprocess.run(['systemctl','--user','show',unit,'--property=Description','--value'],capture_output=True,text=True)
                if got.returncode==0 and got.stdout.strip()=='FOREIGN-OWNERSHIP-SENTINEL':break
                time.sleep(.02)
            journal.finish(mismatch['attempt'],'cancelled');refused=False
            try:journal.cleanup_owned(mismatch['attempt'])
            except RuntimeError:refused=True
            record('mismatched-scope-description-not-stopped',refused and unrelated_scope.poll()is None)
            subprocess.run(['systemctl','--user','stop',unit],capture_output=True,timeout=10);unrelated_scope.wait(timeout=5)
            # Stale controller generation cannot write terminal evidence.
            control=root/'model-controller.json';current=json.loads(control.read_text());_atomic(control,{**current,'generation':'e'*32});stale=False
            try:journal.finish(live['attempt'],'passed')
            except RuntimeError:stale=True
            record('stale-generation-cannot-finish',stale);_atomic(control,current)
        record('foreign-worker-still-live-after-all-recovery',alive(foreign_id))
        crashroot=out/'event-crash-journal';crashready=out/'event-crash-ready.json'
        crash=subprocess.Popen([sys.executable,'-m','tools.factory_campaign.test_model_journal','--controller-fault',str(crashroot),str(crashready)],cwd=base,start_new_session=True)
        crashrow=wait_for(crashready);crash.wait(timeout=5)
        record('actual-SIGKILL-event-before-snapshot',crash.returncode==-signal.SIGKILL)
        snapshot=json.loads((crashroot/'model-attempts'/crashrow['attempt']/'state.json').read_text())
        record('actual-stale-snapshot-is-planned',snapshot['state']=='planned')
        with ModelJournal(crashroot)as journal:
            row=journal.read(crashrow['attempt'])
            record('actual-event-replay-recovers-running-PID',row['state']=='running'and row['worker']['pid']==crashrow['worker']['pid'])
            recovered=journal.reconcile(crashrow['attempt'],stop_scope=False)
            record('event-crash-reconciles-unknown',recovered['state']=='unknown'and recovered['cleanupComplete'])
        record('foreign-worker-survives-event-crash-recovery',alive(foreign_id))
        terminalroot=out/'terminal-crash-journal';terminalready=out/'terminal-crash-ready.json'
        terminal=subprocess.Popen([sys.executable,'-m','tools.factory_campaign.test_model_journal','--terminal-fault',str(terminalroot),str(terminalready)],cwd=base,start_new_session=True)
        tr=wait_for(terminalready);terminal.wait(timeout=5)
        record('actual-SIGKILL-terminal-event-before-snapshot',terminal.returncode==-signal.SIGKILL)
        with ModelJournal(terminalroot)as journal:
            before=journal.read(tr['attempt']);record('terminal-durable-event-recovered',before['state']=='failed')
            after=journal.reconcile(tr['attempt']);record('terminal-crash-credential-cleanup',after['state']=='failed'and after['observedTerminalOutcome']=='failed'and not Path(after['temporary']).exists()and after['promotionAllowed']is False)
        result={'version':1,'passed':all(c['passed']for c in checks),'checks':checks,'modelCalls':0,'limits':['Synthetic controller checks only; live model integration remains unqualified.','Process fallback signals only exact leader via pidfd; descendants require declared systemd scope.','Power loss/storage durability beyond fsync semantics not physically tested.','These process controls do not qualify systemd scope behavior.']}
        _atomic(out/'result.json',result)
    except BaseException as exc:
        _atomic(out/'failure.json',{'type':type(exc).__name__,'error':str(exc),'checks':checks});raise
    finally:
        for process in [child,foreign]:
            if process and process.poll()is None:process.kill();process.wait(timeout=5)
        if ready.exists():
            row=json.loads(ready.read_text());worker=row.get('worker')
            if alive(worker):os.kill(worker['pid'],signal.SIGKILL)
            temp=Path(row['temporary'])
            if temp.exists()and not temp.is_symlink():shutil.rmtree(temp)
        _atomic(out/'cleanup.json',{'foreignSentinelStoppedByTestOwner':foreign is None or foreign.poll()is not None,'controllerStopped':child is None or child.poll()is not None})
        files={str(p.relative_to(out)):hashlib.sha256(p.read_bytes()).hexdigest()for p in out.rglob('*')if p.is_file()and p.name!='manifest.json'}
        _atomic(out/'manifest.json',{'version':1,'files':files,'helperSha256':hashlib.sha256(Path(__file__).with_name('model_journal.py').read_bytes()).hexdigest(),'testSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()})
    print(json.dumps({'path':str(out),'passed':result['passed'],'checks':len(checks)}))


if __name__=='__main__':
    if len(sys.argv)>1 and sys.argv[1]=='--terminal-fault':controller_terminal_fault(Path(sys.argv[2]),Path(sys.argv[3]))
    elif len(sys.argv)>1 and sys.argv[1]=='--controller-fault':controller_fault(Path(sys.argv[2]),Path(sys.argv[3]))
    elif len(sys.argv)>1 and sys.argv[1]=='--controller':controller(Path(sys.argv[2]),Path(sys.argv[3]))
    else:main()
