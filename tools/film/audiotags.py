#!/usr/bin/env python3
"""audiotags.py <wav> <out.json> [--win 1.0]: AudioSet labels per window (Audio Spectrogram Transformer), top 5 each.
Universal: says what is heard (speech, music genre and instruments, sound effects) over time."""
import json, os, sys
import numpy as np, librosa, torch
from transformers import ASTFeatureExtractor, ASTForAudioClassification
src, out = sys.argv[1], sys.argv[2]; win = float(sys.argv[sys.argv.index('--win') + 1]) if '--win' in sys.argv else 1.0
name = 'MIT/ast-finetuned-audioset-10-10-0.4593'
fe = ASTFeatureExtractor.from_pretrained(name); model = ASTForAudioClassification.from_pretrained(name).eval()
torch.set_num_threads(int(os.environ.get('AUDIOTAGS_THREADS', os.cpu_count() or 4)))
y, sr = librosa.load(src, sr=16000, mono=True); n = int(win * sr); res = []
chunks = [y[i:i + n] for i in range(0, len(y) - n // 2, n)]
for b in range(0, len(chunks), 16):
    batch = [np.pad(c, (0, n - len(c))) for c in chunks[b:b + 16]]
    with torch.no_grad():
        p = torch.sigmoid(model(**fe(batch, sampling_rate=16000, return_tensors='pt')).logits).numpy()
    for k, row in enumerate(p):
        top = np.argsort(-row)[:5]
        res.append({'t': round((b + k) * win, 2), 'tags': [[model.config.id2label[int(j)], round(float(row[j]), 3)] for j in top]})
json.dump(res, open(out, 'w'))
print(len(res), 'windows')
