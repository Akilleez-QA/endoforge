"""Bounded implementation-only patch, with independent evals left untouched."""
import hashlib
from pathlib import Path

TARGETS = ('kernel.ts', 'glue.json')


def _sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def patch(source, expected_sha, before, after, frozen_paths, classification, rounds, limit=1):
    if classification != 'implementation-defect':raise ValueError('contract/data/eval disputes require independent challenge')
    if type(rounds) is not int or type(limit) is not int or rounds < 0:raise ValueError('repair round')
    if rounds >= limit:raise ValueError('repair limit')
    source=Path(source)
    allowed=TARGETS if rounds==0 else tuple(f'{t}.repair-{rounds}' for t in TARGETS)
    if source.name not in allowed or source.is_symlink() or not source.is_file():raise ValueError('repair target')
    if not isinstance(before,str) or not isinstance(after,str):raise ValueError('patch text')
    frozen=[Path(p) for p in frozen_paths]
    if not frozen:raise ValueError('frozen evaluator paths required')
    if any(p.resolve()==source.resolve() for p in frozen):raise ValueError('candidate cannot be a frozen path')
    protected={str(p):_sha(p) for p in frozen}
    raw=source.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha:raise ValueError('candidate changed')
    text=raw.decode()
    if not before or text.count(before)!=1:raise ValueError('ambiguous patch')
    patched=text.replace(before,after,1).encode()
    base=source.name if rounds==0 else source.name.rsplit('.repair-',1)[0]
    output=source.with_name(base+'.repair-'+str(rounds+1))
    with output.open('xb') as f:f.write(patched)
    if any(_sha(p)!=v for p,v in protected.items()):
        output.unlink()
        raise RuntimeError('frozen requirement mutation')
    return {'version':1,'round':rounds+1,'sourceSha256':expected_sha,'patchedSha256':hashlib.sha256(patched).hexdigest(),'patchedPath':str(output),'frozenHashes':protected,'classification':classification}
