#!/usr/bin/env python3
"""driftgate.py <generated.mp4|frames-dir> <control-edges.mp4|dir> [--mask control-mask.mp4|dir --hue LO,HI]
                [--edge-min 0.45] [--iou-min 0.6] [--tol 3] [--out gate.json]

Universal drift gate for control-conditioned generation: the renderer's passes are ground truth, the generated clip may
only change appearance. Per frame:
  edge_f1  - F1 of the generated frame's edges (Canny) against the control edge pass, with a tolerance of --tol px
             (structure: equipment, pipe walls, the character's outline stayed where the renderer put them)
  mask_iou - IoU of the subject as segmented in the generated frame (a hue band in degrees, --hue, required with
             --mask; e.g. 350,15 for a red subject) against the control mask pass (the subject stayed on-model and in
             place). A hue band fails when the generation tints the subject (e.g. under orange light); a promptable
             segmenter is the planned replacement.
A clip passes when every frame clears both minimums. Reports the first failing frame. Exit 1 on failure.
With no --mask, only edges are checked. Frames are compared at the control's resolution. Thresholds are starting
values, not calibrated ones. Foundation Film's drift_verdict judges the --out rows (scaled to per-mille)."""
import json, sys
from pathlib import Path
import numpy as np, cv2

a = sys.argv[1:]
def opt(n, d=None):
    return a[a.index(n) + 1] if n in a else d

def frames(src):
    p = Path(src)
    if p.is_dir():
        for f in sorted(p.glob('*.png')) + sorted(p.glob('*.jpg')):
            yield cv2.imread(str(f))
        return
    cap = cv2.VideoCapture(str(p))
    while True:
        ok, f = cap.read()
        if not ok: return
        yield f

def edges(img):
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    v = np.median(g); return cv2.Canny(g, int(max(0, 0.66 * v)), int(min(255, 1.33 * v))) > 0

def f1(gen, ctl, tol):
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * tol + 1, 2 * tol + 1))
    gd, cd = cv2.dilate(gen.astype(np.uint8), k) > 0, cv2.dilate(ctl.astype(np.uint8), k) > 0
    p = (gen & cd).sum() / max(1, gen.sum()); r = (ctl & gd).sum() / max(1, ctl.sum())
    return 0.0 if p + r == 0 else 2 * p * r / (p + r)

def hue_mask(img, lo, hi):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV); h = hsv[..., 0].astype(int) * 2
    band = (h >= lo) | (h <= hi) if lo > hi else (h >= lo) & (h <= hi)
    m = band & (hsv[..., 1] > 90) & (hsv[..., 2] > 50)
    return cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0

if opt('--mask') and not opt('--hue'):
    sys.exit('driftgate: --mask needs --hue LO,HI (the subject colour band in degrees); there is no default subject')
lo, hi = (int(x) for x in (opt('--hue') or '0,0').split(','))
emin, imin, tol = float(opt('--edge-min', 0.45)), float(opt('--iou-min', 0.6)), int(opt('--tol', 3))
G, C = frames(a[0]), frames(a[1]); Mk = frames(opt('--mask')) if opt('--mask') else None
rows, first_bad = [], None
for i, (g, c) in enumerate(zip(G, C)):
    g = cv2.resize(g, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_AREA)
    ce = (cv2.cvtColor(c, cv2.COLOR_BGR2GRAY) > 127) if c.std() > 0 and len(np.unique(c)) < 8 else edges(c)
    r = {'frame': i, 'edge_f1': round(f1(edges(g), ce, tol), 3)}
    if Mk is not None:
        m = next(Mk, None)
        if m is not None:
            mm = cv2.resize(m, (c.shape[1], c.shape[0]), interpolation=cv2.INTER_NEAREST)[..., 0] > 127
            gm = hue_mask(g, lo, hi); u = (mm | gm).sum()
            r['mask_iou'] = round(float((mm & gm).sum() / u), 3) if u else 1.0
    r['ok'] = bool(r['edge_f1'] >= emin and r.get('mask_iou', 1.0) >= imin)
    if not r['ok'] and first_bad is None: first_bad = i
    rows.append(r)
ok = first_bad is None and bool(rows)
summ = {'ok': ok, 'frames': len(rows), 'first_bad': first_bad,
        'edge_f1_min': min((r['edge_f1'] for r in rows), default=0), 'edge_f1_mean': round(float(np.mean([r['edge_f1'] for r in rows])), 3) if rows else 0}
if any('mask_iou' in r for r in rows):
    summ['mask_iou_min'] = min(r['mask_iou'] for r in rows if 'mask_iou' in r)
print(json.dumps(summ))
if opt('--out'): json.dump({'summary': summ, 'frames': rows}, open(opt('--out'), 'w'), indent=1)
sys.exit(0 if ok else 1)
