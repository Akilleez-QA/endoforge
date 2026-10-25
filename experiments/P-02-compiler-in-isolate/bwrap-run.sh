#!/usr/bin/env bash
# Run main.mjs under bubblewrap with no filesystem beyond: the node binary (its install dir, read-only),
# the system shared libraries node links against (read-only), the probe directory (read-only),
# a private /proc (worker reads /proc/self/status for RSS), a minimal /dev and an empty tmpfs /tmp.
# No home, no /etc, no network (--unshare-all), dies with the parent.
set -uo pipefail
cd "$(dirname "$0")"
PROBE_DIR="$(pwd)"
NODE_BIN="$(readlink -f "$(command -v node)")"
NODE_DIR="$(dirname "$(dirname "$NODE_BIN")")"
OUT="${1:-receipt/compile-bwrap.jsonl}"
{
  echo "node_bin $NODE_BIN"
  echo "node_dir $NODE_DIR"
  echo "probe_dir $PROBE_DIR"
  echo "bwrap $(bwrap --version)"
} > receipt/bwrap-config.txt

bwrap \
  --unshare-all --die-with-parent --new-session \
  --ro-bind "$NODE_DIR" "$NODE_DIR" \
  --ro-bind /usr/lib /usr/lib \
  --ro-bind /usr/lib64 /usr/lib64 \
  --symlink usr/lib64 /lib64 \
  --symlink usr/lib /lib \
  --ro-bind "$PROBE_DIR" "$PROBE_DIR" \
  --proc /proc \
  --dev /dev \
  --tmpfs /tmp \
  --chdir "$PROBE_DIR" \
  --setenv HOME /nonexistent \
  --setenv PATH "$NODE_DIR/bin" \
  --clearenv --setenv HOME /nonexistent --setenv PATH "$NODE_DIR/bin" \
  "$NODE_BIN" main.mjs --stdout --label bwrap > "$OUT" 2> receipt/bwrap-stderr.txt
rc=$?
echo "bwrap_exit $rc" >> receipt/bwrap-config.txt
echo "bwrap exit $rc"
exit $rc
