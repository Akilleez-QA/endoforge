#!/usr/bin/env python3
"""wan_i2v.py <image> <out-stem> --prompt "..." [--neg "..."] [--model DIR|HF-ID] [--w 960 --h 544 --frames 121
             --steps 30 --seed 1 --guidance 5]
Universal image-to-video with Wan 2.2 TI2V-5B (Apache-2.0, local, 24 fps). The prompt is encoded on the CPU, the
transformer runs fp8-stored with CPU offload (fits a 16 GB card). Run it through the GPU queue
(forge/endoforge/tools/throttle/gpu-queue.py). The model is --model, else $WAN_I2V_MODEL, else the Hugging Face id.
Unconditioned image-to-video drifts within about a second: use it for keyframe motion tests only, never as a final
(PLAYBOOK-film.md, I20). Writes <out-stem>.mp4, <out-stem>_frames/, <out-stem>.json."""
import argparse, json, os, subprocess, time
from pathlib import Path
import torch
MODEL = os.environ.get('WAN_I2V_MODEL', 'Wan-AI/Wan2.2-TI2V-5B-Diffusers')
NEG = ('blurry, deformed, extra limbs, melting face, warped text, changing design, flicker, jitter, '
       'low quality, watermark, logo')
ap = argparse.ArgumentParser()
ap.add_argument('image'); ap.add_argument('out')
ap.add_argument('--prompt', required=True); ap.add_argument('--neg', default=NEG); ap.add_argument('--model', default=MODEL)
for k, v in (('w', 960), ('h', 544), ('frames', 121), ('steps', 30), ('seed', 1)):
    ap.add_argument(f'--{k}', type=int, default=v)
ap.add_argument('--guidance', type=float, default=5.0)
a = ap.parse_args()
from diffusers import AutoencoderKLWan, WanImageToVideoPipeline
from PIL import Image
t0 = time.time()
vae = AutoencoderKLWan.from_pretrained(a.model, subfolder='vae', torch_dtype=torch.float32)
pipe = WanImageToVideoPipeline.from_pretrained(a.model, vae=vae, torch_dtype=torch.bfloat16)
pipe.transformer.enable_layerwise_casting(storage_dtype=torch.float8_e4m3fn, compute_dtype=torch.bfloat16)
with torch.no_grad():
    pe, ne = pipe.encode_prompt(prompt=a.prompt, negative_prompt=a.neg, do_classifier_free_guidance=a.guidance > 1,
                                device=torch.device('cpu'), dtype=torch.bfloat16)
pipe.enable_model_cpu_offload(); pipe.vae.enable_tiling()
img = Image.open(a.image).convert('RGB').resize((a.w, a.h))
frames = pipe(image=img, prompt_embeds=pe.to('cuda'), negative_prompt_embeds=None if ne is None else ne.to('cuda'),
              height=a.h, width=a.w, num_frames=a.frames, num_inference_steps=a.steps, guidance_scale=a.guidance,
              generator=torch.Generator('cpu').manual_seed(a.seed), output_type='pil').frames[0]
fd = Path(a.out + '_frames'); fd.mkdir(parents=True, exist_ok=True)
for i, im in enumerate(frames): im.save(fd / f'{i:04d}.png')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24', '-i', str(fd / '%04d.png'), '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p', '-crf', '16', a.out + '.mp4'], check=True)
meta = dict(vars(a), fps=24, seconds=round(time.time() - t0, 1),
            peak_vram_gib=round(torch.cuda.max_memory_allocated() / 2 ** 30, 2))
Path(a.out + '.json').write_text(json.dumps(meta, indent=1)); print(json.dumps(meta))
