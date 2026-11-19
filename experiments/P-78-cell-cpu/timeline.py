import json, sys, collections, glob
from analyze import cat
for d in sys.argv[1:]:
    files=[f for f in glob.glob(d+'/*.cpuprofile')]
    hist=collections.defaultdict(collections.Counter); n=0; lifetimes=[]
    for f in files:
        p=json.load(open(f)); nodes={x['id']:x for x in p['nodes']}
        if len(p['samples'])<50: continue
        n+=1; t=0; lifetimes.append((p['endTime']-p['startTime'])/1e6)
        for s,dt in zip(p['samples'],p['timeDeltas']):
            t+=dt; cf=nodes[s]['callFrame']; c=cat(cf['url'],cf['functionName'])
            if c=='idle': continue
            b='0-1s' if t<1e6 else '1-3s' if t<3e6 else '3-6s' if t<6e6 else '6s+'
            hist[b][c.split(':')[0] if c.startswith('node/') else c]+=dt
    print(d, 'cells', n, 'mean life s', round(sum(lifetimes)/n,1))
    for b in ['0-1s','1-3s','3-6s','6s+']:
        tot=sum(hist[b].values()); print(f'  {b}: busy {tot/1e3/n:7.0f} ms/cell', ', '.join(f'{k} {v/1e3/n:.0f}' for k,v in hist[b].most_common(6)))
