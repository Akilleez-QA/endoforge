#!/usr/bin/env python3
"""Prove a split is a no-op: compare two stills trees by decoded pixels, not file hashes (PNG encoders embed
timestamps and differ run to run; NOTES.md #5). usage: pixel-diff.py <before-dir> <after-dir> [--tolerance N]
Every image in either tree must exist in both with the same size and no channel differing by more than N (default 0).
Prints one JSON line; exit 0 when identical, 1 when not, 2 on usage errors."""
import json, os, sys

def images(root):
    out = {}
    for d, _, files in os.walk(root):
        for f in files:
            if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.tga', '.exr')):
                p = os.path.join(d, f); out[os.path.relpath(p, root)] = p
    return out

def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr); return 2
    tol = int(argv[argv.index('--tolerance') + 1]) if '--tolerance' in argv else 0
    from PIL import Image
    import numpy as np
    a, b = images(argv[0]), images(argv[1])
    if not a:
        print(json.dumps({'ok': False, 'error': f'no images under {argv[0]}'})); return 2
    missing = sorted(set(a) ^ set(b)); differ = []
    for rel in sorted(set(a) & set(b)):
        x, y = (np.asarray(Image.open(p).convert('RGBA'), dtype=np.int16) for p in (a[rel], b[rel]))
        if x.shape != y.shape:
            differ.append({'still': rel, 'why': f'size {x.shape[1]}x{x.shape[0]} vs {y.shape[1]}x{y.shape[0]}'}); continue
        d = np.abs(x - y); worst = int(d.max())
        if worst > tol:
            differ.append({'still': rel, 'maxDiff': worst, 'pixels': int((d.max(axis=2) > tol).sum())})
    ok = not missing and not differ
    print(json.dumps({'ok': ok, 'compared': len(set(a) & set(b)), 'tolerance': tol, 'missing': missing, 'differ': differ}))
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
