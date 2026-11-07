#!/bin/sh
case "$*" in
  *core.engine.frozen*)
    if [ "$(od -An -N2 -tu2 /dev/urandom | tr -d ' ')" -lt "${P52_STALL_BELOW:-1311}" ]; then exec sleep 12; fi ;;
esac
exec "$P52_REAL_PYTHON" "$@"
