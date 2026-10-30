#!/usr/bin/env python3
"""audiostats.py <stems-dir> <shots.json> <out.json>: per-shot soundtrack measures from separated stems
(vocals, drums, bass, other). Universal. Per shot: voice and music loudness (dBFS RMS), voice share of time, how far music
ducks under voice, drum presence, tempo, brightness, and whether a hit/whoosh lands within 0.3 s of the cut in."""
import json, sys
import numpy as np, librosa
D, shots, out = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3]
sr = 22050; st = {k: librosa.load(f'{D}/{k}.wav', sr=sr, mono=True)[0] for k in ('vocals', 'drums', 'bass', 'other')}
music = st['drums'] + st['bass'] + st['other']; hop = 512
rms = lambda y: librosa.feature.rms(y=y, hop_length=hop)[0]
rv, rm, rd = rms(st['vocals']), rms(music), rms(st['drums'])
db = lambda x: 20 * np.log10(np.maximum(x, 1e-5))
voiced = db(rv) > -38
on_env = librosa.onset.onset_strength(y=st['drums'] + st['other'], sr=sr, hop_length=hop)
hf = librosa.feature.spectral_centroid(y=st['other'], sr=sr, hop_length=hop)[0]
f = lambda t: int(t * sr / hop); res = []
for s in shots:
    a, b = f(s['start']), max(f(s['end']), f(s['start']) + 2)
    v = voiced[a:b]; m = db(rm[a:b])
    tempo = float(np.atleast_1d(librosa.feature.tempo(onset_envelope=on_env[a:b], sr=sr, hop_length=hop))[0]) if b - a > 200 else None
    near = on_env[max(0, a - f(0.3)):a + f(0.3)]
    res.append(dict(shot=s['shot'], start=s['start'], end=s['end'],
        voice_db=round(float(db(rv[a:b])[v].mean()), 1) if v.any() else None, voice_share=round(float(v.mean()), 2),
        music_db=round(float(m.mean()), 1),
        duck_db=round(float(m[~v].mean() - m[v].mean()), 1) if v.any() and (~v).any() else None,
        drums_db=round(float(db(rd[a:b]).mean()), 1), tempo=round(tempo, 1) if tempo else None,
        other_centroid=round(float(hf[a:b].mean())), cut_hit=round(float(near.max() / (np.median(on_env) + 1e-6)), 1) if len(near) else None))
json.dump(res, open(out, 'w'), indent=1)
v = [r for r in res if r['voice_db'] is not None]
print(json.dumps(dict(shots=len(res), voice_db=round(np.mean([r['voice_db'] for r in v]), 1), music_db=round(np.mean([r['music_db'] for r in res]), 1),
    duck_db=round(np.nanmean([r['duck_db'] for r in res if r['duck_db'] is not None]), 1), voice_share=round(np.mean([r['voice_share'] for r in res]), 2),
    cut_hits_over_4x=sum(1 for r in res if (r['cut_hit'] or 0) > 4))))
