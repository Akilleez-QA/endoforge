#!/usr/bin/env python3
"""Contact sheets for a hill-climb round: every still under <stills> as labelled tiles, 4 per 1920x1080 sheet, so a
critic reads detail rather than thumbnails. Writes <out>/sheet_NN.jpg and <out>/index.json (sheet -> stills).

    python3 -I sheets.py <stills_dir> <out_dir> [--per 4] [--brighten name,name]   (--brighten lifts night shots x3)
"""
import json, os, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

args = sys.argv[1:]
src, out = Path(args[0]), Path(args[1])
per = int(args[args.index('--per') + 1]) if '--per' in args else 4
bright = set(args[args.index('--brighten') + 1].split(',')) if '--brighten' in args else set()
out.mkdir(parents=True, exist_ok=True)
stills = sorted(p for p in src.rglob('*') if p.suffix.lower() in ('.png', '.jpg', '.jpeg') and p.is_file())
cols = 2 if per <= 4 else 3
rows = (per + cols - 1) // cols
W, H = 1920 // cols, 1080 // rows
font = None
for f in ('/usr/share/fonts/liberation/LiberationSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'):
    if os.path.exists(f):
        font = ImageFont.truetype(f, 20); break
font = font or ImageFont.load_default()
index = []
for k in range(0, len(stills), per):
    sheet = Image.new('RGB', (1920, 1080), (12, 12, 12))
    names = []
    for j, p in enumerate(stills[k:k + per]):
        name = str(p.relative_to(src).with_suffix(''))
        im = Image.open(p).convert('RGB')
        im.thumbnail((W, H))
        if p.stem in bright:
            im = ImageEnhance.Brightness(im).enhance(3.0)
        d = ImageDraw.Draw(im)
        d.rectangle((0, 0, im.width, 26), fill=(0, 0, 0))
        d.text((6, 2), f'{k + j + 1:02d} {name}', fill=(255, 210, 60), font=font)
        sheet.paste(im, ((j % cols) * W, (j // cols) * H))
        names.append({'n': k + j + 1, 'still': name, 'file': str(p.relative_to(src))})  # relative: atoms see the stills under /hc/stills
    f = out / f'sheet_{k // per + 1:02d}.jpg'
    sheet.save(f, quality=90)
    index.append({'sheet': f.name, 'stills': names})
(out / 'index.json').write_text(json.dumps({'stills': len(stills), 'sheets': index}, indent=1))
print(f'{len(stills)} stills -> {len(index)} sheets in {out}')
