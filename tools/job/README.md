# Job

The job tool takes a job from intake to launch. A job is an `endoforge/job/1` JSON manifest: the user's verbatim goal, a brief, primary sources, criteria with checks, atoms with owned files, gates and resources. The tool checks it against the POODO gates (Pontificate, Observe, Orient, Decide, Orchestrate, Loop) and the invariants I1 to I15. Each refusal names the invariant it breaks. Nothing launches until the user confirms the exact job card by its sha256. After the go, the [Conductor](../conductor/README.md) runs the job.

Proofs the tool makes (calibration, smoke, split, confirmation) go in `<job>.proofs.json` beside the manifest and are merged on load. Events go to `events.jsonl` and `EVENTS.md` beside the manifest.

## Entry point

`bin/job.mjs <command> <job.json> ...`. With no arguments it prints its usage and exits 2.

| Command | Effect |
|---|---|
| `gates`, `invariants` | Lists the gates and the invariants. |
| `validate <job.json> [--gate G] [--offline] [--json]` | Runs every rule up to gate G (default `orchestrate`). Exit 1 when a gate refuses. At `orchestrate` it runs the health check. |
| `card <job.json> [--out card.md]` | Retrieves open lessons from earlier jobs of the same kind and renders the job card with its sha256. |
| `confirm <job.json> --sha <sha> --by <user> --words "<words>" [--via direct\|relayed]` | Records the user's confirmation. A relayed one is refused at Decide. |
| `lessons <job.json>` | Open lessons and the atoms they reach. |
| `compile <job.json> [--out dir] [--offline]` | Writes every atom's prompt and a `manifest.json` of hashes. |
| `stage <job.json>` | Decide without the go must pass. Writes `JOB-<id>.md` and emits `STAGED`. |
| `fire <job.json> [-- <launch command>]` | After the go: Orchestrate gates, compiled prompts, a `FIRED` event, then the launch command with `ENDOFORGE_JOB` and `ENDOFORGE_PROMPTS` set. |
| `smoke <job.json>` | One tiny atom per engine on a discovered login. |
| `calibrate <job.json> [--criterion ID]` | Runs each proxy check on its known-good and known-bad case. |
| `prove-split <job.json> --from <path> ...` | Writes a split's proof: a pixel diff within the noise floor, or tests passing. |
| `event <job.json> <KIND> <summary> [--detail md] [--data json]` | Records an event. |
| `knowledge <job.json> add --text ... --source ... [--tags a,b]` | Records a fact found during the run. |
| `status`, `go`, `lock`, `pause`, `resume`, `budget`, `stop`, `patch` | Passed to the Conductor. |

`fire` and `smoke` launch model workers. `calibrate` and `prove-split --tests` run the commands in the manifest.

Job kinds are data in [kinds/](kinds/): `code`, `doc`, `generic`, `campus`, `model3d` and `video`. A kind lists its proxy check kinds and required checks. The rules are in `lib/validate.mjs` and `lib/kinds.mjs`.

## Environment

| Variable | Default | Effect |
|---|---|---|
| `ENDOFORGE_JOBS` | `./jobs` | Colon-separated roots searched for earlier jobs' lessons. |
| `ENDOFORGE_JOB_KINDS` | none | Extra colon-separated directories of kind files. |
| `ENDOFORGE_VOLATILE` | built-in list | Colon-separated roots treated as volatile (not durable disk). |
| `ENDOFORGE_NOTIFY` | on | `none` turns off desktop notifications (`notify-send`). |
| `ENDOFORGE_EVENT_HOOKS`, `ENDOFORGE_PUSH_HOOKS`, `ENDOFORGE_COORDINATOR_HOOKS` | none | Extra hooks for every event, pushed events and `NEEDS-COORDINATOR`. |

The health check is `resources.health` in the manifest. Without it, the tool runs `.local/bin/system-safety-status` in the home directory.

## Example

These ran on a synthetic one-atom `code` job in a temp directory, with `ENDOFORGE_NOTIFY=none`, `ENDOFORGE_JOBS` pointing at an empty directory and `ENDOFORGE_VOLATILE=/nonexistent-volatile`:

```sh
node tools/job/bin/job.mjs gates
node tools/job/bin/job.mjs validate job.json --gate decide --offline
node tools/job/bin/job.mjs card job.json --out card.md
node tools/job/bin/job.mjs compile job.json --out prompts --offline
node tools/job/bin/job.mjs stage job.json
node tools/job/bin/job.mjs status job.json
```

Before `card`, `validate` exited 1 with `REFUSED decide I14` (lessons not retrieved) and `REFUSED decide I1` (card not confirmed). `card` printed the card sha256 on stderr. `compile` wrote `A.prompt` and `manifest.json`. `stage` passed Pontificate to Decide and emitted `STAGED`.

## Tests

`make lib-test` runs `test/failopen.test.mjs`, which passed. The Conductor tests in the same target also drive `stage` and `go`.
