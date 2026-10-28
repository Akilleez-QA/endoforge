# What the a collaborator day taught us about akilleez tooling (2026-10-26)

Craig: "write down what you learn about how to improve our akilleez tooling". One day of production on "The Legend of a collaborator"
(full mistake log: the job's NOTES.md, mistakes #1–#94). Each item names the problem, the evidence, and the tool change. Items are
universal; a collaborator is only the reference run.

## 1. Oracles and gates

| Lesson | Evidence | Tool change |
|---|---|---|
| Gates measured presence, not quality. Every check passed and the film still failed. | All 14 beats passed fidelity; the cut was "nowhere near good enough" | Reference-measured gates: `tools/film/filmstats.py` + `filmgate.py`, audio `audiotags/audiostats`, look gate. Endoforge job intake should require a gate *against the reference* for any "match/beat X" goal (I16). |
| AI judges are not the client. Five AI red-team rounds and a blind AI judge scored a script 8+; Craig called it "the most horrid thing i have ever read". The same happened with video (gates ranked clips Craig called "terrible"). | Script v4.1; b4 video proof | **Calibrate every automated oracle on the client's own accepts/rejects before it gates anything.** Add a `calibration` block to job manifests: known-good and known-bad items from the client, and the oracle must separate them. Until calibrated, an oracle may only rank and alarm, never accept. |
| A rejection alarm is not an acceptance test. | Look gate passed frames Craig rejected | Foundation Film's `look_gate` is labelled a rejection alarm; acceptance stays with the client (done in PR #413). |
| Gate commands that print instead of fail. | A patch landed with 2 type errors (#80) | Lint for `&&`/`;` chains whose checks print counts: gates must exit non-zero. |
| Single-frame checks hide motion problems. | Stills looked right; motion swam | Every visual gate has a moving-sample variant; the first client review is a 2-second moving clip. |

## 2. Contracts between lanes

| Lesson | Evidence | Tool change |
|---|---|---|
| Shared names were never contracted. Scene lanes invented 52 voice-marker ids the voice lane didn't produce. | Film would not boot with the real voice (#66) | Cue/marker vocabulary is frozen in the contract before lanes start (I18). Foundation Film's `cue_vocabulary_check` runs statically before any render. |
| Scene timing rules surfaced one browser boot at a time. | b11 voice-free rule, end marker order (#67) | Scene rules exported as data and validated offline against the markers in one pass. |
| Shots defined by markers left gaps after re-timing. | "Frame is outside shot" (#69) | Timelines tile shots by construction. |
| A contact sheet of every beat's midpoint is the cheapest timeline boot test. | Wrong-beat bug (#72) | Make it the default gate after any timeline change. |

## 3. Orchestration

| Lesson | Evidence | Tool change |
|---|---|---|
| Hand-launched waves left lanes idle. | #62 | `dagrun.py` pattern: streaming DAG (collect → gate → launch ready lanes) → port into Endoforge's Conductor as the default scheduler. |
| Lanes whose outputs live outside the repo never "landed". | sfx-mix waited forever (#64) | Landing = an output-exists check declared per lane, not only a git apply. |
| Status parsed from text, not state. | False "failed" (#60) | Read gate files/markers, never stdout. |
| Long lanes as subagents filled the coordinator's context; splitting them into sessions late cost a restart each. | Four lanes stopped and re-briefed | Rule: a lane that will outlive one turn or owns a deliverable starts as its own session from the beginning. |
| A `git stash` in a shared worktree swept another session's edits. | #81 | Shared worktrees carry per-session file ownership; destructive git commands (stash, reset, checkout .) refuse when another owner has uncommitted files. |
| The same bug pattern lived in two tools. | ffmpeg error masking in compose and capture (#50, #68) | When fixing a pattern, grep every tool for it (I21); keep a pattern registry in the playbook. |

## 4. Capability probes before delegation

| Lesson | Evidence | Tool change |
|---|---|---|
| `codex exec` has no browser; the Suno job just read the skill and stopped. | #61 | A capability probe step in job intake: browser + sign-in, GPU, keys, model knobs (I19). |
| A provider knob that does nothing. | ElevenLabs v4 ignores `speed` (#65) | Calibrate each knob on one line and record what actually moves the measure. |
| Native output size was assumed. | Codex image_gen ≈1672×941; 2×2 sheets gave 836×470 cells labelled "1080p" (#79) | Every generated asset records its native size; the look gate reports effective resolution. |
| Gated weights and model-card mismatches. | LTX-2.5 never ran; VACE-Fun has no first/last frame | A model probe: licence, gate status, declared capabilities, one smoke inference, before a bake-off includes it. |

## 5. Compute

| Lesson | Evidence | Tool change |
|---|---|---|
| RunPod REST v1 retires 2026-11-15; network volumes pin a datacenter; stopped pods can return with zero GPUs. | research/runpod.md | Port `media/nh3-kit/tools/runpod/rp.py` to v2 (in progress); delete, never stop; startSsh for rsync. |
| An H100 is the wrong GPU for Cycles; consumer cards are 2–3× faster per dollar there. | Blender Open Data | Pick farm GPU per workload; Craig locked H100 for this job — record such locks in the manifest. |
| Per-session pods each pay ~15 min of setup. | Policy #94 | One shared render service per job (`farm-render`), sessions submit jobs. |
| fp8 full load gave no speed-up; the H100 was compute-bound. | 47 s/step both ways | Profile before "use the full GPU" changes; steps and resolution are the levers. |

## 6. Creative process

| Lesson | Evidence | Tool change |
|---|---|---|
| Build before plan: lanes re-staged prototypes unchanged. | #55 | Concept art + council (craft seats, SME, built-vs-needs-built) before any lane builds (I17). |
| The built-vs-needs-built search missed a sibling project's hero library. | ABI equipment library and Compressor Hall set existed (#76) | Inventory searches every project's asset libraries (`media/nh3-kit/trial/*`), not only the current tree. |
| No prep stage: rendering started before the look bible existed. | "if thats making it through we havent done enough prep work" | Production order: look bible → hero assets → lookdev lab with a calibrated look gate → animation → finals. |
| Edits vs writing. An edit pass kept the bad lines; blank-page drafts were judged by the wrong oracle. | v3 and v4 rejected | Creative rewrites start from the client's approved baseline and the client's own marked lines; iterate by staging (script lab: temp voice + animatic), not by AI critics. |
| Whole-reference analysis came late. | "analyze the entire mr. btu video not just the frames" | Step 1 of any match-the-reference job: whole-film analysis (shots, motion, light, sound, arc, audience comments). |

## 7. Stability (mechanisms, PR #416)

| Lesson | Evidence | Mechanism |
|---|---|---|
| The lane cap counts sessions, not only subagents | The Claude app died a third time with 7 sessions working (142 processes, 22 GB in its tree) | `lane-governor` (PR #417) admits or queues new lanes; `agent-guard` refuses whole-drive scans |
| A GPU slot held by a job that never touches the GPU | EEVEE held the only slot 28 min at 0 % | `gpu-queue` releases it after 10 min with no NVIDIA device open |
| Disk fills from per-folder installs | 2,837 work folders; 89 % full | `diskguard` alarm + nightly janitor; 424 → 741 GB free |
| Destructive git in shared checkouts | A stash swept another session's edits (#81) | `agent-guard` PreToolUse hook (1.97 % of 12,009 replayed commands refused, all target patterns) |
| Idle cloud spend | Two pods billed $1.31/h idle | `pod_watch` timer |
| Removing small files is CPU-bound | 9 → 56 folders/min with 4 workers | `diskguard` workers = threads / 8 |

## 8. Next tool changes (ordered)

1. Oracle calibration block in Endoforge job manifests (client accepts/rejects; oracle may only alarm until it separates them).
2. Capability/model probe stage in job intake.
3. Conductor: streaming DAG scheduler with declared landing checks; sessions for long lanes by default.
4. Cue-vocabulary and timing-rule contracts validated statically (Foundation Film tools wired into the job gates).
5. ~~Shared-worktree ownership guard for destructive git commands.~~ Built: `agent-guard` (PR #416).
6. RunPod v2 helper + shared render service (PR #414); idle-pod watchdog built (PR #416).
7. Script lab: script JSON → temp voice → auto-timed animatic, one command.
