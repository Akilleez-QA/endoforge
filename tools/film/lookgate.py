#!/usr/bin/env python3
"""lookgate.py <frame.png> <target.png> [--out gate.json] [--thresholds t.json]

Universal look gate: does a frame look like its approved target (a concept frame or an approved keyframe)?
Structure gates (driftgate) ask "is it in the right place"; this asks "does it look right". Measures, frame vs target:
  palette   - Earth mover's distance between the two images' colour distributions in CIE Lab (a,b chroma plane and L),
              lower is closer
  exposure  - |median L difference| and |L p5..p95 contrast-range difference| (lightness 0..100)
  clipping  - share of near-white (L > 97) and near-black (L < 3) pixels, frame minus target
  detail    - ratio of edge/texture density (Laplacian energy per pixel) frame / target: flat renders score << 1
  saturation- ratio of mean chroma frame / target
Passes when every metric is inside its threshold (defaults below, calibrated so the target passes against itself and
re-encoded copies of it, and fail-closed on missing files). A vision critic is a separate, additional gate.
"""
import json, sys
import numpy as np, cv2

a = sys.argv[1:]
def opt(n, d=None):
    return a[a.index(n) + 1] if n in a else d
T = {'palette_ab': 6.0, 'palette_L': 8.0, 'median_L': 10.0, 'range_L': 15.0, 'clip_white': 0.04, 'clip_black': 0.08,
     'detail_min': 0.55, 'detail_max': 1.8, 'chroma_min': 0.7, 'chroma_max': 1.4}
if opt('--thresholds'): T.update(json.load(open(opt('--thresholds'))))

def load(p, size=(640, 360)):
    im = cv2.imread(p, cv2.IMREAD_COLOR)
    if im is None: raise SystemExit(f'lookgate: cannot read {p}')
    im = cv2.resize(im, size, interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(im.astype(np.float32) / 255, cv2.COLOR_BGR2LAB)
    return im, lab

def emd1(x, y, bins, rng):
    hx, _ = np.histogram(x, bins=bins, range=rng); hy, _ = np.histogram(y, bins=bins, range=rng)
    cx, cy = np.cumsum(hx / hx.sum()), np.cumsum(hy / hy.sum())
    return float(np.abs(cx - cy).sum() * (rng[1] - rng[0]) / bins)

def stats(im, lab):
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    lap = cv2.Laplacian(g, cv2.CV_32F)
    return dict(L=L.ravel(), A=A.ravel(), B=B.ravel(), median_L=float(np.median(L)),
                range_L=float(np.percentile(L, 95) - np.percentile(L, 5)), white=float((L > 97).mean()),
                black=float((L < 3).mean()), detail=float(np.mean(np.abs(lap))), chroma=float(np.mean(np.hypot(A, B))))

f, t = stats(*load(a[0])), stats(*load(a[1]))
m = {
    'palette_ab': round((emd1(f['A'], t['A'], 128, (-128, 128)) + emd1(f['B'], t['B'], 128, (-128, 128))) / 2, 2),
    'palette_L': round(emd1(f['L'], t['L'], 100, (0, 100)), 2),
    'median_L': round(abs(f['median_L'] - t['median_L']), 2),
    'range_L': round(abs(f['range_L'] - t['range_L']), 2),
    'clip_white': round(max(0.0, f['white'] - t['white']), 3),
    'clip_black': round(max(0.0, f['black'] - t['black']), 3),
    'detail_ratio': round(f['detail'] / max(t['detail'], 1e-6), 3),
    'chroma_ratio': round(f['chroma'] / max(t['chroma'], 1e-6), 3),
}
checks = {
    'palette_ab': m['palette_ab'] <= T['palette_ab'], 'palette_L': m['palette_L'] <= T['palette_L'],
    'median_L': m['median_L'] <= T['median_L'], 'range_L': m['range_L'] <= T['range_L'],
    'clip_white': m['clip_white'] <= T['clip_white'], 'clip_black': m['clip_black'] <= T['clip_black'],
    'detail': T['detail_min'] <= m['detail_ratio'] <= T['detail_max'],
    'chroma': T['chroma_min'] <= m['chroma_ratio'] <= T['chroma_max'],
}
res = {'ok': all(checks.values()), 'failed': [k for k, v in checks.items() if not v], 'metrics': m, 'thresholds': T}
print(json.dumps({'ok': res['ok'], 'failed': res['failed'], **m}))
if opt('--out'): json.dump(res, open(opt('--out'), 'w'), indent=1)
sys.exit(0 if res['ok'] else 1)
