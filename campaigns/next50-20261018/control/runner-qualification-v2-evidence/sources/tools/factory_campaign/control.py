"""Trusted-host next50 item/evidence and usage validation. No model decisions."""
import hashlib
import json
from pathlib import Path

TERMINAL = {'qualified', 'blocked', 'rejected'}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
    return h.hexdigest()


def verify_baseline(repo, baseline):
    """Return differences; explicit documentation edits do not rewrite the baseline."""
    repo = Path(repo)
    return {name: {'frozen': expected, 'current': digest(repo/name) if (repo/name).is_file() else None}
            for name, expected in baseline['files'].items()
            if not (repo/name).is_file() or digest(repo/name) != expected}


def validate_items(doc, root):
    if doc.get('schema') != 'endoforge.next50.items/1': raise ValueError('item schema')
    items = doc['items']; index = {x['id']: x for x in items}
    if len(index) != 50 or set(index) != {f'N{x:02}' for x in range(1, 51)}:
        raise ValueError('exactly N01-N50 required')
    active=set(); seen=set()
    def visit(key):
        if key in active: raise ValueError('dependency cycle')
        if key in seen: return
        active.add(key)
        for dep in index[key]['dependencies']:
            if dep not in index: raise ValueError('missing dependency')
            visit(dep)
        active.remove(key); seen.add(key)
    for item in items:
        visit(item['id'])
        if item['status'] not in {'pending', 'in_progress', 'implemented', *TERMINAL}:
            raise ValueError('unknown item status')
        if item['status'] == 'qualified':
            if not item['evidence']: raise ValueError('qualified without evidence')
            if any(index[d]['status'] != 'qualified' for d in item['dependencies']):
                raise ValueError(f'{item["id"]}: dependency unqualified')
            for name in item['evidence']:
                p = Path(root)/name
                if not p.is_file(): raise ValueError(f'missing evidence {p}')
    return True


def token_count(family, usage):
    """CLI-specific conservative accounting; preserve raw usage separately."""
    if family == 'claude':
        return sum(int(usage.get(k,0) or 0) for k in ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'])
    if family == 'codex':
        return int(usage.get('input_tokens',0) or 0)+int(usage.get('output_tokens',0) or 0)
    raise ValueError('unknown usage family')


def freeze(path, files):
    """Exclusively create a trust manifest, never replace an earlier freeze."""
    payload={str(p):digest(p) for p in files}
    with Path(path).open('x') as f: json.dump(payload,f,indent=2);f.write('\n')
    return payload
