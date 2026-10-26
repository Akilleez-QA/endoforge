# Job intake: POODO executed as code

Craig, 2026-10-26: "consider how the model working with the user needs to be prompted by endoforce so all this happens the right way the first time", then "not just on this task but any task, what are the invariants", then "the first principles the FMEA RCA / this is /poodo".

**Root cause it answers** (the five-whys RCA of the a collaborator model miss, `/mnt/cold-steam/factory-scratch/mrton/NOTES.md`): Endoforge's loop started at launch, not at understanding. Pontificate and Observe were not gates, so getting it right depended on one model staying vigilant. Now every production job (videos, 3D models, code, docs, the campus, multi-lane work) is a JOB manifest, and nothing launches until its gates pass. The method is POODO (`~/.claude/skills/poodo/SKILL.md`); this tool encodes its intake.

## Gates and invariants

| Gate | Holds | What must be true to pass |
|---|---|---|
| Pontificate | I1 | the goal verbatim with who said it; at least one primary source; a decompressed brief (objective, acceptance, scope, authority, assumptions stated vs inferred); a notes file (I14) |
| Observe | I2, I4, I7 | every source and reference says what it governs; the truth package with tolerances (required by kind); every path absolute, existing, never on /tmp |
| Orient | I5, I6, I13 | each atom gets every input that governs its aspects (I2); disjoint files, every shared file and seam owned; a local check per atom; splits proven (pixel diff within a noise floor, or tests for code); the critical path, the strongest rival, the deadline; speculation only on the critical path |
| Decide | I3, I9, I11 | every criterion has a check that can fail; proxy checks labelled and calibrated (known-good passes, known-bad fails); each governing reference measured; the ratchet precommitted (I10); a smoke receipt per engine; gates listed, relayed approvals refused; the user's confirmation of the card (I1) |
| Orchestrate | I8 | the throttle and the capacity dial named; GPU work through gpu-queue; the machine health check passes |
| Loop | I10, I12, I14 | each round has its receipt and LESSONS.md; the ratchet baseline exists |

`lib/invariants.mjs` lists I1–I14. Each validator message cites one, and `status` reports each invariant as holds, partial, pending or broken. Kind plugins (`lib/kinds.mjs`: `video`, `model3d`, `code`, `campus`, `doc`, `generic`) only add kind-specific checks: likeness for references that govern a look, tests for code, a truth package and site rules for the campus.

```sh
J=forge/endoforge/tools/job/bin/job.mjs   # or: endoforge job <command>
node $J stage <job.json>                    # Decide minus the go; writes JOB-<id>.md (the card) and emits STAGED
node $J confirm <job.json> --sha <card sha> --by Craig --words "<his words>"
node $J fire <job.json> -- <launcher>       # only on the confirmed staged card: gates, compiled prompts, FIRED, launch
node $J smoke <job.json>                    # one atom per engine; records the smoke receipt
node $J prove-split <job.json> --from <file> --before A --after B --noise C   # or --tests "<cmd>" for code
node $J compile <job.json>; node $J status <job.json>; node $J event <job.json> NEEDS-YOU "<decision>"
node $J validate <job.json> --gate decide       # everything before spend; exit 1 lists each refusal with its gate and invariant
node $J calibrate <job.json>                    # run each proxy check on its known-good and known-bad case; writes <job>.proofs.json
node $J validate <job.json>                     # to Orchestrate: also runs the machine health check
node $J gates; node $J invariants
```

## FMEA controls (AIAG-VDA action priority H)

| Failure mode | Prevention (tool) | Detection (tool) | Test |
|---|---|---|---|
| Intent distorted in the brief | verbatim goal, primary source, decompressed brief (Pontificate) | the user's confirmation of the job card (Decide) | `FMEA H1 …` |
| Reference not delivered to its atoms | a governed atom without its reference is refused (Orient) | each governing reference must be measured; video and 3D need a likeness check (Decide) | `FMEA H2 …` |
| Criterion without a check, or miscalibrated | every criterion maps to a runnable check; proxies labelled with calibration cases | `calibrate` runs known-good and known-bad; a check that passes both is refused | `FMEA H3 …` (two tests) |
| Machine overload | a named throttle, the capacity dial, GPU through gpu-queue (Orchestrate) | the health check (`system-safety-status`) runs at Orchestrate and refuses on failure | `FMEA H4 …` |

M rows are tracked as gaps in `forge/endoforge/docs/PLAYBOOK-deadline-fanout.md`.

## Fixtures

- `fixtures/mrton-as-briefed.json`: the job as the coordinator briefed it at 06:20. It is refused for I1, I2, I3 and I7: no primary source, the character atom without the Mr. BTU reference, no likeness check, and references in /tmp.
- `fixtures/mrton.json`: the same job, fixed. It passes through Orchestrate.
- `fixtures/code-overlap-refactor.json`: a three-module refactor. Tests are its truth and its split proof.
- `fixtures/campus-compressor-hall.json`: rebuild the Compressor Hall, naming its truth package (LiDAR, survey photos, tolerances).

Events (STAGED, FIRED, SMOKE, SCORED, GATE, NEEDS-YOU, DONE) go to `events.jsonl` and `EVENTS.md` beside the manifest, to a desktop notification, and to hooks. Push hooks (`job.events.push`, `ENDOFORGE_PUSH_HOOKS`) get only FIRED, GATE, NEEDS-YOU and DONE. A hill-climb fan-out campaign with `"job": "<manifest>"` runs behind these gates and fires compiled prompts.

The coordinator's trigger is the `endoforge-intake` skill (`forge/endoforge/skills/endoforge-intake/SKILL.md`). Install it with `install -D -m644 forge/endoforge/skills/endoforge-intake/SKILL.md ~/.claude/skills/endoforge-intake/SKILL.md`. The same contract is in the repo `AGENTS.md`.

Tests: `node test/run.mjs` (also run by `make job-test`).
