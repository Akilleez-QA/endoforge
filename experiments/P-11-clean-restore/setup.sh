#!/usr/bin/env bash
set -euo pipefail
command -v dockerd >/dev/null
command -v docker >/dev/null
sudo -n true
test -f "$(dirname "$0")/../P-09-portable-campaign/work/image.tar"
test -f "$(dirname "$0")/../P-09-portable-campaign/work/inputs.tar.gz"
command -v containerd >/dev/null
command -v unshare >/dev/null
command -v ctr >/dev/null
