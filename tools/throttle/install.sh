#!/usr/bin/env bash
# Install heavy-run into ~/.local/bin and size heavy.slice for this machine. Safe to rerun.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -m 0755 "$here/heavy-run" "$HOME/.local/bin/heavy-run"
"$HOME/.local/bin/heavy-run" --write-slice
"$HOME/.local/bin/heavy-run" --limits
