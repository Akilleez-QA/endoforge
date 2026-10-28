#!/usr/bin/env bash
# Install the throttle on this machine (safe to rerun):
#   heavy-run    ~/.local/bin, and heavy.slice sized for this machine
#   memguard     ~/.local/bin, its user service, and the root half (reserved memory up to user.slice; uses sudo)
#   fleet-disconnect  ~/.local/bin (the capacity dial and disconnect protocol, FLEET-DISCONNECT.md)
#   diskguard    ~/.local/bin, the 15-minute system-drive alarm and the nightly janitor (user timers)
#   agent-guard  ~/.local/bin, registered as a Claude Code PreToolUse hook on Bash in ~/.claude/settings.json
#   workers      ~/.local/bin (the CLI-worker registry: workers list shows running and dead workers on every host)
#   remote-run   ~/.local/bin (run a heavy job on another host of ours, through its heavy-run; `remote-run --host H setup`)
#   lane-governor     ~/.local/bin, and its once-a-minute sampler timer (agent-lane admission for the Claude app)
#   lane         ~/.local/bin, and lane-watch.timer (durable agent lanes that survive the app, crashes, login limits and reboots)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -m 0755 "$here/heavy-run" "$HOME/.local/bin/heavy-run"
install -m 0755 "$here/memguard.py" "$HOME/.local/bin/memguard"
install -m 0755 "$here/fleet-disconnect" "$HOME/.local/bin/fleet-disconnect"
install -m 0755 "$here/diskguard.py" "$HOME/.local/bin/diskguard"
install -m 0755 "$here/agent-guard.py" "$HOME/.local/bin/agent-guard"
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.claude/settings.json')
d = json.load(open(p)) if os.path.exists(p) else {}
pre = d.setdefault('hooks', {}).setdefault('PreToolUse', [])
if not any(h.get('command', '').endswith('agent-guard') for m in pre for h in m.get('hooks', [])):
    pre.append({'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': 'python3 -B ~/.local/bin/agent-guard',
                                              'timeout': 20}]})
    os.makedirs(os.path.dirname(p), exist_ok=True)
    json.dump(d, open(p + '.tmp', 'w'), indent=2); os.chmod(p + '.tmp', 0o600); os.replace(p + '.tmp', p)
PY
install -m 0755 "$here/workers" "$HOME/.local/bin/workers"
install -m 0755 "$here/remote-run" "$HOME/.local/bin/remote-run"
install -m 0755 "$here/lane-governor.py" "$HOME/.local/bin/lane-governor"
install -m 0755 "$here/lane" "$HOME/.local/bin/lane"
"$HOME/.local/bin/lane" install
install -m 0644 "$here/memguard.service" "$HOME/.config/systemd/user/memguard.service"
install -m 0644 "$here/lane-governor-sample.service" "$here/lane-governor-sample.timer" "$HOME/.config/systemd/user/"
for u in diskguard-check.service diskguard-check.timer diskguard-janitor.service diskguard-janitor.timer; do
  install -m 0644 "$here/$u" "$HOME/.config/systemd/user/$u"
done
systemctl --user daemon-reload
"$HOME/.local/bin/heavy-run" --write-slice
"$HOME/.local/bin/memguard" --install
systemctl --user enable --now memguard.service
systemctl --user restart memguard.service
systemctl --user enable --now lane-governor-sample.timer
systemctl --user enable --now diskguard-check.timer diskguard-janitor.timer
"$HOME/.local/bin/heavy-run" --limits
"$HOME/.local/bin/lane-governor" limits
