import json, sys, collections, os, re
def cat(url, fn):
    u = url or ''
    if fn in ('(garbage collector)',): return 'gc'
    if fn in ('(idle)',): return 'idle'
    if fn in ('(program)',): return 'program'
    if 'binaryen' in u: return 'binaryen'
    if 'assemblyscript' in u: return 'asc'
    if '/x1/gates' in u or '/x1/measure' in u or '/x1/contract' in u or '/x1/dimensions' in u or '/x1/meter' in u or '/x1/scalar' in u: return 'gates'
    if '/x1/' in u: return 'x1-other:' + os.path.basename(u)
    if 'engine/' in u: return 'engine'
    if 'isolate' in u: return 'isolate:' + os.path.basename(u)
    if u.startswith('node:') or u == '': return 'node/native:' + (fn if u == '' else os.path.basename(u))
    return 'other:' + os.path.basename(u)
def main():
    tot = collections.Counter(); fns = collections.Counter(); wall = 0
    for path in sys.argv[1:]:
        p = json.load(open(path)); nodes = {n['id']: n for n in p['nodes']}
        dt = collections.Counter()
        for s, d in zip(p['samples'], p['timeDeltas']): dt[s] += d
        for i, us in dt.items():
            cf = nodes[i]['callFrame']; c = cat(cf['url'], cf['functionName'])
            tot[c] += us; fns[(c, cf['functionName'] or '(anon)')] += us
        wall += p['endTime'] - p['startTime']
    busy = sum(v for k, v in tot.items() if k != 'idle')
    print(f'profiles {len(sys.argv)-1} wall {wall/1e3:.0f} ms, main-thread busy {busy/1e3:.0f} ms')
    merged = collections.Counter()
    for k, v in tot.items(): merged[k.split(':')[0] if k.startswith('node/native') and v < 0.01*busy else k] += v
    for k, v in merged.most_common(25): print(f'  {k:40s} {v/1e3:8.1f} ms {100*v/max(1,busy):5.1f}%')
    print('top functions')
    for (c, f), v in fns.most_common(25): print(f'  {c[:28]:28s} {f[:40]:40s} {v/1e3:8.1f}')
if __name__ == '__main__': main()
