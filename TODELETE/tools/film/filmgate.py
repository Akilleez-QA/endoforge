#!/usr/bin/env python3
"""filmgate.py <filmstats-dir> <reference-bands.json> [--segments segs.json] [--rules rules.json] [--out gate.json]

Universal cinematic gate: compares a film measured by filmstats.py (shots.json) with bands measured from a reference
(p25/p50/p75 per metric, weighted by screen time, e.g. film/ref/bands-cg.json). Each segment (a beat, or the whole
film) passes when every rule holds. Segments: [{"id": "b4", "start": 39, "end": 49.5}, ...] (a lesson's beats work).
Default rules (data, override with --rules):
  moving_share >= ref moving_share      the camera moves at least as often as the reference
  sharp        <= ref p75               not over-sharp (no focus, no blur reads as cheap CG)
  sharp        >= ref p25 / 2           not mush
  black        <= max(ref p75, 0.35)    the frame is filled, not a void
  subject_motion >= ref p25             something moves in frame
  luma         >= ref p25               not underexposed
Exit 1 when any segment fails."""
import json, sys

a = sys.argv[1:]
def opt(n):
    return a[a.index(n) + 1] if n in a else None
shots = json.load(open(f'{a[0]}/shots.json')); summ = json.load(open(f'{a[0]}/summary.json'))
B = json.load(open(a[1]))
segs = json.load(open(opt('--segments'))) if opt('--segments') else [{'id': 'film', 'start': 0, 'end': summ['duration_s']}]
if isinstance(segs, dict) and 'beats' in segs:
    segs = [{'id': b['id'], 'start': b['start'], 'end': b['end']} for b in segs['beats']]
rules = json.load(open(opt('--rules'))) if opt('--rules') else [
    ['moving_share', '>=', B['moving_share']],
    ['sharp', '<=', B['sharp'][2]],
    ['sharp', '>=', B['sharp'][0] / 2],
    ['black', '<=', max(B['black'][2], 0.35)],
    ['subject_motion', '>=', B['subject_motion'][0]],
    ['luma', '>=', B['luma'][0]],
]
out, bad = [], 0
for s in segs:
    parts = [(sh, max(0.0, min(sh['end'], s['end']) - max(sh['start'], s['start']))) for sh in shots]
    parts = [(sh, w) for sh, w in parts if w > 0]
    W = sum(w for _, w in parts) or 1
    m = {k: sum(sh[k] * w for sh, w in parts) / W for k in ('sharp', 'black', 'subject_motion', 'luma', 'dof', 'sat')}
    m['moving_share'] = sum(w for sh, w in parts if sh['camera'] != 'static') / W
    res = [{'metric': k, 'value': round(m[k], 3), 'op': op, 'target': round(v, 3), 'ok': (m[k] >= v if op == '>=' else m[k] <= v)}
           for k, op, v in rules]
    ok = all(r['ok'] for r in res); bad += not ok
    out.append({'id': s['id'], 'ok': ok, 'checks': res})
    print(f"{s['id']:6} {'PASS' if ok else 'FAIL'}  " + '  '.join(f"{r['metric']} {r['value']}{'' if r['ok'] else ' ✗' + r['op'] + str(r['target'])}" for r in res))
if opt('--out'):
    json.dump({'reference': a[1], 'film': a[0], 'segments': out}, open(opt('--out'), 'w'), indent=1)
sys.exit(1 if bad else 0)
