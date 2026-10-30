#!/usr/bin/env python3
import importlib.util, io, json, os, subprocess, tarfile, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('checkpoint',Path(__file__).with_name('checkpoint.py')); c=importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
def run():
    results=[]
    with tempfile.TemporaryDirectory(prefix='endoforge-checkpoint-test-') as td:
        w=Path(td); source=w/'source'; source.mkdir()
        key=w/'identity'; wrong=w/'wrong'
        for p in [key,wrong]: subprocess.run(['age-keygen','-o',str(p)],capture_output=True,check=True)
        pub=subprocess.check_output(['age-keygen','-y',str(key)],text=True).strip()
        meta={'schema':c.VERSION,'job_states':{'j1':'verified','j2':'generated'},'frozen_evals':{'sha':'test'},'dependencies':{'lock':'test'},'references':{'source':'fixture'},'provenance':{'source':'test','runtime':'test'},'credentials':'excluded-reauthenticate-at-destination'}
        (source/'checkpoint.json').write_text(json.dumps(meta)); (source/'candidate.wasm').write_bytes(b'\x00asm-fixture')
        before={p.name:c.sha(p.read_bytes()) for p in source.iterdir()}
        archive=w/'campaign.age'; c.pack(source,archive,pub); c.unpack(archive,w/'restored',key)
        assert (w/'restored/candidate.wasm').read_bytes()==(source/'candidate.wasm').read_bytes(); results.append('roundtrip')
        assert before=={p.name:c.sha(p.read_bytes()) for p in source.iterdir()}; results.append('source-immutable')
        def reject(label,fn,dest=None):
            try: fn()
            except (ValueError,FileExistsError,KeyError):
                assert dest is None or not dest.exists(); results.append(label); return
            raise AssertionError('accepted '+label)
        reject('wrong-key',lambda:c.unpack(archive,w/'badkey',wrong),w/'badkey')
        data=bytearray(archive.read_bytes()); data[-20]^=1; (w/'corrupt.age').write_bytes(data)
        reject('ciphertext-tamper',lambda:c.unpack(w/'corrupt.age',w/'tamper',key),w/'tamper')
        reject('existing-destination',lambda:c.unpack(archive,w/'restored',key))
        reject('existing-archive',lambda:c.pack(source,archive,pub))
        for label,name,data in [('credential-file','.env',b'anything'),('credential-content','secret.txt',b'AGE-SECRET-KEY-' + b'X'*40)]:
            p=source/name; p.write_bytes(data); reject(label,lambda:c.pack(source,w/(label+'.age'),pub)); p.unlink()
        for label in ['symlink','hardlink']:
            p=source/'link'; p.symlink_to('candidate.wasm') if label=='symlink' else os.link(source/'candidate.wasm',p)
            reject(label,lambda:c.pack(source,w/(label+'.age'),pub)); p.unlink()
        for label,name,kind in [('traversal','../escape','file'),('absolute','/tmp/escape','file'),('archive-symlink','link','symlink'),('duplicate','candidate.wasm','duplicate'),('unknown-version','checkpoint.json','version')]:
            buf=io.BytesIO()
            with tarfile.open(fileobj=buf,mode='w') as tf:
                item=tarfile.TarInfo(name); payload=b'x'
                if kind=='symlink': item.type=tarfile.SYMTYPE; item.linkname='/tmp/escape'
                if kind=='version': payload=json.dumps({**meta,'schema':'future','files':{}}).encode()
                item.size=len(payload); tf.addfile(item,io.BytesIO(payload))
                if kind=='duplicate': tf.addfile(item,io.BytesIO(payload))
            a=w/(label+'.age'); cp=subprocess.run(['age','-r',pub],input=buf.getvalue(),capture_output=True,check=True); a.write_bytes(cp.stdout)
            reject(label,lambda:c.unpack(a,w/label,key),w/label)
    return {'schema':'endoforge.portability-test.v1','passed':True,'checks':results,'count':len(results)}
if __name__=='__main__': print(json.dumps(run(),indent=2))
