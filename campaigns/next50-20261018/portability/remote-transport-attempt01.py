#!/usr/bin/env python3
"""Synthetic encrypted transport preflight, explicitly not a live campaign."""
import importlib.util,json,shlex,subprocess,tempfile,uuid
from pathlib import Path
s=importlib.util.spec_from_file_location('checkpoint',Path(__file__).with_name('checkpoint.py'));c=importlib.util.module_from_spec(s);s.loader.exec_module(c)
def main():
    host='fieldops';remote='/tmp/endoforge-next50-7b6942bdbbca48f1a7a1f13a7430fa5b';rows=[];name='preflight-'+uuid.uuid4().hex
    def command(args,stdin=None,check=True):
        cp=subprocess.run([str(a)for a in args],input=stdin,capture_output=True,timeout=30);rows.append({'argv':[str(a)for a in args],'exit':cp.returncode,'stdout':cp.stdout.decode(),'stderr':cp.stderr.decode()})
        if check and cp.returncode:raise RuntimeError(cp.stderr.decode())
        return cp
    with tempfile.TemporaryDirectory(prefix='endoforge-encrypted-preflight-')as td:
        w=Path(td);key=w/'identity';wrong=w/'wrong'
        for p in[key,wrong]:command(['age-keygen','-o',p])
        pub=command(['age-keygen','-y',key]).stdout.decode().strip();source=w/'source';source.mkdir()
        (source/'checkpoint.json').write_text(json.dumps({'schema':c.VERSION,**{k:{'fixture':'synthetic transport-only'}for k in c.REQUIRED},'credentials':'excluded-reauthenticate-at-destination'}));(source/'fixture.txt').write_text('synthetic transport-only; never N40 evidence\n')
        archive=w/'fixture.age';c.pack(source,archive,pub);command(['scp','-q',archive,host+':'+remote+'/'+name+'.age'])
        bad=w/'corrupt.age';b=bytearray(archive.read_bytes());b[-10]^=1;bad.write_bytes(b);command(['scp','-q',bad,host+':'+remote+'/'+name+'-corrupt.age'])
        ns=['bwrap','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--ro-bind','/bin','/bin','--bind',remote,'/work','--unshare-all','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--setenv','PATH','/work:/usr/bin:/bin','--','/usr/bin/python3','/work/checkpoint.py','unpack']
        for label,a,k in[('wrongkey',name+'.age',wrong),('corrupt',name+'-corrupt.age',key),('good',name+'.age',key)]:
            cp=command(['ssh','-o','BatchMode=yes',host,shlex.join(ns+['/work/'+a,'/work/'+name+'-'+label,'--identity','/dev/stdin'])],k.read_bytes(),check=label=='good')
            assert (cp.returncode==0)==(label=='good')
            if label!='good':command(['ssh','-o','BatchMode=yes',host,'test ! -e '+shlex.quote(remote+'/'+name+'-'+label)])
        command(['ssh','-o','BatchMode=yes',host,'sha256sum '+shlex.quote(remote+'/'+name+'-good/fixture.txt')])
        command(['ssh','-o','BatchMode=yes',host,'rm -rf -- '+shlex.join([remote+'/'+name+'.age',remote+'/'+name+'-corrupt.age',remote+'/'+name+'-good'])])
    return {'passed':True,'scope':'synthetic transport controls only; not N40','checks':['wrongkey over SSH stdin fails before extraction','tampered ciphertext fails before extraction','correct identity over SSH stdin restores','own preflight paths cleaned'],'commands':rows}
if __name__=='__main__':print(json.dumps(main(),indent=2))
