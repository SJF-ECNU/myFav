#!/bin/sh
set -eu
if [ "${1:-}" = login ]; then
  exec /app/scripts/docker-login.sh "${2:-bilibili}"
fi
exec "$@"
