# Post-mortem: generative video for "The Legend of a collaborator" (2026-10-26)

**Outcome:** dropped. Craig, after watching the proof clips: "the generated videos are terrible", "the video gen idea is 86ed". The
film became a straight Blender render ("then its just a straight up render"). This document is for the next attempt: what we
tried, what it cost, why it failed, and what must be true before trying again.

## What we wanted

Concept-art-quality animated shots (a stylised blocky red character inside industrial ammonia pipes and vessels) at 1080p 24 fps,
with the engineering truth (geometry, flow, phase, timing) enforced by our own three.js renderer. Craig's rule: "we need to use our
pipeline to enforce the realism in the generations".

## What we tried (in order, with measured numbers)

| # | Approach | Hardware | Result | Cost / time |
|---|---|---|---|---|
| 1 | Wan 2.2 TI2V-5B image-to-video from a concept frame, prompt only | RTX 4080 local | Drift within ~1 s: hat became a star, face slid onto the vest, frame washed out by frame 90 | 360 s per 5 s at 960×544; 10.4 GiB |
| 2 | Wan 2.2 VACE-Fun A14B, depth control from our render + restyled first frame, 50 steps CFG 5 | H100 | Followed the motion but ignored the styled start frame (frame 0 similarity 0.13–0.20); flat "render" look returned | 47 s/step, 40 min per 81-frame 720p clip at 16 fps |
| 3 | Same, Wan2.2-Lightning LoRA 6 steps CFG 1, first + last keyframes | H100 | Washed out and foggy; context scale 0.5 melted the character by frame 60 | 23 s/step, ~7.6 min/clip |
| 4 | Wan 2.2 Fun-5B-Control, canny (edges) from our render + start frame | H100 | Best of the bake-off: frame 0 matched (0.99), edge F1 0.56; head and arms turned translucent pink in the second half | 3.4 s/step, ~190 s per 121-frame clip, ~20 GB |
| 5 | LTX-2.5 Layout-to-Render | — | Not run: Hugging Face weights gated ("Agree and Access" never clicked) | — |
| 6 | A14B on RTX 5090 | 5090 | Only `sequential_cpu_offload` worked; other modes OOM (GPU, then 117 GB host) | 60 s/step (Lightning), 102 s/step (50-step) |
| 7 | **Keyframe route (b4 proof):** render stills → image-gen restyle (Codex gpt-image) → SeedVR2 4K keyframes → video fill between keys every 0.5 s / 1 s (Fun-5B canny, Fun-A14B-InP) → SeedVR2 video upscale → 1080p | H100 + Codex | Keyframes reached the concept look; fills popped at keys (5B misses the end key: pixel error ~19 vs ~6), line-pass bubble rings printed circles on the liquid, texture swam. Craig: "terrible" | $9.12 pod, 2.3 h |

Total spend: about $17 of RunPod H100/5090 time, ~1,000 Codex image calls' worth of quota, and about 6 hours of wall clock across
the day.

## Why it failed (root causes)

1. **The look has to come from somewhere, and video models pull toward their conditioning.** With depth or edges only, the model
   fills surfaces with its prior (clean CG). One styled frame cannot hold 80 frames. Pinning both ends at short spans helped
   structure but not texture stability.
2. **Resolution and frame-rate ceilings.** The open control models generate at 720p (A14B at 16 fps). Upscaling (SeedVR2)
   sharpens but cannot invent consistent detail frame to frame; it amplifies swimming.
3. **Temporal instability of generated texture.** Boiling liquid, bubbles and wet steel are exactly the high-frequency, moving
   content that swims and flickers. Key frames pop where the fill drifts.
4. **Off-distribution character.** A blocky non-human mascot with flat red surfaces melted, turned translucent or lost its hat.
   No character LoRA was trained.
5. **Garbage in.** We generated before the base render had the look. The restyled keyframes were good; the motion between
   them was not.
6. **Proxy gates passed bad video.** Edge F1, the look gate and VBench-style consistency ranked clips, but none was calibrated on
   Craig's verdicts on moving footage. The first human look at motion came after a full proof.
7. **Tooling friction:** gated weights (LTX), model-card capability mismatches (VACE-Fun has no first/last frame), offload modes
   that OOM, Codex image_gen capped near 1672×941 per image (2×2 sheets gave 836×470 cells).

## What must be true before trying again (re-entry checklist)

- [ ] The base render already meets the look bar on stills and in motion. Generation is polish only (texture, atmosphere), never the source of the look.
- [ ] A model that does **native 1080p+ at 24 fps** with **multi-keyframe + dense control** (render depth/edges/motion vectors) and runs on our hardware or an affordable API. Check gated weights and the model card's actual capabilities first.
- [ ] A **character LoRA** trained on our own hero turntables in the target look (not raw renders).
- [ ] **Temporal gates calibrated on Craig's own accepts/rejects of moving clips:** warp error against the render's motion vectors, flicker at key joins, texture swim in masked regions. Proxy scores alone never ship.
- [ ] **A 2-second moving test reviewed by Craig before any batch.** Stills never stand in for motion.
- [ ] Closed tools (Luma Ray Modify, Kling, Runway Aleph) A/B'd on the same 2-second shot when open models fail; parked on 2026-10-26 by Craig ("we'll stick with open for now").
- [ ] Budget and stop rule set up front (this day spent ~$17 and 6 h before the verdict).

## What we keep

- The bake-off harness, drift gate and look gate (`forge/endoforge/tools/film/`), and Foundation Film's judgement tools.
- The keyframe restyle knowledge: image-gen stills can hit the concept look; they are useful as **lookdev targets** for the 3D render.
- RunPod facts (`research/runpod.md` in the job folder): H100 stock, v2 API, delete-not-stop.
