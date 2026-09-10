#!/bin/sh
set -eu
# Railway mounts new persistent volumes as root. Prepare only the app's upload directory,
# then run the web process without root privileges.
if [ "$(id -u)" = 0 ]; then
  install -d -o node -g node -m 700 /data
  exec gosu node:node "$@"
fi
exec "$@"
