# Fleet member disconnect protocol

How every agent and job on a machine comes to a clean stop before a reboot or shutdown, and how the fleet comes back. Written 2026-10-26, when Craig rebooted the rig while about ten members were working: Claude sessions, Claude lanes, a Codex lane fleet, Blender renders and queued GPU jobs. Craig: "tell all these sessions to wrap up were rebooting", "add a fleet memeber disconnect protocol to akileez repo for this", and "ramping down the availability of gpu and cpu to the agents might be the easiest way to ratchet down for a reboot".

The tool is [`fleet-disconnect`](fleet-disconnect), installed by `install.sh` with the rest of the throttle.

## The capacity dial

Agents get CPU and GPU through `heavy-run` and `gpu-queue.py`. Both read one dial, `~/.local/state/fleet/CAPACITY` (`fleet-disconnect ramp N`):

| Dial | heavy-run (new jobs) | heavy.slice (running jobs) | gpu-queue.py | Fleet hooks |
|---|---|---|---|---|
| 100 % (default) | all slots, load limit 0.875 × threads | CPUQuota 56 % of threads | VRAM 60 %, BAR1 50 %, load limits | `ramp` with FLEET_PERCENT=100 |
| N % | N % of the slots (at least 1), N % of the load limit | CPUQuota N % of normal | N % of each limit | `ramp` with FLEET_PERCENT=N |
| 0 % (`drain`) | refused, exit 75; waiting jobs leave | CPUQuota 1 % of normal | no new ticket; waiting tickets released, exit 75 | `drain` |

Running jobs are never killed. Exit 75 means "requeue later" everywhere in the fleet, so callers already handle it. The dial is a file, so it survives the reboot: after boot the fleet stays where it was until someone runs `fleet-disconnect resume`.

A fleet with its own launch loop joins through a hook in `~/.config/fleet/hooks.json` (see [`hooks.example.json`](hooks.example.json)). The hook fields are:
- `ramp`: scale it, given `$FLEET_PERCENT`;
- `drain`: stop launching;
- `busy`: exit 0 while work is in flight, and print what;
- `resume`: start launching again;
- `auto_resume`: false keeps a human in the loop.

## Disconnect

The coordinator is the session the human asked to disconnect, or the human.

1. **Ramp down.** Run `fleet-disconnect ramp 50 --reason "reboot soon"`. Ramp further if time allows, then run `fleet-disconnect drain --reason "<why>"`. The drain stops new heavy and GPU work, drains each hook, starts a receipt, and prints the wrap-up message.
2. **Tell every agent.** Send each agent session and lane the printed wrap-up message, with SendMessage or the session's inbox. A tool cannot do this step, because agents stop only at the end of a turn. Each member then:
   - stops the jobs it owns (`systemctl --user stop <unit>`), cancels its GPU tickets, and confirms nothing of its own is running;
   - commits what is worth keeping (specific files only) and pushes it, or says it is local only;
   - writes `RESUME.md` in its worktree: done, half done, the exact next step, and the jobs to requeue;
   - ends its turn with a one-line status.
3. **Wait.** Run `fleet-disconnect wait --timeout 600`. It returns 0 when no heavy job, GPU ticket, Blender process or busy hook is left. On a timeout it lists what is left. Stop those through their owners, or accept the loss and say so. Never kill another agent's work to get to clear.
4. **Disconnect.** Report the receipt (`~/.local/state/fleet/current.json`) and each member's one-line status to the human. Then reboot.

Agent CLIs (Claude Code, Codex) are listed, but they don't block the clear. Their state is in git and RESUME.md once they have wrapped up.

## Reconnect

1. Run `fleet-disconnect status`. The fleet is still at 0 %. Check the machine before anything else: `~/.local/bin/system-safety-status`, `nvidia-smi`, and `systemctl --user --failed`.
2. Run `fleet-disconnect resume`. It sets the dial back to 100 %, restores heavy.slice, and runs hooks marked `auto_resume`. It lists the other hooks with their resume command; run each one only when its owner says to.
3. Resume lanes one at a time from their RESUME.md, at about three live lanes at most. Requeue the GPU and heavy jobs they list.

## Tests

`test/run.sh` runs `test/test_fleet_disconnect.py`. It covers:
- the dial's effect on heavy-run slots and refusals, and on the queue's limits and refusals;
- ramp, drain and resume round trips with hooks;
- the receipt;
- wait's clear and timeout.
