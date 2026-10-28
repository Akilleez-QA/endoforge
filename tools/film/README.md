# Film measuring tools

These are the producers: they turn a film, a soundtrack or a generated clip into numbers. Foundation Film
(`foundations/film/`) is the judge: it takes their JSON outputs, scaled to integers, and returns verdicts with
Evidence. The tools are universal. Nothing in them knows about a particular film, character or brand; a subject colour
or a model path is always an argument. The playbook that explains why each one exists is
[`../../docs/PLAYBOOK-film.md`](../../docs/PLAYBOOK-film.md).

They were first written for the 2026-10-26 reference run. Each was used there; none has a test suite yet (see "Gaps").

## What each one measures

| Tool | Measures | Writes | Judged by (Foundation Film) |
|---|---|---|---|
| `filmstats.py` | A whole film, shot by shot. Shot boundaries (PySceneDetect, adaptive and content detectors). Per shot: camera motion from sparse optical flow (pan and tilt px/s, zoom %/s, roll deg/s, jitter) and its kind (static, pan, tilt, push/pull); subject motion (the residual after the camera is removed); optics (sharpness as Laplacian variance, depth of field as sharpest over softest grid cell, vignette); light (luma mean, p5, p95, near-black share, saturation, warm/cool split); edge density; 5 dominant colours. Whole-film audio: integrated LUFS, onsets per second, tempo, spectral centroid, loudness per second. | `<out>/shots.json`, `<out>/summary.json`, `<out>/strips/sNNN.jpg` (4 frames per shot for a vision pass) | `reference_bands` (on the reference), `cinematic_gate` (on ours) |
| `filmgate.py` | The reference implementation of the cinematic gate over a `filmstats.py` directory and a bands file, per segment (beats). | `--out gate.json`; exit 1 on a failing segment | `cinematic_gate` ports its default rules exactly |
| `audiostats.py` | Per shot, from separated stems (vocals, drums, bass, other): voice and music level (dBFS RMS), voice share of time, how far music ducks under voice, drum level, tempo, brightness, and `cut_hit` (the onset peak within 0.3 s of the cut, over the film's median onset strength). | `<out.json>` per shot; a summary on stdout | `audio_gate` (voice over bed, cuts carrying a hit) |
| `audiotags.py` | What is heard, per window (default 1 s): the top 5 AudioSet classes from the Audio Spectrogram Transformer. | `<out.json>`: `[{"t", "tags": [[label, p], ...]}]` | `audio_gate` (`heard`) |
| `driftgate.py` | Control fidelity of a generated clip, per frame: edge F1 of the generated frame's Canny edges against the control edge pass (tolerance `--tol` px), and optionally the IoU of the subject (segmented by a hue band) against the control mask. | `--out gate.json` (`summary`, `frames`); exit 1 on failure | `drift_verdict` (worst frame, first failing frame) |
| `lookgate.py` | Look against an approved target frame (a concept frame or an approved keyframe), both resized to 640×360: palette earth mover's distance in CIE Lab (a/b chroma plane and L), median-L and p5–p95 contrast-range differences, extra near-white and near-black clipping, detail ratio (Laplacian energy per pixel, frame over target; flat renders score far below 1) and chroma ratio. A rejection alarm: calibrated so the target, re-encodes of it and a restyled keyframe pass and flat renders fail. A vision critic and the client stay separate, later gates. | one JSON line on stdout; `--out gate.json` (`ok`, `failed`, `metrics`, `thresholds`); exit 1 on failure; `--thresholds t.json` overrides | `look_gate` (every frame, every check) |
| `wan_i2v.py` | Not a measure: unconditioned image-to-video with Wan 2.2 TI2V-5B, for keyframe motion tests. It drifts within about a second, so it is never a final (I20). | `<stem>.mp4`, `<stem>_frames/`, `<stem>.json` (timing, peak VRAM) | its frames go through `driftgate.py` |

## Dependencies

| Tool | Needs |
|---|---|
| `filmstats.py` | `opencv-python-headless`, `numpy`, `scenedetect`; for the audio block `librosa` and `ffmpeg` on PATH (the audio block is skipped with an `error` field if they are missing) |
| `filmgate.py` | stdlib only |
| `audiostats.py` | `numpy`, `librosa`; stems from `demucs` (for example `python -m demucs -n htdemucs <wav>`, which writes `vocals.wav`, `drums.wav`, `bass.wav`, `other.wav`) |
| `audiotags.py` | `numpy`, `librosa`, `torch`, `transformers` (model `MIT/ast-finetuned-audioset-10-10-0.4593`, downloaded on first use); `AUDIOTAGS_THREADS` sets CPU threads |
| `driftgate.py` | `opencv-python-headless`, `numpy` |
| `lookgate.py` | `opencv-python-headless`, `numpy` |
| `wan_i2v.py` | `torch` with CUDA, `diffusers`, `Pillow`, `ffmpeg`; the model from `--model` or `$WAN_I2V_MODEL` (default the Hugging Face id `Wan-AI/Wan2.2-TI2V-5B-Diffusers`) |

CPU tools run through `heavy-run`; GPU tools (`wan_i2v.py`, `audiotags.py` on a GPU) run through
`forge/endoforge/tools/throttle/gpu-queue.py`. Run long measurements as a written script in a unit, never as an ad-hoc
chain inside an app session.

## Usage

```sh
python3 filmstats.py reference.mp4 film/ref --fps 8 --width 640       # the whole reference, every shot
python3 filmstats.py ours.mp4 film/ours
python3 filmgate.py film/ours film/ref/bands.json --segments beats.json --out film/ours/gate.json
python3 -m demucs -n htdemucs -o stems ours.wav                        # then:
python3 audiostats.py stems/htdemucs/ours film/ours/shots.json film/ours/audio.json
python3 audiotags.py ours.wav film/ours/tags.json --win 1.0
python3 driftgate.py gen.mp4 passes/line.mp4 --mask passes/mask.mp4 --hue 350,15 --out gen.drift.json
python3 lookgate.py keyframes/b4-k03.png look/b4-target.png --out look/b4-k03.gate.json
python3 wan_i2v.py keyframe.png out/test --prompt "..." --frames 121 --steps 30
```

Segments are `[{"id", "start", "end"}]` in seconds, or a lesson-style `{"beats": [...]}`. A bands file holds
`p25/p50/p75` per metric plus `moving_share`, weighted by screen time; Foundation Film's `reference_bands` computes it.

## Feeding Foundation Film

Foundation Film takes bounded integers only: multiply every measure by 1000 and round (shares become per-mille,
seconds become milliseconds, dB and LUFS become milli-dB and milli-LU).

| Producer field | Foundation input |
|---|---|
| `shots.json`: `start`, `end` (s) | `shots[].start_ms`, `end_ms` |
| `shots.json`: `camera` | `shots[].camera` (unchanged) |
| `shots.json`: `sharp`, `black`, `subject_motion`, `luma`, `dof`, `sat` (and any other per-shot number) | `shots[].metrics.<name>` × 1000 |
| `summary.json`: `audio.lufs`; an `ffmpeg ebur128=peak=true` pass for true peak | `audio_gate.integrated_lufs`, `true_peak_dbtp` × 1000 |
| `audiostats.py`: `voice_db - music_db` on voiced shots (weighted by voice time); count of shots with `cut_hit > 4` | `voice_over_bed_db` × 1000; `cuts_with_hit` and `cuts` (one cut per shot after the first) |
| `audiotags.py`: labels above a probability floor | `heard` (unique labels) |
| an ASR pass (e.g. Whisper) per recorded line against its locked text | `line_wer[].wer_permille` |
| `driftgate.py --out`: `frames[].edge_f1`, `frames[].mask_iou` | `drift_verdict.frames.edge_f1[]`, `mask_iou[]` × 1000 |
| `lookgate.py --out`: `metrics` (same names) | `look_gate.frames[].metrics.<name>` × 1000, one frame per keyframe or sampled frame, `id` of your choosing; `--thresholds` values × 1000 go in `look_gate.thresholds` |

## Gaps

- No test suite or fixtures for the producers yet. The Foundation's tests check its ports of `filmgate.py` and of
  `driftgate.py`'s every-frame rule and `lookgate.py`'s checks against those tools' float logic (the last also on the
  reference run's 14 real beat receipts).
- `driftgate.py` segments the subject by a hue band; it fails when the generation tints the subject. A promptable
  segmenter, region-separated scores (subject and equipment), depth, flow and identity metrics are planned
  (PLAYBOOK-film.md, the drift gate).
- `lookgate.py` compares global statistics, not content: a frame can pass with the wrong subject in it. Pair it with
  `driftgate.py` (structure) and a person's look. Its thresholds come from one film's frames.
- `audiostats.py` has no true-peak measure; take it from `ffmpeg -af ebur128=peak=true`.
