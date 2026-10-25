#!/usr/bin/env python3
"""Stage only a nonsecret offline toolchain in an owned remote /tmp directory."""
import argparse, hashlib, json, os, shlex, shutil, subprocess, tarfile, time, uuid
from pathlib import Path

def run(args,logs,timeout=120):
    t=time.monotonic(); p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    logs.append({'argv':args,'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'wall_ms':1000*(time.monotonic()-t)})
    if p.returncode: raise RuntimeError(p.stderr)
    return p.stdout.strip()
def main(bundle,receipt,host='fieldops'):
    if receipt.exists(): raise FileExistsError(receipt)
    receipt.mkdir(); logs=[]; q=shlex.quote
    remote='/tmp/endoforge-next50-'+uuid.uuid4().hex
    archive=bundle.parent/'offline-transfer.tar.gz'
    if archive.exists(): raise FileExistsError(archive)
    with tarfile.open(archive,'w:gz') as tf:
        tf.add(bundle,arcname='bundle')
        for name in ['bootstrap.py','checkpoint.py']:
            tf.add(Path(__file__).with_name(name),arcname=name)
        tf.add('/usr/bin/age',arcname='age')
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    state={'remote':remote,'host':host,'archive_sha256':digest,'state':'staging'}
    try:
        state['source_machine']=run(['bash','-c','sha256sum /etc/machine-id'],logs).split()[0]
        state['destination_machine']=run(['ssh','-o','BatchMode=yes',host,'sha256sum /etc/machine-id'],logs).split()[0]
        if state['source_machine']==state['destination_machine']: raise ValueError('same physical host')
        run(['ssh','-o','BatchMode=yes',host,'mkdir -m 700 '+q(remote)],logs)
        run(['scp','-q',str(archive),host+':'+remote+'/offline.tar.gz'],logs)
        run(['ssh','-o','BatchMode=yes',host,'cd '+q(remote)+' && echo '+q(digest+'  offline.tar.gz')+' | sha256sum -c - && tar -xzf offline.tar.gz && rm offline.tar.gz'],logs)
        args=['bwrap','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--ro-bind','/bin','/bin','--bind',remote,'/work','--unshare-all','--new-session','--die-with-parent','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--chdir','/work','--','/usr/bin/python3','/work/bootstrap.py','replay','/work/bundle','/work/fresh-replay']
        out=run(['ssh','-o','BatchMode=yes',host,shlex.join(args)],logs,180)
        (receipt/'replay.json').write_text(out+'\n'); parsed=json.loads(out)
        state.update({'state':'offline-replay-passed','candidates':parsed['candidates'],'tests':parsed['tests'],'network':'bubblewrap --unshare-all, npm --offline','no_existing_checkout_or_cache':True})
        run(['ssh','-o','BatchMode=yes',host,'rm -rf -- '+q(remote+'/fresh-replay')],logs)
    except Exception as e:
        state.update({'state':'failed','error':str(e)})
        raise
    finally:
        (receipt/'commands.json').write_text(json.dumps(logs,indent=2)+'\n'); (receipt/'summary.json').write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps(state))
if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('bundle',type=Path); p.add_argument('receipt',type=Path); p.add_argument('--host',default='fieldops'); a=p.parse_args(); main(a.bundle.resolve(),a.receipt.resolve(),a.host)
