import json, glob, sys
for p in sorted(glob.glob(sys.argv[1] + '/diag-*.json')):
    for r in json.load(open(p))['rows']:
        c = r['cpuMsPerNeedByRole']; k = r['coresByRole']
        print(f"{r['label']:24s} thr {r['throughput']:6.2f} cellsCPU/need {c['cells']:6.1f} tot {sum(c.values()):6.1f} cores {sum(k.values()):5.2f} spawns {r['cellSpawnsInWindow']:3d} wrong {r['wrongVerdicts']} load {r['loadStart']:.1f} verdict {r['verdict']['bottleneck']} b.compile {r['buckets']['compile']:.1f} gate {r['buckets']['gate']:.1f} freeze {r['buckets']['freeze']:.1f}")
