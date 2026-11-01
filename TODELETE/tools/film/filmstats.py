#!/usr/bin/env python3
"""filmstats.py <video> <out-dir> [--fps 8] [--width 640]: measure a whole film, shot by shot.

Universal: nothing here knows about any particular film. Per shot it measures
  camera   - global motion from sparse optical flow (pan/tilt px/s, zoom %/s, roll deg/s) and how steady it is
  subject  - residual motion after the camera is removed (how much things move inside the frame)
  optics   - sharpness (Laplacian variance), depth of field (sharpest vs softest grid cell), vignette
  light    - luma mean / p5 / p95 (contrast), near-black share, saturation, warm/cool split (highlights vs shadows)
  detail   - edge density (texture richness)
  palette  - 5 dominant colours
plus the whole-film audio: loudness per second, onset (hit) rate, spectral centroid.
Writes <out>/shots.json, <out>/summary.json, <out>/strips/sNNN.jpg (4 frames per shot for a vision pass).
"""
import json, subprocess, sys
from pathlib import Path
import numpy as np, cv2

args = sys.argv[1:]
def opt(name, d):
    return type(d)(args[args.index(name) + 1]) if name in args else d
SRC, OUT = Path(args[0]), Path(args[1])
FPS, W = opt('--fps', 8.0), opt('--width', 640)
OUT.mkdir(parents=True, exist_ok=True); (OUT / 'strips').mkdir(exist_ok=True)

# 1. Shot boundaries over every frame (content + adaptive detectors agree on hard cuts; adaptive catches fast pans less).
from scenedetect import open_video, SceneManager
from scenedetect.detectors import ContentDetector, AdaptiveDetector
v = open_video(str(SRC)); native = v.frame_rate; dur = v.duration.get_seconds()
sm = SceneManager(); sm.add_detector(AdaptiveDetector(min_scene_len=6)); sm.add_detector(ContentDetector(threshold=30, min_scene_len=6))
sm.detect_scenes(v, show_progress=False)
cuts = sorted({round(s.get_seconds(), 3) for s, _ in sm.get_scene_list()} | {0.0})
shots = [(a, b) for a, b in zip(cuts, cuts[1:] + [dur]) if b - a > 0.2]

# 2. Sample frames at FPS (decode once).
cap = cv2.VideoCapture(str(SRC)); step = max(1, round(native / FPS)); frames = []
i = 0
while True:
    ok = cap.grab()
    if not ok: break
    if i % step == 0:
        _, f = cap.retrieve(); h = int(f.shape[0] * W / f.shape[1]); frames.append((i / native, cv2.resize(f, (W, h), interpolation=cv2.INTER_AREA)))
    i += 1

def cam(a, b):
    ga, gb = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY), cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    p = cv2.goodFeaturesToTrack(ga, 400, 0.01, 8)
    if p is None or len(p) < 12: return None
    q, st, _ = cv2.calcOpticalFlowPyrLK(ga, gb, p, None)
    p, q = p[st == 1], q[st == 1]
    if len(p) < 12: return None
    M, inl = cv2.estimateAffinePartial2D(p, q, ransacReprojThreshold=2.0)
    if M is None: return None
    s = float(np.hypot(M[0, 0], M[1, 0])); r = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
    pred = (p @ M[:, :2].T) + M[:, 2]; resid = float(np.median(np.linalg.norm(q - pred, axis=1)))
    return dict(tx=float(M[0, 2]), ty=float(M[1, 2]), zoom=s - 1, roll=r, resid=resid, inl=float(inl.mean()))

def still(f):
    g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY); hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV); H, Wd = g.shape
    lap = cv2.Laplacian(g, cv2.CV_64F)
    cells = [lap[r * H // 3:(r + 1) * H // 3, c * Wd // 3:(c + 1) * Wd // 3].var() for r in range(3) for c in range(3)]
    y = g.astype(float); bright = y > np.percentile(y, 80); dark = y < np.percentile(y, 20)
    b, gg, rr = [f[..., k].astype(float) for k in range(3)]
    warm = lambda m: float((rr[m].mean() - b[m].mean()) / 255) if m.any() else 0.0
    corner = np.concatenate([y[:H // 6, :Wd // 6].ravel(), y[:H // 6, -Wd // 6:].ravel(), y[-H // 6:, :Wd // 6].ravel(), y[-H // 6:, -Wd // 6:].ravel()])
    centre = y[H // 3:2 * H // 3, Wd // 3:2 * Wd // 3]
    return dict(sharp=float(lap.var()), dof=float(np.log10((max(cells) + 1) / (min(cells) + 1))),
                luma=float(y.mean() / 255), p5=float(np.percentile(y, 5) / 255), p95=float(np.percentile(y, 95) / 255),
                black=float((y < 16).mean()), sat=float(hsv[..., 1].mean() / 255),
                warm_hi=warm(bright), warm_lo=warm(dark), vignette=float(corner.mean() / (centre.mean() + 1)),
                edges=float((cv2.Canny(g, 80, 160) > 0).mean()))

def palette(fs):
    px = np.concatenate([cv2.resize(f, (48, 27)).reshape(-1, 3) for f in fs]).astype(np.float32)
    _, lab, cen = cv2.kmeans(px, 5, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0), 3, cv2.KMEANS_PP_CENTERS)
    share = np.bincount(lab.ravel(), minlength=5) / len(lab)
    return [{'hex': '#%02x%02x%02x' % tuple(int(c) for c in cen[k][::-1]), 'share': round(float(share[k]), 3)} for k in np.argsort(-share)]

res = []
for n, (a, b) in enumerate(shots):
    fs = [f for t, f in frames if a <= t < b]
    if not fs: continue
    ms = [m for m in (cam(x, y) for x, y in zip(fs, fs[1:])) if m]
    st = [still(f) for f in fs[::max(1, len(fs) // 6)]]
    agg = lambda k: round(float(np.mean([s[k] for s in st])), 4)
    mv = lambda k, scale=1: round(float(np.median([abs(m[k]) for m in ms]) * FPS * scale), 3) if ms else 0.0
    pan, tilt, zoom = mv('tx'), mv('ty'), mv('zoom', 100)
    jitter = round(float(np.std([m['tx'] for m in ms]) * FPS), 3) if len(ms) > 2 else 0.0
    kind = 'static' if max(pan, tilt) < 4 and zoom < 1 else ('push/pull' if zoom >= 1 and zoom * 6 > max(pan, tilt) / 10 else ('pan' if pan >= tilt else 'tilt'))
    idx = np.linspace(0, len(fs) - 1, 4).astype(int); strip = np.hstack([cv2.resize(fs[k], (480, int(480 * fs[k].shape[0] / fs[k].shape[1]))) for k in idx])
    cv2.imwrite(str(OUT / 'strips' / f's{n:03d}.jpg'), strip, [cv2.IMWRITE_JPEG_QUALITY, 82])
    res.append(dict(shot=n, start=round(a, 2), end=round(b, 2), dur=round(b - a, 2), camera=kind,
                    pan_px_s=pan, tilt_px_s=tilt, zoom_pct_s=zoom, roll_deg_s=mv('roll'), jitter=jitter,
                    subject_motion=mv('resid'), **{k: agg(k) for k in st[0]}, palette=palette(fs[::max(1, len(fs) // 4)])))

# 3. Audio, whole film.
audio = {}
try:
    import librosa
    wav = OUT / 'audio.wav'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(SRC), '-ac', '1', '-ar', '22050', str(wav)], check=True)
    y, sr = librosa.load(str(wav), sr=22050)
    rms = librosa.feature.rms(y=y, hop_length=sr)[0]; on = librosa.onset.onset_detect(y=y, sr=sr, units='time')
    tempo = librosa.beat.beat_track(y=y, sr=sr)[0]
    lufs = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(SRC), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    il = [l for l in lufs.splitlines() if l.strip().startswith('I:')]
    audio = dict(lufs=il[-1].split()[1] if il else None, onsets_per_s=round(len(on) / (len(y) / sr), 3),
                 tempo_bpm=round(float(np.atleast_1d(tempo)[0]), 1), rms_db_per_s=[round(float(20 * np.log10(r + 1e-6)), 1) for r in rms],
                 centroid_hz=round(float(librosa.feature.spectral_centroid(y=y, sr=sr).mean()), 0))
    wav.unlink()
except Exception as e:
    audio = {'error': repr(e)}

d = np.array([s['dur'] for s in res])
summary = dict(source=str(SRC), duration_s=round(dur, 2), shots=len(res), mean_shot_s=round(float(d.mean()), 2),
               median_shot_s=round(float(np.median(d)), 2),
               camera_mix={k: round(sum(s['dur'] for s in res if s['camera'] == k) / dur, 3) for k in ('static', 'pan', 'tilt', 'push/pull')},
               **{k: round(float(np.average([s[k] for s in res], weights=d)), 4) for k in
                  ('pan_px_s', 'tilt_px_s', 'zoom_pct_s', 'subject_motion', 'sharp', 'dof', 'luma', 'p5', 'p95', 'black', 'sat',
                   'warm_hi', 'warm_lo', 'vignette', 'edges')},
               audio={k: v for k, v in audio.items() if k != 'rms_db_per_s'})
json.dump(res, open(OUT / 'shots.json', 'w'), indent=1); json.dump(dict(summary, audio_rms_db_per_s=audio.get('rms_db_per_s')), open(OUT / 'summary.json', 'w'), indent=1)
print(json.dumps(summary, indent=1))
