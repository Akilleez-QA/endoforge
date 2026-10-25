"""Bounded implementation-only patch, with independent evals left untouched."""
import hashlib
from pathlib import Path


def patch(source, expected_sha, before, after, frozen_paths, classification, rounds, limit=1):
    if classification != 'implementation-defect':raise ValueError('contract/data/eval disputes require independent challenge')
    if rounds >= limit:raise ValueError('repair limit')
    source=Path(source)
    if source.name not in ['kernel.ts','glue.json'] or source.is_symlink():raise ValueError('repair target')
    protected={str(p):hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in frozen_paths}
    raw=source.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=expected_sha:raise ValueError('candidate changed')
    text=raw.decode()
    if not before or text.count(before)!=1:raise ValueError('ambiguous patch')
    patched=text.replace(before,after,1)
    # A repair artifact is new; the original failed candidate is evidence.
    output=source.with_name(source.name+'.repair-'+str(rounds+1))
    with output.open('x') as f:f.write(patched)
    if any(hashlib.sha256(Path(p).read_bytes()).hexdigest()!=v for p,v in protected.items()):raise RuntimeError('frozen requirement mutation')
    return {'version':1,'round':rounds+1,'sourceSha256':expected_sha,'patchedSha256':hashlib.sha256(output.read_bytes()).hexdigest(),'patchedPath':str(output),'frozenHashes':protected,'classification':classification}
