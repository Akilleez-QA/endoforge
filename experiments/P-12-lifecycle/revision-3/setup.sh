#!/bin/sh
set -eu
# Offline check only: P-09 must already have provided this exact image.
sudo -n docker image inspect sha256:653395e40dfce4bbf2f3919638c1f375056deb81f47d8e3f7c855ed7b27b6541 >/dev/null
python3 --version
