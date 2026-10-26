---
name: endoforge-intake
description: Intake for production jobs, run as POODO in code: a JOB manifest, a staged job card the user confirms once, compiled atom prompts, then firing as an event. Use whenever a request is a production job in Craig's sense — a video, a 3D model or character, a campus or set build, a multi-file code change, a document others will use, or any multi-lane or parallel agent work — before writing any brief, prompt or launch. Not for a one-line answer or a single quick edit.
---

# Endoforge intake

Craig: "consider how the model working with the user needs to be prompted by endoforce so all this happens the right way the first time", "not just on this task but any task, what are the invariants", "this is /poodo", "make firing off the endoforge an event to the user".

You are the coordinator. Your job is to get the understanding right **before** anything launches. The method is POODO (`~/.claude/skills/poodo/SKILL.md`). The tool is `forge/endoforge/tools/job` (`endoforge job …`, or `node forge/endoforge/tools/job/bin/job.mjs …` from the akilleez checkout). Every step below is a gate the tool checks, and each refusal names the invariant it protects (I1–I14, in `forge/endoforge/docs/PLAYBOOK-deadline-fanout.md`).

## The loop

1. **Pontificate (I1).** Write `job.json` (`endoforge/job/1`; see `tools/job/fixtures/` for a video, a code and a campus job).
   - Put the user's words in `goal.verbatim`, with `goal.by`. Never paraphrase them.
   - **Read the primary source yourself**: the script, the issue, the spec. List it as `primary: true`. Never brief from a summary, yours or anyone's.
   - Decompress the goal into `brief`: objective, acceptance, scope, authority, and assumptions, with what the user **stated** kept apart from what you **inferred**.
   - Name the running `notes` file.
2. **Observe (I2, I4, I7).**
   - Put every reference and source on durable disk (`/mnt/cold-steam/...`), never `/tmp`.
   - Say what each one **governs**: "the Mr. BTU frames govern the MODEL; the script governs the persona".
   - When the kind needs it, build the truth package with tolerances (survey, LiDAR, CoolProp, IIAR, tests).
3. **Orient (I5, I6, I13).**
   - Define atoms with disjoint files, their aspects, and the sources and references that govern those aspects.
   - Give every seam and every shared file an owner or make it a frozen contract.
   - Give each atom a local check.
   - Split monolithic files first, and prove each split a no-op: `prove-split`, against a measured noise floor; tests for code.
   - Name the critical path, the strongest rival and the deadline.
4. **Decide (I3, I9, I11).**
   - Map every acceptance criterion to a check that can fail, and label proxies. For a reference that governs a look, add a likeness check.
   - `endoforge job calibrate job.json`: the known-good case must pass and the known-bad case must fail.
   - Run a one-atom smoke launch per engine and record its receipt.
   - List the human gates. Keep them off the critical path where possible.
   - `endoforge job stage job.json` renders the **job card** (`JOB-<id>.md`) and emits STAGED. Show the user the card, thumbnails included, and **wait for their go in their own words**.
   - Then `endoforge job confirm job.json --sha <card sha> --by <user> --words "<their words>"`. A relayed approval never counts.
5. **Orchestrate (I8).** Run `endoforge job fire job.json -- <launcher>`, or a hill-climb fan-out campaign with `"job": "<path>"`.
   - It refuses unless the staged card was confirmed after it was staged, the gates pass and the machine is healthy.
   - It compiles every atom's prompt from the manifest. **Never hand-write an atom prompt.**
   - It emits FIRED: atoms by engine and login, the prompt hash, predictions, gates, ETA and how to stop.
6. **Loop (I10, I12, I14).**
   - Each round emits SCORED and GATE. Use NEEDS-YOU only when a decision blocks the critical path. Emit DONE at the end.
   - The ratchet means no HARD count rises. A regression reverts per atom.
   - Report only what ran. Delivered is not verified.
   - Log each mistake with its cost in the notes file. Each lesson becomes a tool change or a tracked gap. `endoforge job status job.json` shows the timeline.

## Never
- Launch before the user's go on the staged card, or fire on a card that changed after the go.
- Put a brief, a reference, state or notes under `/tmp`.
- Give an atom a summary instead of its governing sources and references.
- Treat agreement among agents, or a proxy score, as the outcome.

## Install
From the akilleez checkout: `install -D -m644 forge/endoforge/skills/endoforge-intake/SKILL.md ~/.claude/skills/endoforge-intake/SKILL.md`. Codex and the Grok bots follow the same contract through the repo `AGENTS.md` ("Invariants for any task").
