# Film production playbook

**Purpose.** How to make a short film that matches a reference (a parody, a house style, a brief's "make it look like
this") with many agents at once, and which tool or gate enforces each step. Written on 2026-10-26 from the reference
run, a 3-minute animated parody whose review cut was rejected as "nowhere near good enough nor cinematic enough"
(running notes: `/mnt/cold-steam/factory-scratch/mrton/NOTES.md`, mistakes #1–#76). Everything below is stated for any
film; the reference run is cited only as the source of the numbers. Read it with
[PLAYBOOK-deadline-fanout.md](PLAYBOOK-deadline-fanout.md), which covers atomize → parallelize → recombine; this one
covers what is particular to picture and sound.

**Summary.**
- A film is judged by people on the **whole** reference: shots, motion, light, optics, sound and the arc over time.
  So "match the reference" is measured on the whole reference and gated on the same measures (I16). Presence checks
  (is the character in frame, is it on-model, is anything clipping) are necessary and never sufficient.
- Plan before build (I17): target frames and a council, with a built-vs-needs-built matrix, before any lane builds.
- Shared vocabulary is contract (I18): cue ids, marker names, shot ids and units are frozen before lanes start and
  checked statically before any render.
- The voice is recorded first and is the clock. Picture, overlays, effects and music all resolve their timing from it.
- Generation adds appearance only (I20). The renderer is ground truth for geometry, physics, camera and timing; every
  generated clip passes a drift gate against the renderer's own passes, judged on its worst frame.
- **Prep before render** (I17). An approved look bible, hero assets (reused from any sibling project's library before
  anything is modelled) and a lookdev lab come before any shot is rendered for the film. If flat renders reach review,
  the prep was not done.
- **The route** (set by the client, 2026-10-26): render stills → image generation with an explicit upscale →
  keyframes about every 0.5 s → a video model fills between consecutive keyframes → an explicit video upscale. The look
  is pinned at both ends of every short span, and upscaling is a stage of its own, never a side effect.
- A look gate compares every keyframe and in-between frame with its approved target. It is a **rejection alarm**:
  it catches flat or washed-out frames, and the client, judging moving proofs, stays the acceptance authority.
- Measures are produced by Endoforge (`tools/film/`) and judged by Foundation Film (`foundations/film/`, six tools).

## First principles

1. **The oracle must measure the outcome, not a proxy of it** (P2, I3, I12). The reference run's gates all passed and
   the film still failed, because every gate measured presence. The fix is to measure what a viewer perceives (camera
   movement, subject movement, sharpness, depth of field, exposure, frame fill, loudness, voice-over-bed margin, hits on
   cuts, what is heard) on the reference and on ours, with the same tools.
2. **Intent and references are conserved across every transformation** (P1, I1, I2). A reference is a film, not a
   set of stills: stills hide motion, rhythm, sound and the music arc. Comments on the reference (what people say
   landed) are part of it.
3. **One clock** (P-A, I18). Time is defined once, by the recorded voice, and everything else is expressed relative to
   named cues. A second, hand-typed copy of time (absolute seconds in a beat file, a checker or an assembler) breaks
   at the first retime.
4. **Truth before appearance** (I4, I20). Geometry, physics, phase, flow direction and timing come from the pipeline,
   which can be checked. Appearance (texture, light response, fluid look, a painterly finish) is what generation is
   good at, and nothing else is delegated to it.
5. **Throughput is set by the critical path, not the machine** (I13). In the reference run the machine sat at
   3–26 % CPU; the long poles were the character asset, the single GPU slot, a human quality look, and stages that
   waited for each other.

## The pipeline

Each stage ends at a gate. A stage's output is frozen when its gate passes; downstream work always runs against the
current frozen version of everything it depends on (U4).

| # | Stage | Produces | Gate before the next stage | Tool |
|---|---|---|---|---|
| 1 | **Whole-reference analysis** | Shot list with per-shot camera, subject motion, optics, light, palette; stems (voice, drums, bass, other); heard classes per second; loudness; music arc over time; a vision pass per shot (what, camera, lighting, optics, why it works); the audience's comments | The reference's bands exist for every metric the film will be gated on, and the arc is written down section by section | `tools/film/filmstats.py`, `tools/film/audiostats.py`, `tools/film/audiotags.py`; Foundation Film `reference_bands` |
| 2 | **Concept frames** | One target frame per scene (image model or paint), each tied to the reference shot it echoes | A person picks or rejects each frame; untraceable details are marked INVENTED for the person to OK (I1) | concept tool; job card |
| 2b | **Prep: look bible, hero assets, lookdev** | The approved target frame per shot, with colour and lighting notes (the look bible); hero assets, reused first from sibling projects' libraries (an equipment library, a lit set) and only then built; a hero character model; a lookdev lab scene per material and effect | The client approves the look bible; a lookdev still of each hero asset passes the look gate against its target before any film shot is rendered | asset inventory across sibling projects (I17); `tools/film/lookgate.py`; Foundation Film `look_gate` |
| 3 | **Council** | One merged plan from craft seats (director, animation, sound, technical), a domain expert, and the brief's owner; conflicts resolved with reasons; a **built-vs-needs-built matrix** naming each capability, the primitive it extends and its lab scene | Every acceptance criterion maps to an atom whose contract can express it (I15); nothing re-stages an existing prototype unchanged (I17) | `tools/job` (I15 validator) |
| 4 | **Frozen contracts** | Types and interfaces between lanes; the **cue vocabulary** (anchor ids per beat, in order, plus timing rules such as minimum voice-free gaps); shot ids; units; file ownership | Static check of every referenced id against the vocabulary, before any lane builds on it (I18) | Foundation Film `cue_vocabulary_check` |
| 5 | **Voice first** | Recorded narration with word timings; named markers for the frozen cue ids; WER per line against the locked text | Pace in the target band (measured words per minute from timestamps), WER ≤ 5 % per line, every vocabulary id emitted | provider adapter; ASR pass; `cue_vocabulary_check` |
| 6 | **Capability lanes on a streaming DAG** | New capabilities built from existing primitives, each with a lab scene; scene lanes, one beat file each | Per lane on landing: apply, build, type-check, the lane's own tests, one slice render; revert only that lane on failure (P-B) | `dagrun.py`-style streaming runner; collect gate |
| 7 | **Per-shot render passes** | Beauty (accumulated: depth of field, motion blur at the reference frame rate, 180° shutter), linear depth, geometric line pass (not Canny of the beauty), object ids and subject mask, pose keypoints, screen-space motion vectors, protected regions, camera metadata | The direct render is a complete fallback final; passes decode, have the right frame count and resolution | renderer pass exporter |
| 8 | **Keyframes: render stills → image gen → explicit upscale** | A render still at final framing about every 0.5 s of each shot, with its passes; each restyled to the look bible (references: the target frame, the previous approved keyframe, the character sheet); then an explicit upscale step (an image super-resolution model, or native 2K–4K generation) | Per keyframe: the drift gate on the still (structure) and the look gate (alarm); then the client approves the keyframes before any video spend | image model under control; image upscaler; Foundation Film `drift_verdict` and `look_gate` |
| 9 | **Video fills between keyframes** | For each pair of consecutive approved keyframes, the video model generates the short span between them, with depth and line passes as control, inside one native window | Drift gate (stage 10) and the look gate on every in-between frame; no visible pop at a keyframe join | control-conditioned video model through `tools/throttle/gpu-queue.py` |
| 10 | **Drift gate** | Per-frame edge F1, subject mask IoU, depth error, identity similarity, exposure and temporal checks against the passes | Every frame passes (worst frame, never the mean). Then reroll seeds → raise control strength or lower keyframe denoise → protect the failing region → fall back to the direct render | `tools/film/driftgate.py`; Foundation Film `drift_verdict` |
| 11 | **Explicit video upscale and composite** | The clip super-resolved to delivery (for example 1080p24) as its own stage; protected regions and exact overlays (labels, arrows, numbers, logos) composited from the renderer **after** upscaling; one grade applied to both routes | The drift and look gates again at delivery resolution (upscalers invent detail) | video super-resolution; compositor |
| 12 | **Mix and master** | Stems (voice, music, effects, ambience) and the mix; effects placed on cue events so a retime moves them | Audio gate (below) | mixer; Foundation Film `audio_gate` |
| 13 | **Reference-measured gates** | The finished film measured with the same tools as the reference | Cinematic gate per beat and for the whole film; audio gate; a blind A/B against the direct render; then the person's quality call, which no gate replaces | `tools/film/filmgate.py`; Foundation Film `cinematic_gate` |

Run stages 5 (voice) and 2–3 (concept and council) in parallel from the start: the voice is on the critical path,
because every cue resolves from it. Human gates (concept picks, the voice pick, still reviews, the pilot clip) are
batched and kept off the critical path.

## The gates

Every threshold below is **Proposed** (status CHECK in Foundation Film) until it has passed a known-good film and failed
known-bad ones on the matching check (I3). The reference numbers are **Recorded** from the reference run.

### Cinematic gate (`cinematic_gate`, I16)

Per segment (a beat, or the whole film), the screen-time-weighted mean of each per-shot measure is compared with the
reference's bands (duration-weighted p25/p50/p75 from `reference_bands`):

| Check | Rule | Why |
|---|---|---|
| Camera movement | moving share ≥ the reference's | a locked-off camera reads as a slide show |
| Sharpness | p25 / 2 ≤ Laplacian variance ≤ p75 | over-sharp, focus-free CG reads as cheap; under p25/2 is mush |
| Frame fill | near-black share ≤ max(p75, 35 %) | the frame is filled, not a void |
| Subject motion | ≥ p25 | something moves inside the frame |
| Exposure | mean luma ≥ p25 | not underexposed |

Reference run, **Recorded**: the reference's CG shots (41 of 64) moved the camera 50.8 % of the time; ours was 85–96 %
locked off, 72 % black and about 3× too sharp, at 15 fps with no motion blur. Depth of field, saturation and the other
measures are reported per segment and can be gated by explicit rules.

### Audio gate (`audio_gate`)

| Check | Contract | Reference run, Recorded |
|---|---|---|
| Integrated loudness | −16 ± 1 LUFS | reference −16.9 LUFS; rejected cut −34 LUFS |
| True peak | ≤ −1 dBTP | |
| Voice over bed while speaking | 12–15 dB | reference bed about 14 dB under the voice, ducking only about 2 dB |
| Hits on cuts | a hit or whoosh within 0.3 s on ≥ 80 % of cuts | reference 50 of 64 cuts (78 %) |
| What is heard | Speech and Music (and each named effect) heard; no Sine wave | the rejected cut's bed was heard as "sine wave" and "chirp tone" |
| Intelligibility | WER ≤ 5 % on every line | |

A field that was not measured is "not measured", and the verdict is then "not scored", never a number (P-E).

### Drift gate (`drift_verdict`, I20)

Per frame, against the renderer's passes: edge F1 (structure), subject mask IoU (on-model and in place), and when
available depth error after scale/shift fit, identity similarity of the subject crop to its reference views, exposure
against the beauty pass, and flow or warping error. The clip passes only when **every** frame passes. Starting
thresholds: edge F1 ≥ 0.45, mask IoU ≥ 0.60 (Proposed). Calibrate before trusting them: the direct render must pass
with margin, an unconditioned clip must fail early, and a perturbed pass (shifted, recoloured, a part painted out)
must fail on the matching metric. Score subject and equipment regions separately when the producer can: a high
full-frame score can hide one bent part. A vision-language judge may flag a clip for review; it never passes one.

### Cue vocabulary check (`cue_vocabulary_check`, I18)

Every id a lane references resolves to a provided id, directly or through one alias; each beat's required sequence
lands in strictly increasing time; each timing rule (for example a minimum voice-free gap before a musical swell)
holds. Run it before any render, and again whenever the voice is re-recorded. Reference run, **Recorded**: 52 ids were
unresolved because each scene lane invented its own names while the voice lane wrote word markers.

### Look gate (`look_gate`, a rejection alarm)

Per frame, against its approved target (the concept frame, or the approved keyframe for in-betweens), both resized to
the same size, `tools/film/lookgate.py` measures:

| Check | Default threshold (Proposed) | Catches |
|---|---|---|
| Palette distance, CIE Lab a/b and L (earth mover's distance of the histograms) | a/b ≤ 6, L ≤ 8 | the wrong colours, a washed-out or fogged frame |
| Median lightness and p5–p95 contrast-range differences | ≤ 10 and ≤ 15 (L, 0–100) | under- or over-exposure, flat contrast |
| Extra near-white and near-black clipping, frame minus target | ≤ 4 % and ≤ 8 % | blown highlights, a void |
| Detail ratio (Laplacian energy per pixel, frame over target) | 0.55–1.8 | flat primitive renders, mush, over-sharpening |
| Chroma ratio (mean chroma, frame over target) | 0.7–1.4 | desaturated or garish frames |

Every frame must pass every check. Calibration, **Recorded** on the reference run: the target against itself,
re-encoded copies and a restyled keyframe pass (detail 0.99); all 14 rendered beats fail (11 on detail at
0.065–0.433 of the target, the end card at 2.37, two on palette and chroma); both unconditioned generated clips fail
(detail 0.16–0.29 at 720p). It measures global statistics, not content, so a frame with the wrong subject can pass.
**Passing means "not rejected", never accepted.** Structure is the drift gate's question, and the look is accepted by
the client on moving proofs, not on stills or metrics (I11, I12).

### Other gates that stay outside Foundation Film for now

Likeness (a frozen checklist scored against the reference frames, with invented details flagged), script fidelity per
beat, the per-lane collect gate, and an overlay pre-flight that runs setup and draw on a sweep of frames before a full
compose. Each is in `tools/job` or the run's own scripts; each should become a Foundation tool once its measure is a
number.

## The generation rule (I20)

Generative models restyle; the pipeline stays ground truth for geometry, physics and timing.

- **Never unconditioned.** Image-to-video from one frame drifted within about a second on the reference run: the hat
  became a star, the face slid onto the vest, and the frame washed out by frame 90. Edge F1/mask IoU went from 0.98/0.84
  at frame 0 to 0.08/0.0 at frame 90 (Recorded), so a clip mean would have passed it.
- **Control from the renderer's own passes, not estimates.** The bake-off fed Canny of layout frames and an estimated
  depth video; every clip failed from frame 0 (edge F1 mean 0.21–0.56), and the last frame's similarity to the
  keyframe fell to 0.15–0.17 (Recorded). Export the true line, depth, id and motion passes, and anchor the end of each
  shot with its own restyled keyframe.
- **Exact things never pass through diffusion.** Text, labels, arrows, gauges, logos and counted objects are rendered
  as an overlay at delivery resolution and composited after the upscale.
- **Every shot keeps a direct route.** A hybrid shot wins its place only when it passes the drift gate and beats the
  direct render in a blind A/B and in the person's eye. Shots whose truth is precise geometry, text or counting stay
  direct.
- **Pinning both ends of a long span is not a look lock.** A first-and-last keyframe clip (5 s apart at 720p, a
  6-step distilled sampler at CFG 1) came out washed and foggy, and its frame 0 did not match its own keyframe
  (Recorded, 456 s on an H100). Hence the route: keyframes about every 0.5 s, each upscaled explicitly, so the video
  model fills only short spans, and the look gate checks every in-between frame.
- **Gate the look, not only the structure.** Flat primitive renders passed every structural and presence check
  until a look gate compared them with the concept art; then every beat failed.
- **Native windows only.** Keep each shot inside one native generation window (frame counts of 4n+1 and 8k+1, e.g.
  121), at the render's own aspect and frame rate, so nothing is resampled or chained.

## Throughput and cost (2026-10-26)

| Item | Number | Label |
|---|---|---|
| Layout render, 1280×720, one sample, RTX 4080 | 133 ms/frame | Recorded |
| Earlier capture baseline, one sample at 15 fps | 381 ms/frame; re-composite only 55 ms/frame | Recorded |
| Unconditioned TI2V-5B pilot, 960×544, 5 s, RTX 4080 | 360 s per clip, 10.4 GiB peak | Recorded |
| Fun-5B-Control, 1280×704, 121 frames at 24 fps, 40 steps, H100 80 GB, CPU offload | 3.4 s/step; 2 min 16 s sampling; about 190 s per clip with load; 19–20 GB peak | Recorded |
| VACE-Fun-A14B, 1280×720, 81 frames at 16 fps, 50 steps, H100 80 GB, CPU offload | 47.6 s/step; 39 min 41 s sampling; 41 min per clip with load; 80 GB peak. The run reported it compute-bound, with no gain from a full fp8 load | Recorded |
| H100 SXM 80 GB, RunPod Secure | $3.99/h (RTX PRO 6000 96 GB $2.49/h) | Recorded (price) |
| Cost per 5 s take on an H100 | about $0.21 (5B, 40 steps); about $2.70 (A14B, 50 steps) | Derived |
| A14B with a 4-step distilled LoRA | about 1–1.5 min per take | Estimated (published anchors, not measured here) |
| Narration, ElevenLabs `eleven_v4` | about 0.44 credits per character; about 650 credits per full pass of about 1,400 characters; lane budget 3,000 credits | Estimated (plan) |
| Narration pace | the speed setting had no effect (0.7 and 0.8 gave identical 199 wpm takes); delivery tags and stretched pauses reached the 105–115 wpm target | Recorded |
| Score, Suno (Premier plan, model v6) | four original cues (intro, ride, sung hero theme, anthem); 8 of the plan's 67 WAV downloads | Recorded |

### Pods (RunPod, researched and queried 2026-10-26; prices and stock change within minutes)

| Item | Number | Label |
|---|---|---|
| RTX 4090 24 GB / RTX 5090 32 GB / H100 SXM 80 GB, Secure, on demand | $0.89/h (stock low) / $1.19/h (medium) / $3.99/h (medium); no Community stock; no spot for H100 | Recorded (price) |
| Cycles, Blender Open Data median score | 5090 15,080; 4090 11,682; H100 about 5–6k | Recorded (published) |
| Cycles cost per frame | consumer cards 2–3× cheaper than an H100 | Derived |
| A 14B video model on 24 GB | needs fp8 plus swapping one expert at a time; expected about 3–4× slower per clip than an H100, so about equal cost per clip | Estimated (untested) |

Facts that change how a farm is run: the REST v1 API retires on 2026-11-15 (a helper on REST v1 or GraphQL must move
to v2 first); a network volume pins its pods to one datacenter and attaches only at create; rsync needs an exposed
port 22 and `startSsh` (the web proxy gives a shell only); a stopped pod can come back with zero GPUs, so delete pods
instead of stopping them; there is no built-in idle shutdown, so a lifetime watchdog deletes the pod. Shape: weights
on a network volume filled once from a CPU pod in the same datacenter, one worker per GPU on a shared shot queue.
Benchmark one shot per candidate GPU before choosing the farm; send Cycles finals to consumer cards, not H100s.

What follows from the numbers: rendering and compositing are cheap, so iterate on real-time stills and clips and keep
finals for last; local GPU time suits look development and previews; pod time for finals costs dollars, not hundreds;
and the scarce resources are the person's review, the single GPU slot and the stages that wait for the voice.

## Lessons: each mistake, its invariant and its tool fix

Costs are from the running notes. Status: **built** (an Endoforge tool, a Foundation or a merged PR enforces it),
**partial** (the first stage of the enforcing tool exists), **run script** (fixed in the reference run's own scripts,
not yet a tested Endoforge tool), **rule** (written down, not enforced), **open** (a tracked gap). Principles P-A…P-G and U1–U7 are defined in the running notes; I1–I22 in the repo
`AGENTS.md`.

| # | Mistake (universal form) | Cost | Invariant | Fix | Status |
|---|---|---|---|---|---|
| 1 | A queue directory was a link into /tmp; a reboot left it dangling and every GPU job failed | 1 launch | I7 | the queue recreates the link's target (#386) | built |
| 2 | A relative path resolved against the server's root, not the caller's | 1 launch | P-C | resolve to absolute (plate patch) | open |
| 3 | A worktree lacked installed dependencies | 1 launch | I9 | dependency links per lane (#388) | built |
| 4 | Parallelism shaped as competition: N copies of one piece | ~8 min | I13 | fan-out mode, duplicates only on the critical path (#387) | built |
| 5 | The whole scene lived in one file | ~8 min | I6 | split first, prove it a no-op (#388) | built |
| 6 | A pool tool refused to start without an environment variable | 12 lanes | I9 | default to PATH (#385); smoke launch | built |
| 7 | A multi-value flag swallowed the prompt; stdin was ignored | 2 relaunches | P-C | prompt before the flags; stdin passed through (#385) | built |
| 8 | A round restarted mid-consult; serial consult and critic stages | ~2 min | I13 | one critique-and-fix stage per worker (#387) | built |
| 9 | Two agents edited one file | ~2 min | I5 | ownership map before launch (#388) | built |
| 10 | Login count assumed, not discovered | none | I19 | login discovery (#387) | built |
| 11 | One login sat idle | capacity | I13 | least-loaded rotation (#387) | built |
| 12 | A foreground sleep was blocked by the harness | 1 retry | I8 | background until-loop or a monitor | rule |
| 13 | A user-only command was invoked by the agent | none | I11 | ask the person to run it | rule |
| 14 | A collector misparsed status output | none | P-D | parse the path after the status field | run script |
| 15 | A rule ignored the design's own constants | false failures | I3 | calibrate on design constants; re-score history | run script |
| 16 | New files were invisible to the diff | none | P-D | mark intent-to-add before diffing | run script |
| 17 | A load recorder stalled silently | data gap | I12 | watch log freshness | open |
| 18 | Worktrees were created one after another | >2 min | I13 | sparse or parallel worktrees | open |
| 19 | A diff was read without a noise floor | none | I6 | render the baseline twice | built |
| 20 | A shared seam file had no owner | a round | I5 | seams get owners | rule |
| 21 | The defining visual reference never reached the atom it governed | ~25 min, the whole character track | I2 | the job validator refuses a governed atom without its reference; likeness gate (#396–#400) | built |
| 22 | References and the brief lived in /tmp | recovery | I7 | the validator refuses /tmp paths | built |
| 23 | Briefed from a summary instead of the script | as #21 | I1 | verbatim goal and primary sources on the job card | built |
| 24 | A background job ran inside the app | caught | I8 | systemd units only | rule |
| 25 | A pattern kill matched its own shell | 1 retry | P-F | stop units or kill by PID | rule |
| 26 | A token format was written from memory | 4 issues | P-C | read the checker; compile prompts from interfaces | built |
| 27 | The spec invented details nobody asked for | 1 round | I1 | every spec line traced to a source or shown as INVENTED | rule |
| 28 | Details were tuned before the archetype was known | 1 question | I1 | ask what the subject is (role, world, attitude) first | rule |
| 29 | Lanes never saw a render of their own work | a round | I3 | per-atom streaming loop with its own render (beatloop) | run script |
| 30 | The coordinator ended its turn after each launch | minutes per stage | I13 | supervise inside the turn; the Conductor (#404) | partial (#404) |
| 31 | A contract change was not gated like an atom | 2 renders | P-B | contract changes run the scene check and one render | rule |
| 32 | A busy guard was scored as a failure | a false 0 | P-E | typed errors: wait, stop, not scored (#403) | built |
| 33 | Option parsing broke; one transient failure was terminal | stuck atoms | P-D | parse options first; retry transients 3 times | run script |
| 34 | Two collects ran at once | none | I5 | an exclusive lock around collect | run script |
| 35 | A manifest was edited while a loop wrote it | none | I5 | a manifest lock every writer takes | run script |
| 36 | The same failing instruction was re-sent three rounds running | 2 rounds | U1, I14 | escalate after two identical failures | rule |
| 37 | Lanes did not know the camera grammar | 3 iterations | U3, I2 | knowledge in the manifest, routed by tag | run script |
| 38 | Job-specific knowledge was hard-coded into a tool | rework | P-A | tools are mechanism; specifics are data | run script |
| 39 | A multi-step measurement ran as an ad-hoc chain and drifted | 1 pass | I8 | written scripts in units | rule |
| 40 | Downstream atoms were judged against a stale upstream asset | ~4 iterations | U4 | integrate the best upstream provisionally; re-judge | rule |
| 41 | The critic's rubric changed every run | several iterations | U5, U6 | freeze the rubric; per-item ratchet | run script |
| 42 | An effect was sized without reference to the frame | 7 iterations | U7, U2 | measure screen footprint | rule |
| 43 | A score moved on an unchanged artifact | near-rejection of a fix | U5 | diff before acting on a score change | rule |
| 44 | The checker hard-coded frame times from before a retime | every frame score since | P-A | times and beat attributes derive from the script; measurement tools are atoms with sources | run script |
| 45 | Designed contact was flagged as a defect | 36 false failures | P-A | intent is data: declared contact comes from the script | run script |
| 46 | A position was guessed instead of read | 1 render | P-C | read geometry before moving relative to it | rule |
| 47 | A second fix was tried without looking at the frame | 2 renders | I12 | look first; accept with a documented gap after N tries | rule |
| 48 | A loop's final save overwrote statuses written by hand | a status lost | I5 | the Conductor owns its state; change it by command only (#404) | partial (#404) |
| 49 | A "ready" event fired after a crash | trust | I12 | an outcome event verifies the outcome (exists, decodes, full length) | rule |
| 50 | A per-frame payload grew to 162 MB and hung compose | ~30 min | I8 | size budgets on per-frame data at seams | open |
| 51 | An overlay crash hid behind compose | ~25 min | P-B | overlay pre-flight on a frame sweep before compose | run script |
| 52 | Every gate measured presence; none measured cinema | a full review cycle | I16 | `filmstats.py` + reference bands → Foundation Film `cinematic_gate` | built |
| 53 | Audio was never measured | same | I16 | `audiotags.py`, `audiostats.py` → `audio_gate` | built |
| 54 | Stills were analysed instead of the film | late diagnosis | I16 | whole-reference analysis is stage 1 | built (stage) |
| 55 | Lanes re-staged existing prototypes unchanged | the whole picture approach | I17 | concept frames + council + built-vs-needs-built before any lane | built (stage) |
| 56 | Capture at 15 fps without motion blur against a 24 fps blurred reference | choppy motion | I16 | capture at the reference frame rate with accumulation blur, 180° shutter | open (capability lane) |
| 57 | Narration was written to the picture's length, too fast for the voice | a retime | I4 | voice first; the picture conforms to the recording | built (stage) |
| 58 | Unconditioned image-to-video drifted within a second | 6 GPU-min (deliberate pilot) | I20 | control passes + drift gate → `drift_verdict` | built |
| 59 | The collect gate checked a proxy, not what the lane changed | caught | P-B | type-check and the lane's own tests for what it touched | run script |
| 60 | A runner read "applied" from text output | 1 false failure | P-D | read state files, not text | run script |
| 61 | A browser job was delegated to a headless runtime | ~5 min | I19 | probe the runtime (browser, sign-in, GPU, key) before delegating | rule |
| 62 | Waves were launched by hand | minutes per wave | I13 | a streaming DAG runner (`dagrun.py`) | run script |
| 63 | The gate's module resolution differed from the build's | ~10 min, a false revert | P-C | gate configs mirror the build; a failure in an untouched file is a gate fault first | run script |
| 64 | Lanes whose outputs live outside the repo never "landed" | dependants waited | I12 | an output-exists landing check per lane | open |
| 65 | A provider knob did nothing | ~10 min | I19 | calibrate a knob on one line before trusting it | rule |
| 66 | Each lane invented its own cue names | ~25 min | I18 | frozen cue vocabulary; `cue_vocabulary_check` before any render | built |
| 67 | Timing rules surfaced one boot at a time | several boots | I18 | timing rules as data, checked offline (`cue_vocabulary_check` orders and gaps) | built |
| 68 | A bug fixed in one tool remained in its twin | 1 run | I21 | search every tool sharing the pattern | rule |
| 69 | Shots defined by markers left gaps after a retime | pilot blocked | P-A | shots tile: each holds until the next starts | built |
| 70 | A pod API retires 2026-11-15; stopped pods can return with no GPU; volumes pin a datacenter; rsync needs port 22 | none yet | I19 | port the pod helper to API v2; delete instead of stopping; a lifetime watchdog; volume and SSH set at create | open |
| 71 | The farm GPU was picked by headline speed, not cost per frame for the workload | none | I19 | measure one shot per candidate GPU (5090, 4090, H100) first; Cycles finals to consumer cards | open |
| 72 | A post pass cleared the finished frame; empty shot lists fell back to the end clock; a camera compared voice time with the script's window | ~1 h of pilot time | P-A, P-B | fixed (4e28476ae, b2d2df51e); a per-beat midpoint contact sheet is the boot gate for any timeline change | built (fix); rule (contact sheet) |
| 73 | Keyframes pinned at both ends of a 5 s span did not hold the look; frame 0 missed its own keyframe | 456 s on an H100 | I20 | the route: keyframes about every 0.5 s with an explicit upscale; the look gate on every in-between | partial (`look_gate` built; spacing proof pending) |
| 74 | No gate compared frames with the concept art, so flat primitive renders passed every check; a hero asset library already existed | the whole render path | I16, I17 | `lookgate.py` → Foundation Film `look_gate` per keyframe (rejection alarm); the prep stage (2b) before any render | built (gate); open (prep) |
| 75 | Upscaling was implicit and keyframes sat 5 s apart at 720p | the earlier generation tests | I20 | the client's route makes keyframe spacing and both upscales explicit stages; the proof measures spacing (0.5 s against 1 s) | rule (proof pending) |
| 76a | The pass exporter rejected the scene lanes' string ids and threw on non-mesh primitives; it was tested only on its own fixture | 2 GPU-queue runs (~3 min) | I3, P-B | string ids hash to stable 24-bit ids; non-mesh primitives are hidden in control draws and listed; acceptance runs on the real integrated scene (one still per beat with passes) | partial (patched in a proof worktree, not integrated) |
| 76b | A set was rebuilt from primitives while a sibling project already had a lit set and an equipment library | the whole look | I17 | the built-vs-needs-built inventory searches sibling projects' asset libraries, not only this tree; reuse generic kit only where the film must not show a client's site | open (adoption lane running) |
| 77 | Render passes crossed to Node as JSON number arrays (8.3 M entries per frame); capture ran 44 s/frame, past the guard's 30-min browser cap | 15 frames of a proof | I12 | `passes.ts` sends typed buffers | built (a22726cc6) |
| 79 | Generated images were stretched to 1080p and labelled 1080p; native size was ~1672×941 (2×2 sheets: 836×470) | a keyframe round | I12, I19 | every generated asset records its native size; one frame per call | run script |
| 80 | Gate checks chained with `&&` printed error counts but exited 0, and a patch with 2 type errors landed | 1 commit | I12 | gates must exit non-zero | rule |
| 81 | `git stash` in a shared worktree swept another session's uncommitted edits | another session's work at risk | I4 | `agent-guard` refuses whole-tree stash/reset/checkout ./restore ./clean in a dirty checkout (PR #416) | built |
| 84, 89 | AI critics and an AI blind judge scored a script 8+ that the client called the worst of the day | two script rounds | I16 | AI judges only alarm until calibrated on the client's own accepts/rejects; iterate by staging (script lab) | rule |
| 88 | Generated video fills popped at keyframes and swam; gates ranked clips the client called terrible | ~$17, 6 h | I16, I20 | generation dropped for this film; re-entry checklist in `POSTMORTEM-video-generation-2026-10-26.md` | rule |
| 94 | Each session set up its own cloud pod (~15 min each) | setup time per session | I13 | one shared render service per job | partial (PR #414) |
| 95 | A job with no GPU access held the only GPU-queue slot for 28 min while the card sat at 0 % | two lookdev jobs' queue time | I7 | `gpu-queue` releases the slot of a job that opens no NVIDIA device in 10 min (PR #416) | built |
| 96 | Seven sessions at once plus heavy jobs and three whole-drive scans: the Claude app died (third time) | every session's turn | I7, I22 | `agent-guard` refuses whole-drive scans (PR #416); `lane-governor` admits or queues new lanes (PR #417) | built (both open PRs) |
| 97 | The system drive filled because every work folder installed its own `node_modules` and nothing removed them | 89 % full | I22 | `diskguard`: 85 % alarm, nightly janitor, parallel removal (PR #416) | built |
| 98 | Cloud pods billed while idle after their sessions stopped | $1.31/h | I22 | `pod_watch` notifies after 30 idle min; reaping on request (PR #416) | built |

## Open gaps

- **G-F1:** thresholds are uncalibrated. Collect known-good and known-bad films and clips, then freeze each threshold
  where good passes with margin and bad fails on the matching check.
- **G-F2:** the drift producer segments by a hue band and scores the whole frame. Needs a promptable segmenter,
  subject and equipment regions, depth, flow and identity metrics, and a still-gate mode for keyframes.
- **G-F3:** no producer test fixtures. `tools/film/` has no tests; Foundation Film's parity tests cover only the ported
  logic.
- **G-F4:** the music arc, pacing curve and likeness are judged by people and scripts, not by a Foundation tool.
- **G-F5:** lessons #50, #56, #64, #70, #71 and #76b have no enforcing tool yet; the "rule" rows above are written
  down only.
- **G-F6:** the "run script" fixes (the streaming DAG runner, the per-atom beat loop, the collect gate with its locks,
  the overlay pre-flight, the likeness critic) live in the reference run's folder. Port each into Endoforge as a tested
  tool (P-D); the Conductor's stages 2–4 are where the collect gate, locks, streaming loops and escalation land.

- **G-F7:** the look gate is calibrated on one film's frames and measures global statistics only. Add known-good
  and known-bad looks from other films, a content-aware measure (per-region statistics or an embedding distance), and
  a temporal measure for in-between frames (flicker, pops at keyframe joins).
- **G-F8:** the route is decided but unproven. No moving shot has been accepted; the keyframe-spacing proof (below)
  decides whether spacing or the video model's conditioning is the cause of look loss.

## The prep-stage decision (POODO, 2026-10-26)

Recorded at `/mnt/cold-steam/factory-scratch/mrton/poodo/DECISION-prep.md`. Stated generally:

- **Frame.** Objective: the film looks like the concept art at high resolution, with the pipeline enforcing realism.
  Acceptance authority: the client, on moving proofs. The look gate is a rejection alarm, the drift gate covers
  structure, a flicker metric covers time. Scope: prep and a proof only; no full-film render and no fan-out until a
  proof is approved.
- **Evidence.** Concept frames reach the look; a restyled keyframe from our render passes the look gate. Our real-time
  render fails every beat; both generated clips fail. The equipment library supplies real geometry but not wet,
  frost, fluid or character style.
- **Paths.** Twenty considered. Kept: render-first (assets, lookdev, an offline path tracer) and pixel-first
  (approved keyframes, warp by exact render correspondences, masked fill), both after a look bible and a hero
  character. Rejected for now: video-only generation (failed twice), per-frame image restyle (flicker, cost), closed
  tools (parked by the client), real-time-only polish (a detail ceiling), deferral (the deadline).
- **Precommitments.** Each arm states what it predicts and what fails it. Caps: proof GPU spend ≤ $25 and one working
  day, stopping on either. Before any full-film spend: a delivery spec (1080p24, frame count), camera, pose and timing
  transfer validated, missing internals and effects inventoried, and measured final-setting render time including
  retries, then a capped batch approved first.
- **Then the client set the route** (above): render stills → image gen + explicit upscale → keyframes → video model
  fills between keyframes + explicit upscale; render-first became optional. The proof is one 5 s shot (about 11
  keyframes) with keyframe spacing as the measured variable (0.5 s against 1 s). Predictions: every in-between frame
  passes the look and drift gates, with no visible pop at keyframe joins. If 0.5 s spans still regress, the cause is
  the video model's conditioning, not spacing: next try masked keyframes with depth control.
- **State** (I12): plan only; no route has produced an accepted moving shot; the next observation is the client's
  verdict on the moving proof.

## Sources

- Running notes of the reference run: `/mnt/cold-steam/factory-scratch/mrton/NOTES.md` (mistakes #1–#76, costs,
  principles, the invariants' first draft).
- Scene bible, global sections (hybrid pipeline spec, build order and critical path, music arc):
  `/mnt/cold-steam/factory-scratch/mrton/SCENE-BIBLE.md`.
- Movie plan v3 (the reference measured, new capabilities, gates): `/mnt/cold-steam/factory-scratch/mrton/MOVIE-PLAN-v3.md`.
- Audio script, sections 1–2 and 4 (the reference's soundtrack measured, the mix contract, production):
  `/mnt/cold-steam/factory-scratch/mrton/AUDIO-SCRIPT.md`.
- Bake-off receipts (`bakeoff/*/seed43-*.json`), look-gate receipts (`look/beats-v3/*.gate.json`), pod research
  (`research/runpod.md`) and the prep-stage decision (`poodo/DECISION-prep.md`) under the same folder.
- Research report "Let the render own truth; diffusion paints" (render-guided video generation, October 2026).
- Producers: `tools/film/README.md`. Judge: `foundations/film/README.md` in the repository root.
