#!/usr/bin/env bash
# Install the throttle on this machine (safe to rerun):
#   heavy-run    ~/.local/bin, and heavy.slice sized for this machine
#   memguard     ~/.local/bin, its user service, and the root half (reserved memory up to user.slice; uses sudo)
#   fleet-disconnect  ~/.local/bin (the capacity dial and disconnect protocol, FLEET-DISCONNECT.md)
#   workers      ~/.local/bin (the CLI-worker registry: workers list shows running and dead workers on every host)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -m 0755 "$here/heavy-run" "$HOME/.local/bin/heavy-run"
install -m 0755 "$here/memguard.py" "$HOME/.local/bin/memguard"
install -m 0755 "$here/fleet-disconnect" "$HOME/.local/bin/fleet-disconnect"
install -m 0755 "$here/workers" "$HOME/.local/bin/workers"
install -m 0644 "$here/memguard.service" "$HOME/.config/systemd/user/memguard.service"
"$HOME/.local/bin/heavy-run" --write-slice
"$HOME/.local/bin/memguard" --install
systemctl --user enable --now memguard.service
systemctl --user restart memguard.service
"$HOME/.local/bin/heavy-run" --limits
