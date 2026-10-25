#!/usr/bin/env python3
import hashlib,json,os,platform,shutil,signal,subprocess,sys,time
from pathlib import Path
from lifecycle import run_attempt,sha,write,DOCKER
from recovery import reconcile
HERE=Path(__file__).resolve().parent
R=HERE/'receipt'

def environment():
    return {'kernel':platform.platform(),'python':sys.version,'cpuCount':os.cpu_count(),
        'cpu':next(x for x in Path('/proc/cpuinfo').read_text().splitlines() if x.startswith('model name')),
        'load':os.getloadavg(),'memory':Path('/proc/meminfo').read_text(),
        'freeBytes':shutil.disk_usage(HERE).free,
        'git':subprocess.check_output(['git','-C',str(HERE),'rev-parse','HEAD'],text=True).strip(),
        'docker':subprocess.check_output(DOCKER+['version','--format','{{json .}}'],text=True)}

def main():
    R.mkdir()
    write(R/'frozen-hashes.json',{p.name:sha(p) for p in [HERE/n for n in ['PRECOMMIT.md','lifecycle.py','recovery.py','run.py']]})
    write(R/'env-before.json',environment())
    assert shutil.disk_usage(HERE).free>5*1024**3
    start=time.monotonic()
    frozen=R/'input.txt'; frozen.write_text('artifact-ok\n'); frozen.chmod(0o444)
    expected=sha(frozen)
    argv=[sys.executable,str(HERE/'lifecycle.py'),str(R),'hardkill','retry-job',str(frozen),expected,expected,'echo running >&2; sleep 100','--timeout','60']
    p=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        f=R/'attempts'/'hardkill'/'commands.json'
        if f.exists():
            try:
                if any('start' in row['argv'] and row['exit']==0 for row in json.loads(f.read_text())): break
            except ValueError: pass
        time.sleep(.05)
    else: raise AssertionError('start deadline')
    p.kill(); stdout,stderr=p.communicate(timeout=10)
    assert p.returncode==-signal.SIGKILL
    journal=json.loads((R/'journals'/'hardkill.json').read_text())
    live=json.loads(subprocess.check_output(DOCKER+['inspect',journal['containerName']],text=True))[0]
    assert live['State']['Running'],'must prove container outlives controller'
    write(R/'hardkill-controller.json',{'argv':argv,'exit':p.returncode,'stdout':stdout,'stderr':stderr,'survivingContainer':live})
    recovered=reconcile(R,'hardkill')
    assert recovered['outcome']=='interrupted_reconciled' and recovered['cleanupVerified'] and not recovered['published'],recovered
    assert not (R/'published'/'retry-job.txt').exists()
    retry=run_attempt(R,'retry-new','retry-job',frozen,expected,expected,'cat /input.txt')
    assert retry['outcome']=='passed',retry
    # Crash injection before final result write, after successful atomic link.
    code="""import os,sys
import lifecycle
original=lifecycle.write
def crash(path,value):
    if str(path).endswith('/result.json'): os._exit(88)
    return original(path,value)
lifecycle.write=crash
lifecycle.run_attempt(sys.argv[1],'linked-crash','linked-job',sys.argv[2],sys.argv[3],sys.argv[3],'cat /input.txt')
"""
    c=subprocess.run([sys.executable,'-c',code,str(R),str(frozen),expected],text=True,capture_output=True,timeout=25,cwd=HERE)
    assert c.returncode==88,c.stderr
    assert (R/'published'/'linked-job.txt').is_file()
    assert not (R/'attempts'/'linked-crash'/'result.json').exists()
    before={f.name:sha(f) for f in (R/'published').iterdir()}
    link_recovery=reconcile(R,'linked-crash')
    again=reconcile(R,'linked-crash')
    assert link_recovery['outcome']==again['outcome']=='publication_recovered'
    assert before=={f.name:sha(f) for f in (R/'published').iterdir()}
    write(R/'link-crash-controller.json',{'exit':c.returncode,'stdout':c.stdout,'stderr':c.stderr,'injectedCode':code,'publications':before})
    # Invalid identifiers/token journal rejected before Docker/receipt writes.
    invalid={'version':1,'attempt':'invalid','job':'../unsafe','token':'x','containerName':'other','expectedSha256':expected}
    (R/'journals'/'invalid.json').write_text(json.dumps(invalid))
    try: reconcile(R,'invalid')
    except ValueError: pass
    else: raise AssertionError('malformed journal accepted')
    remaining=subprocess.check_output(DOCKER+['ps','-aq','--filter','label=endoforge.probe=P12'],text=True)
    assert not remaining.strip(),remaining
    assert time.monotonic()-start<300
    write(R/'summary.json',{'label':'Recorded (probe)','passed':True,'hardkillRecovery':recovered,'freshRetry':retry,'publicationRecovery':link_recovery,'repeatRecovery':again,'malformedJournalRejected':True,'remainingContainers':remaining,'publications':before,'elapsedSeconds':time.monotonic()-start})
    write(R/'env-after.json',environment())
    print(json.dumps({'passed':True,'elapsedSeconds':time.monotonic()-start}))
if __name__=='__main__': main()
