#!/bin/sh
# /data is a mounted volume, so it arrives owned by whoever owns it on the
# host and its ownership cannot be settled at build time. It is settled here,
# once, before the server starts.
#
# The container therefore enters as root and leaves root behind immediately:
# the server itself never runs privileged.
set -e

DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = '0' ]; then
  mkdir -p "$DIR"
  # A bind mount from a host with no Unix ownership to give — Docker Desktop
  # on Windows or macOS — refuses the chown and does not need it, so a failure
  # here is not fatal. A real volume on a Linux host does need it.
  chown -R table:table "$DIR" 2>/dev/null || true
  exec setpriv --reuid=table --regid=table --init-groups "$@"
fi

exec "$@"
