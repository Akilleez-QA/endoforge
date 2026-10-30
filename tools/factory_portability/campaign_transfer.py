#!/usr/bin/env python3
"""Encrypt and resume a real explicitly staged pending offline campaign stage."""
import argparse,hashlib,importlib.util,json,os,shlex,subprocess,time,uuid
from pathlib import Path

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
C=module('checkpoint');R=module('resume_stage')
def save(p,obj):p.write_text(json.dumps(obj,indent=2)+'\n')
def execute(argv,rows,stdin=None,check=True,timeout=120):
    t=time.monotonic();cp=subprocess.run([str(x)for x in argv],input=stdin,capture_output=True,timeout=timeout)
    row={'argv':[str(x)for x in argv],'exit':cp.returncode,'stdout':cp.stdout.decode(),'stderr':cp.stderr.decode(),'wallMs':1000*(time.monotonic()-t)};rows.append(row)
    if check and cp.returncode:raise RuntimeError(row['stderr'])
    return row

def execute_transfer(source,bundle,receipt,identity,host,remote):
    source,bundle,receipt,identity=map(lambda p:Path(p).resolve(),(source,bundle,receipt,identity))
    if receipt.exists():raise FileExistsError(receipt)
    if not remote.startswith('/tmp/endoforge-transfer-')or len(remote.split('/'))!=3:raise ValueError('remote must be exact owned staging root')
    receipt.mkdir();rows=[];summary={'schema':'endoforge.actual-cross-host-resume.v1','state':'started','host':host,'remote':remote,'identityCustody':str(identity),'modelAuthentication':'not required: only pending offline stage resumes'};q=shlex.quote
    before={str(p.relative_to(source)):C.sha(p.read_bytes())for p in source.rglob('*')if p.is_file()}
    try:
        if not identity.exists():
            identity.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
            execute(['age-keygen','-o',identity],rows)
        if identity.stat().st_mode&0o077:raise ValueError('identity must have private0600 permissions')
        pub=execute(['age-keygen','-y',identity],rows)['stdout'].strip()
        archive=receipt/'campaign.age';summary['pack']=C.pack(source,archive,pub)
        restored=receipt.parent/'work'/('actual-restored-'+uuid.uuid4().hex);restored.parent.mkdir(exist_ok=True);summary['localRestore']=C.unpack(archive,restored,identity)
        local=R.run(restored,bundle,receipt/'local-output');local_second=R.run(restored,bundle,receipt/'local-output');save(receipt/'local-first.json',local);save(receipt/'local-second.json',local_second)
        if not local['passed']or not local['published']or not local_second['reused']:raise ValueError('local actual-stage controls failed')
        destination_hash=execute(['ssh','-o','BatchMode=yes',host,'sha256sum /etc/machine-id'],rows)['stdout'].split()[0]
        source_hash=hashlib.sha256(Path('/etc/machine-id').read_bytes()).hexdigest()
        if source_hash==destination_hash:raise ValueError('second host identity equals source')
        summary.update(sourceMachineSha256=source_hash,destinationMachineSha256=destination_hash)
        suffix=uuid.uuid4().hex;archive_remote=remote+'/campaign-'+suffix+'.age';dest='/work/checkpoint-'+suffix;output='/work/resume-'+suffix
        execute(['scp','-q',archive,host+':'+archive_remote],rows)
        execute(['scp','-q',Path(__file__).with_name('resume_stage.py'),host+':'+remote+'/resume_stage.py'],rows)
        ns=['bwrap','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--ro-bind','/bin','/bin','--bind',remote,'/work','--unshare-all','--new-session','--die-with-parent','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--setenv','PATH','/work:/usr/bin:/bin','--chdir','/work','--']
        # The ephemeral stdin stream is never appended to logs or written remotely.
        decrypt=ns+['/usr/bin/python3','/work/checkpoint.py','unpack','/work/'+Path(archive_remote).name,dest,'--identity','-']
        remote_restore=execute(['ssh','-o','BatchMode=yes',host,shlex.join(decrypt)],rows,stdin=identity.read_bytes());summary['remoteRestore']=json.loads(remote_restore['stdout'])
        command=['ssh','-o','BatchMode=yes',host,shlex.join(ns+['/usr/bin/python3','/work/resume_stage.py',dest,'/work/bundle',output])]
        first=json.loads(execute(command,rows)['stdout']);second=json.loads(execute(command,rows)['stdout']);save(receipt/'remote-first.json',first);save(receipt/'remote-second.json',second)
        if not first['passed']or not first['published']or not second['reused']or second['published']:raise ValueError('remote completion/idempotency failed')
        if first['publicationSha256']!=local['publicationSha256']or first['moduleSha256']!=local['moduleSha256']:raise ValueError('local/remote artifact mismatch')
        execute(['scp','-q','-r',host+':'+remote+'/'+Path(output).name,str(receipt/'remote-output')],rows)
        after={str(p.relative_to(source)):C.sha(p.read_bytes())for p in source.rglob('*')if p.is_file()}
        if before!=after:raise ValueError('source staging changed')
        execute(['ssh','-o','BatchMode=yes',host,'rm -rf -- '+q(remote)+' && test ! -e '+q(remote)],rows)
        summary.update(state='passed',passed=True,sourceImmutable=True,checkpointArchiveSha256=C.sha(archive.read_bytes()),matchingPublicationSha256=first['publicationSha256'],matchingModuleSha256=first['moduleSha256'],onePublication=True,secondResumeIdempotent=True,remoteOwnedStagingRemoved=True,completedStagesPreserved=first['completedStagesPreserved'],resumedState=first['resumedState'])
    except Exception as e:
        summary.update(state='failed',passed=False,error=str(e),remoteOwnedStagingRemoved=False)
        raise
    finally:
        save(receipt/'commands.json',rows);save(receipt/'summary.json',summary)
    return summary
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('bundle');p.add_argument('receipt');p.add_argument('--identity',required=True);p.add_argument('--host',required=True);p.add_argument('--remote',required=True);a=p.parse_args();print(json.dumps(execute_transfer(a.source,a.bundle,a.receipt,a.identity,a.host,a.remote),indent=2))
