# Conductor: one long-running, resumable orchestrator per job

Craig, 2026-10-26: "seems like we need a layer for what your doing right now, master orchestrator or something".

**First principle:** deterministic mechanism belongs in code that never sleeps; judgment belongs in a model, called only when judgment is needed. On the a collaborator run the chat model was both. It stopped between turns, forgot locks and wrote untested scripts live (most of NOTES.md mistakes 14–35).

`endoforge conduct <job.json>` starts the job's Conductor as a systemd user service (`heavy.slice`, restart on failure). It keeps its state in `<jobdir>/conductor/state.json`, written atomically under a lock, so it resumes after an app restart or a reboot. It owns the POODO state machine:

```text
staged → go (the user's go on the staged card) → smoke → fired → streaming → gates → locks → [finals] → [compose] → done
```

It owns all the mechanism: the compiled-prompt launches, the collect gate, the per-atom loops, the locks, the error taxonomy (`tools/lib/errors.mjs`), the dial, the events and the lessons. Judgment leaves it only as an event:
- **NEEDS-COORDINATOR** goes to the model (`job.events.coordinator`, `ENDOFORGE_COORDINATOR_HOOKS`), with a context packet.
- **NEEDS-YOU** goes to the human, for authority only: the card go, taste locks, spend, outward actions.

| Command (`endoforge job …`) | What |
|---|---|
| `status <job>` | phase, budget, every atom's status and iteration, open escalations, then the event timeline |
| `go <job> --sha <card> --by <user> --words "…"` | the user's go on the staged card (staged → go); a relayed go is refused |
| `lock <job> <atom> --by --words` | a taste lock: the atom is settled and never relaunched |
| `pause <job>` / `resume <job>` | the daemon idles / continues |
| `budget <job> [--launches N] [--iterations N]` | view or change it; raising it is spend and needs the user's words |
| `stop <job> [--by] [--why]` | the daemon stops its lanes and ends in done, with a DONE event |

Stages: (1) state, events and commands, with the phase loop; (2) launcher, collect gate and locks; (3) streaming loops with pluggable checks; (4) escalation packets and adopting a running job.

**Launch** (`lib/launch.mjs`): every atom's prompt is compiled from the manifest (`tools/job/lib/compile.mjs`) and runs on a rotated login (Codex through codex-pool, Claude through `CLAUDE_CONFIG_DIR`). Each atom gets its own worktree of the integration HEAD and runs as a systemd unit in `heavy.slice` (or a plain child with `conductor.launcher: "local"`). The capacity dial sizes each wave, and the launch budget caps the total; a spent budget raises NEEDS-YOU.

**Collect gate** (`lib/collect.mjs`, P-B, ported from `fanout.py`): one exclusive lock on the integration repo for the whole apply-gate-commit. For each atom it:
1. diffs the atom's own files (new files included) and applies them;
2. runs the gate (`atom.gate` or `conductor.gate`; 75 waits, 78 stops);
3. commits, or reverts **only that atom** and writes the exact error to `gates/<atom>-i<iter>.gate.json`.

The next prompt carries that error. After `conductor.maxIterations` the atom escalates by NEEDS-COORDINATOR with its history.

**Streaming** (`lib/checks.mjs`, P-D, ported from `beatloop.py`). There is no barrier: each landed atom becomes its own task, and up to `conductor.checkConcurrency` run at once while the daemon keeps launching and collecting the rest. A task runs:
1. the collect gate;
2. `conductor.slice.render`, which renders only that atom's slice into `${out}` (with `${atom}` and `${repo}`; put the GPU queue inside it);
3. its `conductor.checks`, each `{ id, run, atoms?, json? }`, run with `${input}` = the slice and `${out}` = a JSON result.

A check passes on exit 0, or on `pass` in its JSON. Critics such as `likeness.sh` and `fidelity.sh` are checks with `json: true`; their `fix` and `elements` go into the next prompt. Then the atom is **frozen**, or **relaunched at once** with the findings, up to `maxIterations`, after which it escalates.

Errors are typed: 75 waits; 78 stops the job; a check that cannot run is **not scored**. A not-scored check is retried, never counted as a failed iteration, and after `maxUnscored` it wakes the coordinator. A daemon restart resumes atoms that were mid-check.

Tests: `node test/state.test.mjs`, `node test/launch.test.mjs`, `node test/stream.test.mjs` (`make conductor-test`).
