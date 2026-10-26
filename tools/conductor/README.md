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

Stages: (1) state, events and commands, with the phase loop (this PR); (2) launcher, collect gate and locks; (3) streaming loops with pluggable checks; (4) escalation packets and adopting a running job.

Tests: `node test/state.test.mjs` (`make conductor-test`).
